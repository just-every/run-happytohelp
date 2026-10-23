import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {mediaResponseHeaders} from '../conversations/media-response'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
function ids(value:unknown){if(!Array.isArray(value)||value.length>40||value.some(id=>typeof id!=='string'||id.length>200))throw new HTTPException(400,{message:'Choose at most 40 messages or attachments'});return [...new Set(value)] as string[]}
export async function selectedContext(env:Env,projectId:string,conversationId:string,body:any){
 const messageIds=ids(body.message_ids??[]),attachmentIds=ids(body.attachment_ids??[])
 const data=await env.DB.batch<any>([
  env.DB.prepare('SELECT id,content,created_at FROM messages WHERE project_id=? AND conversation_id=? AND erased_at IS NULL AND id IN (SELECT value FROM json_each(?)) ORDER BY revision').bind(projectId,conversationId,JSON.stringify(messageIds)),
  env.DB.prepare(`SELECT id,filename,size FROM media WHERE project_id=? AND conversation_id=? AND message_id IS NOT NULL AND id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM conversation_note_media n WHERE n.media_id=media.id)`).bind(projectId,conversationId,JSON.stringify(attachmentIds))
 ])
 if(data[0].results.length!==messageIds.length||data[1].results.length!==attachmentIds.length)throw new HTTPException(400,{message:'A chosen message or attachment is unavailable. Private notes cannot be shared.'})
 return {messageIds,attachmentIds,messages:data[0].results,attachments:data[1].results,body:data[0].results.map(row=>`Message (${new Date(row.created_at).toISOString()}):\n${row.content}`).join('\n\n')}
}
export async function prepareSharedContext(env:Env,projectId:string,conversationId:string,operationId:string,context:Awaited<ReturnType<typeof selectedContext>>,origin:string){
 const files=[],grants:D1PreparedStatement[]=[]
 for(const file of context.attachments){const token=crypto.randomUUID()+crypto.randomUUID();grants.push(env.DB.prepare('INSERT INTO escalation_attachment_grants VALUES(?,?,?,?,?,?)').bind(await hashToken(token),projectId,conversationId,file.id,operationId,Date.now()+7*86400000));files.push(`${file.filename} (${file.size} bytes; download expires in 7 days): ${new URL('/api/escalations/attachments/'+token,origin).href}`)}
 return {body:[context.body,...files].filter(Boolean).join('\n\n'),grants}
}
export const attachmentRoutes=new Hono<AppEnv>()
attachmentRoutes.get('/attachments/:token',async c=>{
 const row=await c.env.DB.prepare(`SELECT m.object_key,m.filename,m.content_type FROM escalation_attachment_grants g JOIN media m ON m.id=g.media_id AND m.project_id=g.project_id AND m.conversation_id=g.conversation_id JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id JOIN escalation_operations op ON op.id=g.operation_id WHERE g.token_hash=? AND g.expires_at>? AND op.state='complete' AND ${contactAvailableSql()} AND NOT EXISTS(SELECT 1 FROM conversation_note_media n WHERE n.media_id=m.id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(await hashToken(c.req.param('token')),Date.now()).first<any>()
 if(!row)throw new HTTPException(404);const object=await c.env.FILES.get(row.object_key);if(!object)throw new HTTPException(404)
 return new Response(object.body,{headers:{...mediaResponseHeaders(row.content_type,row.filename),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
})
