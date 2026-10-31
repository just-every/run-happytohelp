import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken,requireActor} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {getTicket} from '../tickets/model'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {mediaResponseHeaders} from '../conversations/media-response'
import {macroAttachmentAvailableSql} from '../macros/attachments'
import {accessForContact} from '../knowledge/access'
import {listAccessibleArticles} from '../knowledge/experience'
import {auditStatement} from '../audit/record'
import {authoritySnapshotSql,deviceAuthority,mobileActor,retireDevice,scopePermissions,stillAuthorized,type MobileScope,type Device} from './authority'
import {frontierGuard,issueFrontier,loadFrontier} from './frontier'
import {mobileChange,mobileReply,objectBody} from './commands'
import {mobilePushRoutes} from './push-routes'
import {mobileApprovalRoutes} from './approval-routes'

export const offlinePolicy={customerCache:'memory-only',draftStorage:'memory-only',backgroundSend:false,purgeOn:['signout','revocation','authority-change','workspace-change','process-exit'],reconnect:'refresh-role-ticket-and-schedules-before-explicit-send'} as const
export const mobileRoutes=new Hono<AppEnv>()
mobileRoutes.use('*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('Pragma','no-cache');await next()})
mobileRoutes.post('/devices',async c=>{
 const actor=await requireActor(c),parent=c.get('sessionHash'),b=objectBody(await c.req.json())
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]||''
 if(actor.role==='contact'||!actor.projectId||token.startsWith('dev_'))throw new HTTPException(403,{message:'Sign in with a native operator account to pair a device'})
 if(!['ios','android'].includes(b.platform))throw new HTTPException(400,{message:'Choose iOS or Android'})
 const requested=b.scopes??['read']
 if(!Array.isArray(requested)||!requested.length||requested.length>Object.keys(scopePermissions).length||requested.some(s=>typeof s!=='string'||!Object.hasOwn(scopePermissions,s))||!requested.includes('read'))throw new HTTPException(400,{message:'Choose supported scopes including read'})
 const access=await memberAccess(c.env.DB,actor.projectId,actor.id),scopes=[...new Set(requested)] as MobileScope[]
 for(const scope of scopes){const permission=scopePermissions[scope];if(!access||permission&&!access.permissions.has(permission)||scope==='attachments'&&!['conversations.notes','conversations.reply'].some(p=>access.permissions.has(p as Permission)))throw new HTTPException(403,{message:'A requested scope exceeds your current role'})}
 const now=Date.now(),raw='mob_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),tokenHash=await hashToken(raw),id=crypto.randomUUID()
 const result=await c.env.DB.prepare(`INSERT INTO mobile_devices(id,token_hash,parent_session_hash,project_id,user_id,platform,scopes_json,authority_json,created_at,expires_at)
 SELECT ?,?,s.token_hash,s.project_id,s.actor_id,?,?,${authoritySnapshotSql()},?,min(s.expires_at,?) FROM sessions s JOIN memberships m ON m.project_id=s.project_id AND m.user_id=s.actor_id AND m.role=s.role
 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.project_id=?
 AND (SELECT count(*) FROM mobile_devices WHERE user_id=s.actor_id AND revoked_at IS NULL AND expires_at>?)<10`).bind(id,tokenHash,b.platform,JSON.stringify(scopes),now,now+86400000,parent,now,actor.projectId,now).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Session changed or ten devices are already active'})
 // Revalidate immediately before returning the only copy of the bearer token.
 const device=await c.env.DB.prepare('SELECT * FROM mobile_devices WHERE id=?').bind(id).first<Device>()
 await deviceAuthority(c.env,device!)
 await auditStatement(c.env.DB,{projectId:actor.projectId,category:'auth',action:'mobile.device_paired',actor:{type:'user',id:actor.id},source:'api',target:{type:'device',id},detail:{platform:b.platform,scopes}}).run()
 return c.json({id,token:raw,projectId:actor.projectId,scopes,expiresAt:device!.expires_at,offline:offlinePolicy},201)
})
mobileRoutes.get('/devices',async c=>{const a=await requireActor(c);if(a.role==='contact')throw new HTTPException(403);return c.json({devices:(await c.env.DB.prepare('SELECT id,platform,scopes_json,created_at,expires_at,revoked_at,push_enabled FROM mobile_devices WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').bind(a.projectId,a.id).all()).results})})
mobileRoutes.delete('/devices/:deviceId',async c=>{const a=await requireActor(c),d=await c.env.DB.prepare('SELECT id FROM mobile_devices WHERE id=? AND project_id=? AND user_id=?').bind(c.req.param('deviceId'),a.projectId,a.id).first<{id:string}>();if(!d)throw new HTTPException(404);await retireDevice(c.env,d.id);return c.json({revoked:true,purge:true})})
mobileRoutes.get('/session',async c=>{const a=await mobileActor(c);return c.json({deviceId:a.device.id,projectId:a.actor.projectId,scopes:JSON.parse(a.device.scopes_json),expiresAt:a.device.expires_at,offline:offlinePolicy})})
mobileRoutes.delete('/session',async c=>{const a=await mobileActor(c);await retireDevice(c.env,a.device.id);c.header('Mobile-Cache-Action','purge');return c.json({signedOut:true,purge:true})})
mobileRoutes.get('/tickets',async c=>{
 const a=await mobileActor(c)
 const rows=await c.env.DB.prepare(`SELECT c.id,c.subject,c.status_id,c.priority,c.assigned_to,c.group_id,c.revision,c.ticket_version,c.updated_at FROM conversations c WHERE c.project_id=? AND ${contactAvailableSql()} ORDER BY c.updated_at DESC,c.id LIMIT 100`).bind(a.actor.projectId).all()
 await stillAuthorized(c.env,a);return c.json({tickets:rows.results,limit:100})
})
mobileRoutes.get('/tickets/:ticketId',async c=>{
 const a=await mobileActor(c),id=c.req.param('ticketId'),ticket=await getTicket(c.env,a.actor,id)
 const [messages,notes,media]=await c.env.DB.batch<any>([
  c.env.DB.prepare('SELECT id,actor_id,actor_role,content,revision,created_at FROM messages WHERE conversation_id=? AND project_id=? ORDER BY revision DESC LIMIT 200').bind(id,a.actor.projectId),
  c.env.DB.prepare('SELECT id,user_id,content,created_at FROM conversation_notes WHERE conversation_id=? ORDER BY created_at DESC LIMIT 100').bind(id),
  c.env.DB.prepare(`SELECT m.id,m.message_id,m.filename,m.content_type,m.size,nm.note_id FROM media m LEFT JOIN conversation_note_media nm ON nm.media_id=m.id WHERE m.conversation_id=? AND m.project_id=? AND (m.message_id IS NOT NULL OR nm.note_id IS NOT NULL) LIMIT 300`).bind(id,a.actor.projectId),
 ])
 const frontier=await issueFrontier(c.env,a,id)
 // Never issue a frontier for a newer state than the transcript just read.
 if(frontier.revision!==ticket.revision||frontier.ticket_version!==ticket.ticket_version||frontier.last_message_id!==ticket.last_message_id)throw new HTTPException(409,{message:'Ticket changed while loading. Refresh it.'})
 await stillAuthorized(c.env,a)
 return c.json({ticket,messages:messages.results.reverse(),notes:notes.results,media:media.results,frontier:frontier.id,frontierExpiresAt:frontier.expires_at,schedules:JSON.parse(frontier.schedules_json),offline:offlinePolicy})
})
mobileRoutes.post('/tickets/:ticketId/reply',async c=>{const a=await mobileActor(c,'reply'),r=await mobileReply(c.env,a,c.req.param('ticketId'),objectBody(await c.req.json()));return c.json(r.data,r.status)})
for(const [tail,kind,scope] of [['notes','note','notes'],['assignment','assign','assign']] as const)mobileRoutes.post(`/tickets/:ticketId/${tail}`,async c=>{const a=await mobileActor(c,scope),r=await mobileChange(c.env,a,c.req.param('ticketId'),kind,objectBody(await c.req.json()));return c.json(r.data,r.status)})
mobileRoutes.post('/tickets/:ticketId/attachments',async c=>{
 const a=await mobileActor(c,'attachments'),ticketId=c.req.param('ticketId'),f=await loadFrontier(c.env,a,ticketId,c.req.header('Mobile-Frontier')),guard=frontierGuard(a,f)
 if(Number(c.req.header('Content-Length'))>20000000)throw new HTTPException(413)
 const bytes=await c.req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>20000000)throw new HTTPException(413)
 const id=crypto.randomUUID(),key=`${a.actor.projectId}/${ticketId}/${id}`,filename=c.req.header('X-Filename')||'attachment',type=c.req.header('Content-Type')||'application/octet-stream'
 if(filename.length>500||type.length>200)throw new HTTPException(400)
 await c.env.FILES.put(key,bytes,{httpMetadata:{contentType:type}})
 try{const r=await c.env.DB.prepare(`INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(id,a.actor.projectId,ticketId,a.actor.id,key,filename,type,bytes.byteLength,Date.now(),...guard.params).run();if(!r.meta.changes)throw new HTTPException(409,{message:'Ticket or device authority changed'})}catch(error){await c.env.FILES.delete(key);throw error}
 return c.json({id,filename,contentType:type,size:bytes.byteLength},201)
})
mobileRoutes.get('/tickets/:ticketId/attachments/:mediaId',async c=>{
 const a=await mobileActor(c),ticketId=c.req.param('ticketId')
 const m=await c.env.DB.prepare(`SELECT media.object_key,media.filename,media.content_type FROM media JOIN conversations c ON c.id=media.conversation_id AND c.project_id=media.project_id WHERE media.id=? AND c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND ${macroAttachmentAvailableSql()} AND (media.message_id IS NOT NULL OR media.uploaded_by=? OR EXISTS(SELECT 1 FROM conversation_note_media WHERE media_id=media.id))`).bind(c.req.param('mediaId'),ticketId,a.actor.projectId,a.actor.id).first<{object_key:string;filename:string;content_type:string}>()
 if(!m)throw new HTTPException(404)
 const object=await c.env.FILES.get(m.object_key);if(!object)throw new HTTPException(404)
 await stillAuthorized(c.env,a);return new Response(object.body,{headers:{...mediaResponseHeaders(m.content_type,m.filename),'Cache-Control':'no-store'}})
})
mobileRoutes.get('/tickets/:ticketId/knowledge',async c=>{
 const a=await mobileActor(c,'knowledge'),ticket=await getTicket(c.env,a.actor,c.req.param('ticketId'))
 const articles=await listAccessibleArticles(c.env,a.actor.projectId,{access:await accessForContact(c.env,a.actor.projectId,ticket.contact_id),query:(c.req.query('q')||'').slice(0,200),locale:c.req.query('locale')})
 await stillAuthorized(c.env,a);return c.json({articles})
})
mobileRoutes.route('/',mobilePushRoutes)
mobileRoutes.route('/',mobileApprovalRoutes)
