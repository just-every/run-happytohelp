import {Buffer} from 'node:buffer'
import {workflowNow,workflowEnvironment} from '../workflows/clock'
import {widgetConversationState} from '../widget/conversation-state'
import {trackingStatement,resolutionState,publishResolution} from '../outcomes/state'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv,Env,Actor } from '../../platform/env'
import { requireActor,requireProject } from '../../platform/auth'
import { requiredString,id } from '../../platform/db'
import { admitMessage,reservedLocalId } from './admission'
import { attachInboundOrigins } from '../integrations/inbound-origin'
import { clientAddress,enforceRateLimits } from '../../platform/rate-limits'
import { mediaResponseHeaders } from './media-response'
import {messageData} from '../management/dashboard-data'
import {customerTicket} from '../tickets/customer'
import type {DeferEmailDelivery} from '../integrations/email'
import {customerMergeTarget,assertWritableConversation} from '../conversation-actions/merge-read'
import {macroAttachmentAvailableSql} from '../macros/attachments'
import {stageEmailMessageOptions} from '../integrations/email-command-options'
/** `responderReady` says whether an assistant's model can reach its provider. Without it every default assistant is assigned. */
export function createConversationRoutes(onCommittedMessage?:(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery)=>Promise<unknown>,responderReady?:(env:Env,model:string)=>boolean){
const routes=new Hono<AppEnv>()
// The project's default assistant for this contact: the signed-in default for a verified contact, else the visitor default.
const defaultResponderSql="SELECT a.id,a.model FROM ai_profiles a JOIN project_settings s ON s.project_id=a.project_id WHERE s.project_id=? AND a.is_enabled=1 AND a.id=COALESCE((SELECT CASE WHEN ct.is_verified=1 THEN json_extract(s.settings_json,'$.default_verified_user_ai_id') ELSE json_extract(s.settings_json,'$.default_visitor_ai_id') END FROM contacts ct WHERE ct.id=? AND ct.project_id=s.project_id),json_extract(s.settings_json,'$.default_responder'))"
/** A default assistant answers a new conversation only when its provider is ready. Without a key the conversation
 * stays with the humans: no automatic reply is requested, so none fails. An explicit request for AI still fails explicitly. */
async function readyResponder(env:Env,projectId:string,contactId:string){const responder=await env.DB.prepare(defaultResponderSql).bind(projectId,contactId).first<{id:string;model:string}>();return responder&&(!responderReady||responderReady(env,responder.model))?responder.id:null}
async function access(c:any){const actor=await requireActor(c);const conversation=await c.env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(c.req.param('id'),actor.projectId).first();if(!conversation||(actor.role==='contact'&&conversation.contact_id!==actor.contactId))throw new HTTPException(404);return {actor,conversation}}
routes.get('/',async c=>{const actor=await requireActor(c);const rows=await c.env.DB.prepare(`SELECT * FROM conversations WHERE project_id=? ${actor.role==='contact'?'AND contact_id=?':''} ORDER BY updated_at DESC LIMIT 200`).bind(actor.projectId,...(actor.role==='contact'?[actor.contactId!]:[])).all();return c.json({conversations:actor.role==='contact'?rows.results.map(customerTicket):rows.results})})
routes.post('/',async c=>{const b=await c.req.json();const actor=await requireProject(c,requiredString(b.projectId,'projectId'));const contactId=actor.role==='contact'?actor.contactId:requiredString(b.contactId,'contactId');if(actor.role==='contact')await enforceRateLimits(c.env,[['conversationsPerContactHour',contactId!],['conversationsPerIpHour',`${actor.projectId}|${clientAddress(c.req)}`],['conversationsPerProjectHour',actor.projectId]]);const now=workflowNow(await workflowEnvironment(c.env)),conversationId=id(),responder=await readyResponder(c.env,actor.projectId,contactId!);const result=await c.env.DB.batch([c.env.DB.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source) SELECT ?,project_id,id,?,?,?,?,?,?,? FROM contacts WHERE id=? AND project_id=?').bind(conversationId,now,now,actor.id,actor.role==='contact'?'contact':'agent',actor.id,actor.role==='contact'?'contact':'user',actor.role==='contact'?'widget':'dashboard',contactId!,actor.projectId),...(responder?[c.env.DB.prepare(`INSERT INTO conversation_ai(conversation_id,ai_id) SELECT ?,responder.id FROM (${defaultResponderSql}) responder WHERE responder.id=? AND EXISTS(SELECT 1 FROM conversations WHERE id=?)`).bind(conversationId,actor.projectId,contactId!,responder,conversationId)]:[]),trackingStatement(c.env,conversationId,true)]);if(!result[0].meta.changes)throw new HTTPException(404);const created=await c.env.DB.prepare('SELECT * FROM conversations WHERE id=?').bind(conversationId).first();return c.json(actor.role==='contact'?customerTicket(created):created,201)})
routes.get('/:id',async c=>{const {actor,conversation}=await access(c);return c.json(actor.role==='contact'?customerTicket(conversation):conversation)})
// The original email body (content_raw) is operator-only transcript data; customer sessions never receive it.
routes.get('/:id/messages',async c=>{const {actor,conversation}=await access(c);const [messages,media]=await c.env.DB.batch<any>([
 c.env.DB.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY revision').bind(conversation.id),
 c.env.DB.prepare('SELECT id,message_id,filename,content_type,size FROM media WHERE conversation_id=? AND message_id IS NOT NULL').bind(conversation.id)
 ]);const byMessage=new Map<string,any[]>();for(const {message_id,...item} of media.results){const key=String(message_id);if(!byMessage.has(key))byMessage.set(key,[]);byMessage.get(key)!.push(item)}for(const message of messages.results){if(actor.role==='contact')delete message.content_raw;message.media=byMessage.get(String(message.id))||[]}
 // Inbound email carries its origin, so an automatic notice that earned no reply is visible as such.
 await attachInboundOrigins(c.env,String(conversation.project_id),messages.results as any[])
 const mergedInto=actor.role==='contact'?await customerMergeTarget(c.env,actor.projectId,conversation.id,actor.contactId||actor.id):null
 return c.json({...(actor.role==='contact'?{widget:await widgetConversationState(c.env,actor.projectId,String(conversation.id),actor.contactId!)}:{}),...(mergedInto?{mergedInto}:{}),messages:messages.results,revision:conversation.revision,lastMessageId:conversation.last_message_id,resolution:await resolutionState(c.env,String(conversation.project_id),String(conversation.id))})})
routes.post('/:id/messages',async c=>{
 const started=performance.now(),{actor,conversation}=await access(c),accessed=performance.now(),b=await c.req.json()
 // `email:` local ids identify inbound email claims; a client may not mint one to
 // pre-empt an inbound message's admission or borrow its classification. `erased:`
 // ids are written by contact erasure and must stay unique within a conversation.
 if(reservedLocalId(b?.localId))throw new HTTPException(400,{message:'Reserved local id prefix'})
 if(actor.role==='contact')await enforceRateLimits(c.env,[['messagesPerConversationMinute',conversation.id],['messagesPerContactHour',actor.contactId!]])
 await stageEmailMessageOptions(c.env,actor,conversation,b)
 const admitting=performance.now(),result=await admitMessage(c.env,{...b,actor,projectId:actor.projectId,conversationId:conversation.id,generationId:undefined,sessionHash:c.get('sessionHash')}),admitted=performance.now()
 let generationError:string|undefined
 // Operator replies acknowledge only after notification preparation and the
 // durable sending claim. Retain the actual provider attempt through settlement;
 // its persisted outcome drives the existing transcript mail status.
 const defer:DeferEmailDelivery|undefined=actor.role==='contact'?undefined:delivery=>{
  c.executionCtx.waitUntil((async()=>{
   try{await delivery}catch{console.error('Conversation notification delivery failed; durable status retained')}
   await Promise.all([conversation.id,`project:${actor.projectId}`].map(key=>c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'})))
  })().catch(()=>{console.error('Conversation notification status broadcast failed')}))
 }
 if(result.accepted&&!result.duplicate&&onCommittedMessage){try{await onCommittedMessage(c.env,result.message!,actor,defer)}catch(error){generationError=error instanceof Error?error.message:String(error)}}
 const effected=performance.now()
 const committedId=String(result.message?.conversation_id??conversation.id)
 if(result.accepted)c.executionCtx.waitUntil(Promise.all([publishResolution(c.env,actor.projectId,committedId),...[committedId,`project:${actor.projectId}`].map(key=>c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'}))]))
 const dashboardMessage=result.accepted&&actor.role!=='contact'?await messageData(c.env,result.message!):undefined,hydrated=performance.now()
 c.header('Server-Timing',`access;dur=${(accessed-started).toFixed(1)},admission;dur=${(admitted-admitting).toFixed(1)},effects;dur=${(effected-admitted).toFixed(1)},hydrate;dur=${(hydrated-effected).toFixed(1)}`)
 return c.json({...result,...(dashboardMessage?{dashboardMessage}:{}),...(generationError?{generationError}: {})},result.accepted?200:409)
})
// Visitor quotas are checked after the bounded body is read, so a 429 is delivered intact rather than as an unread-upload 413.
routes.post('/:id/media',async c=>{const {actor,conversation}=await access(c);await assertWritableConversation(c.env,actor.projectId,conversation.id);const declared=Number(c.req.header('Content-Length'));if(declared>20000000)throw new HTTPException(413);const data=await c.req.arrayBuffer();if(!data.byteLength||data.byteLength>20000000)throw new HTTPException(413);if(actor.role==='contact')await enforceRateLimits(c.env,[['uploadsPerContactDay',actor.contactId!],['uploadBytesPerContactDay',actor.contactId!,data.byteLength],['uploadsPerProjectDay',actor.projectId],['uploadBytesPerProjectDay',actor.projectId,data.byteLength]]);const mediaId=id(),key=`${actor.projectId}/${conversation.id}/${mediaId}`,filename=c.req.header('X-Filename')||'attachment',contentType=c.req.header('Content-Type')||'application/octet-stream';await c.env.FILES.put(key,data,{httpMetadata:{contentType}});try{await c.env.DB.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,?,NULL,?)').bind(mediaId,actor.projectId,conversation.id,actor.id,key,filename,contentType,data.byteLength,Date.now()).run()}catch(error){await c.env.FILES.delete(key);throw error}return c.json({id:mediaId,filename,contentType,size:data.byteLength},201)})
routes.get('/:id/media/:mediaId',async c=>{const {actor,conversation}=await access(c);const row=await c.env.DB.prepare(`SELECT * FROM media WHERE id=? AND conversation_id=? AND ${macroAttachmentAvailableSql()} AND (?<>'contact' OR (message_id IS NOT NULL OR uploaded_by=?) AND NOT EXISTS(SELECT 1 FROM conversation_note_media nm WHERE nm.media_id=media.id) AND NOT EXISTS(SELECT 1 FROM move_in_attachment_bytes a WHERE a.media_id=media.id AND a.note_id IS NOT NULL))`).bind(c.req.param('mediaId'),conversation.id,actor.role,actor.id).first<{object_key:string;filename:string;content_type:string}>();if(!row)throw new HTTPException(404);const supplied=await c.env.DB.prepare('SELECT base64 FROM move_in_attachment_bytes WHERE media_id=? AND project_id=? AND conversation_id=?').bind(c.req.param('mediaId'),actor.projectId,conversation.id).first<{base64:string}>();if(supplied)return new Response(Buffer.from(supplied.base64,'base64'),{headers:mediaResponseHeaders(row.content_type,row.filename)});const object=await c.env.FILES.get(row.object_key);if(!object)throw new HTTPException(404);return new Response(object.body,{headers:mediaResponseHeaders(row.content_type,row.filename)})})
routes.get('/:id/socket',async c=>{const token=c.req.query('token');const {actor,conversation}=await access(c);const origin=c.req.header('Origin');const project=await c.env.DB.prepare('SELECT allowed_origin FROM projects WHERE id=?').bind(actor.projectId).first<{allowed_origin:string}>();if(origin&&origin!==new URL(c.req.url).origin&&origin!==project?.allowed_origin)throw new HTTPException(403);const headers=new Headers(c.req.raw.headers);headers.delete('X-Project-Id');headers.set('X-Conversation-Id',conversation.id);headers.set('X-Session-Token',token||c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]||'');headers.set('X-Actor-Id',actor.id);return c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(conversation.id)).fetch(new Request(c.req.raw,{headers}))})

return routes
}
export const routes=createConversationRoutes()

export const projectSocketRoutes=new Hono<AppEnv>()
projectSocketRoutes.get('/:projectId/socket',async c=>{const actor=await requireActor(c);const projectId=c.req.param('projectId');if(actor.role==='contact'||!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(projectId,actor.id).first())throw new HTTPException(403);const origin=c.req.header('Origin');if(origin&&origin!==new URL(c.req.url).origin)throw new HTTPException(403);const token=c.req.query('token')||c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1];const headers=new Headers(c.req.raw.headers);headers.delete('X-Conversation-Id');headers.set('X-Project-Id',projectId);headers.set('X-Session-Token',token!);return c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(`project:${projectId}`)).fetch(new Request(c.req.raw,{headers}))})
