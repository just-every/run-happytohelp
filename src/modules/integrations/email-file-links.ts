import {messageKnowledgeAvailable} from '../knowledge/delivery'
import {resolveHelpAccess} from '../knowledge/access'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {mediaResponseHeaders} from '../conversations/media-response'

/** A file an email could not carry (over the provider limit, or unreadable when the
 * email was rendered) is linked instead. The link is a capability for that one file,
 * like the attachment it replaces; it stops working when the contact is erased
 * (erasure also deletes the media row). */
async function signature(env:Env,projectId:string,conversationId:string,mediaId:string){
 const secret=env.INBOUND_EMAIL_TOKEN
 if(typeof secret!=='string'||!secret)return null
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['file-v1',projectId,conversationId,mediaId])))
 return Array.from(new Uint8Array(signed)).map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32)
}
export async function emailFileLink(env:Env,projectId:string,conversationId:string,mediaId:string){
 const signed=await signature(env,projectId,conversationId,mediaId)
 if(!signed||typeof env.APP_ORIGIN!=='string'||!env.APP_ORIGIN)return undefined
 return new URL(`/api/integrations/email/files/${encodeURIComponent(mediaId)}/${signed}`,env.APP_ORIGIN).href
}

export const emailFileLinks=new Hono<AppEnv>()
emailFileLinks.get('/email/files/:mediaId/:signature',async c=>{
 const file=await c.env.DB.prepare(`SELECT a.id,a.project_id,a.conversation_id,a.message_id,a.object_key,a.filename,a.content_type FROM media a
  JOIN messages m ON m.id=a.message_id AND m.project_id=a.project_id AND m.conversation_id=a.conversation_id
  JOIN conversations c ON c.id=a.conversation_id AND c.project_id=a.project_id WHERE a.id=? AND ${contactAvailableSql()}`)
  .bind(c.req.param('mediaId')).first<{id:string;project_id:string;conversation_id:string;message_id:string;object_key:string;filename:string;content_type:string}>()
 const expected=file?await signature(c.env,file.project_id,file.conversation_id,file.id):null,supplied=c.req.param('signature')
 let difference=expected&&expected.length===supplied.length?0:1
 for(let index=0;expected&&index<expected.length;index++)difference|=expected.charCodeAt(index)^(supplied.charCodeAt(index)||0)
 if(!file||difference)throw new HTTPException(404)
 const reader=await resolveHelpAccess(c.env,file.project_id,c.req.raw),readerId=reader?.contactId||''
 if(!await messageKnowledgeAvailable(c.env,file.message_id,readerId))throw new HTTPException(404)
 const object=await c.env.FILES.get(file.object_key)
 if(!object||!await messageKnowledgeAvailable(c.env,file.message_id,readerId))throw new HTTPException(404,{message:'File is unavailable'})
 return new Response(object.body,{headers:{...mediaResponseHeaders(file.content_type,file.filename),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})
})
