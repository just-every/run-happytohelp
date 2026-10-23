import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Env,AppEnv,Actor} from '../../platform/env'
import {requireStepUp} from '../identity/two-factor/step-up'
import {mutateTicket} from '../tickets/mutate'
import {externalTicketAuthority} from '../tickets/model'
import {memberAccess} from '../access/gate'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {auditStatement} from '../audit/record'
import {publishActivity} from '../conversations/activity'
import {issuerGuard} from '../../platform/integration-authority'
import {connection,access,text,digest,prefix,liveConnection,type Connection} from './model'
import {inboundMedia,discardMedia} from './media'
import {syncSharedStatus} from './shared-sync'
import type {Inbound} from './protocol'
export const sharedRoutes=new Hono<AppEnv>()
sharedRoutes.post(prefix+'/connections/:id/link-code',async c=>{
 const actor=await access(c,'conversations.manage');await requireStepUp(c,actor,'support_channels.link');const row=await connection(c.env,c.req.param('id')!);if(row.project_id!==actor.projectId||!['slack','teams'].includes(row.provider))throw new HTTPException(404)
 const code=crypto.randomUUID(),guard=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const inserted=await c.env.DB.prepare(`INSERT INTO support_channel_link_codes SELECT ?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(await digest(code),row.id,actor.projectId,actor.id,c.get('sessionHash'),Date.now()+600000,...guard.params).run();if(!inserted.meta.changes)throw new HTTPException(409)
 return c.json({data:{code,expires_in:600,instruction:'Send “support link '+code+'” in a private message to the installed bot.'}},201)
})
sharedRoutes.delete(prefix+'/connections/:id/link-code',async c=>{const actor=await access(c);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM support_channel_members WHERE connection_id=? AND project_id=? AND user_id=?').bind(c.req.param('id'),actor.projectId,actor.id),c.env.DB.prepare('DELETE FROM support_channel_link_codes WHERE connection_id=? AND project_id=? AND user_id=?').bind(c.req.param('id'),actor.projectId,actor.id)]);return c.json({unlinked:true})})
sharedRoutes.put(prefix+'/connections/:id/accounts',async c=>{
 const actor=await access(c,'integrations.install'),row=await connection(c.env,c.req.param('id')!),b=await c.req.json();if(row.project_id!==actor.projectId||!['slack','teams'].includes(row.provider)||!JSON.parse(row.channels_json).includes(b.channel_id))throw new HTTPException(404)
 const company=text(b.company_id,'company ID');if(!await c.env.DB.prepare('SELECT 1 FROM companies WHERE id=? AND project_id=? AND merged_into IS NULL').bind(company,actor.projectId).first())throw new HTTPException(400,{message:'Choose an active company in this workspace'})
 const prior=await c.env.DB.prepare('SELECT company_id FROM support_channel_accounts WHERE connection_id=? AND channel_id=?').bind(row.id,b.channel_id).first<{company_id:string}>();if(prior&&prior.company_id!==company&&await c.env.DB.prepare('SELECT 1 FROM support_channel_threads WHERE connection_id=? AND channel_id=?').bind(row.id,b.channel_id).first())throw new HTTPException(409,{message:'Existing customer threads retain their account. Map a new customer channel for a different company.'})
 const guard=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const result=await c.env.DB.prepare(`INSERT INTO support_channel_accounts SELECT ?,?,?,? WHERE EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) ON CONFLICT(connection_id,channel_id) DO UPDATE SET company_id=excluded.company_id`).bind(row.id,actor.projectId,b.channel_id,company,...guard.params,row.id).run();if(!result.meta.changes)throw new HTTPException(409)
 await auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.account_mapped',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'support_channel',id:row.id}}).run();return c.json({mapped:true})
})
async function redeem(env:Env,row:Connection,event:Inbound,code:string){
 const hash=await digest(code),now=Date.now(),saved=await env.DB.prepare(`SELECT l.* FROM support_channel_link_codes l JOIN sessions s ON s.token_hash=l.session_hash AND s.actor_id=l.user_id AND s.revoked_at IS NULL AND s.expires_at>? JOIN memberships m ON m.user_id=l.user_id AND m.project_id=l.project_id WHERE l.token_hash=? AND l.connection_id=? AND l.expires_at>?`).bind(now,hash,row.id,now).first<any>()
 if(!saved)throw new HTTPException(403,{message:'Identity link expired or unavailable; create a new link in the inbox'})
 if(!(await memberAccess(env.DB,row.project_id,saved.user_id))?.permissions.has('conversations.manage'))throw new HTTPException(403)
 const guard=`EXISTS(SELECT 1 FROM support_channel_link_codes l JOIN sessions s ON s.token_hash=l.session_hash AND s.actor_id=l.user_id AND s.revoked_at IS NULL AND s.expires_at>? WHERE l.token_hash=? AND l.expires_at>?) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?) AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection})`,args=[now,hash,now,row.project_id,saved.user_id,row.id]
 await env.DB.batch([env.DB.prepare(`DELETE FROM support_channel_members WHERE connection_id=? AND user_id=? AND ${guard}`).bind(row.id,saved.user_id,...args),env.DB.prepare(`INSERT INTO support_channel_members SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(connection_id,provider_user) DO UPDATE SET user_id=excluded.user_id,linked_at=excluded.linked_at`).bind(row.id,event.sender,row.project_id,saved.user_id,now,...args),env.DB.prepare('DELETE FROM support_channel_link_codes WHERE token_hash=?').bind(hash)])
 return {linked:true}
}
export async function sharedEvent(env:Env,row:Connection,event:Inbound){
 if(!['slack','teams'].includes(row.provider))return null
 const link=/^support link ([a-f0-9-]{36})$/i.exec(event.text);if(link){if(!event.private)throw new HTTPException(403,{message:'Link identities only in a private message to the bot'});return redeem(env,row,event,link[1])}
 if(event.editId)return changeEvent(env,row,event)
 const mapped=await env.DB.prepare('SELECT l.user_id,m.role FROM support_channel_members l JOIN memberships m ON m.user_id=l.user_id AND m.project_id=l.project_id WHERE l.connection_id=? AND l.provider_user=? AND l.project_id=?').bind(row.id,event.sender,row.project_id).first<any>()
 const command=/^support (acknowledge|assign|handoff|status)(?: ([^\s]+))?$/i.exec(event.text)
 if(command&&!mapped)throw new HTTPException(403,{message:'Link your teammate identity privately before using support commands'})
 if(!mapped)return null
 const actor:Actor={id:mapped.user_id,role:mapped.role,projectId:row.project_id},permission=await memberAccess(env.DB,row.project_id,actor.id)
 if(!permission?.permissions.has(command?'conversations.manage':'conversations.reply'))throw new HTTPException(403)
 const t=await env.DB.prepare('SELECT t.*,c.revision,c.ticket_version FROM support_channel_threads t JOIN conversations c ON c.id=t.conversation_id WHERE t.connection_id=? AND t.channel_id=? AND t.thread_key=?').bind(row.id,event.channel,event.thread).first<any>()
 if(!t)throw new HTTPException(409,{message:'Reply inside an existing customer support thread'})
 const guard={sql:`EXISTS(SELECT 1 FROM support_channel_members l JOIN support_channel_connections x ON x.id=l.connection_id WHERE l.connection_id=? AND l.provider_user=? AND l.user_id=? AND l.project_id=? AND x.revoked_at IS NULL AND x.token_cipher IS NOT NULL AND ? IN (SELECT value FROM json_each(x.channels_json)))`,params:[row.id,event.sender,actor.id,row.project_id,event.channel]},receipt='shared:'+await digest(row.id+'|'+event.id)
 if(command){
  if(await env.DB.prepare('SELECT 1 FROM ticket_history WHERE id=?').bind(receipt).first())return {duplicate:true}
  if(command[1].toLowerCase()==='status'){await syncSharedStatus(env,row.project_id,t.conversation_id,receipt);return {status:true}}
  let target=actor.id
  if(command[1].toLowerCase()!=='acknowledge'){
   const providerUser=(command[2]||'').replace(/^<@|>$/g,'');const other=await env.DB.prepare('SELECT user_id FROM support_channel_members WHERE connection_id=? AND provider_user=? AND project_id=?').bind(row.id,providerUser,row.project_id).first<{user_id:string}>();if(!other)throw new HTTPException(400,{message:'Choose a teammate who linked their identity to this provider'});target=other.user_id
  }
  await mutateTicket(env,actor,t.conversation_id,{agent_id:target,status_id:'open',expected_ticket_version:t.ticket_version},{source:'system',[externalTicketAuthority]:guard},{projectId:row.project_id,category:'assignment',action:'support_channel.'+command[1].toLowerCase(),actor:{type:'user',id:actor.id},source:'system',target:{type:'conversation',id:t.conversation_id}},receipt)
  return {assigned:true,conversation_id:t.conversation_id}
 }
 const prior=await env.DB.prepare('SELECT id,content,actor_id FROM messages WHERE conversation_id=? AND local_id=?').bind(t.conversation_id,receipt).first<any>();if(prior){if(prior.actor_id!==actor.id||prior.content!==event.text)throw new HTTPException(409);return {duplicate:true}}
 // A linked teammate's provider reply is already in the external thread. Admit once, without echoing it back.
 const staged=await inboundMedia(env,row,{...t,contact_id:actor.id},event.media)
 let result;try{result=await admitMessage(env,{actor,projectId:row.project_id,conversationId:t.conversation_id,localId:receipt,content:event.text,mediaIds:staged.map(f=>f.id),expectedRevision:t.revision,authoring:{kind:'human'},requireAvailableRequester:true,[messageAuthority]:{sql:guard.sql,args:guard.params}})}catch(error){await discardMedia(env,staged);throw error}
 if(!result.accepted){await discardMedia(env,staged);}
 if(!result.accepted)throw new HTTPException(409)
 await env.DB.prepare("INSERT OR IGNORE INTO support_channel_sends VALUES(?,?,?,?,'delivered',NULL,?,?,?)").bind(result.message.id,row.project_id,t.conversation_id,row.id,event.providerMessageId??event.id,Date.now(),Date.now()).run()
 await publishActivity(env,row.project_id,t.conversation_id,'message');return {conversation_id:t.conversation_id,message_id:result.message.id}
}
async function changeEvent(env:Env,row:Connection,event:Inbound){
 if(!Number.isFinite(event.at)||!event.sender)throw new HTTPException(422,{message:'Provider edit/delete has no attributable author or timestamp; retain for review'})
 const original=await env.DB.prepare('SELECT e.message_id,t.conversation_id FROM support_channel_events e JOIN support_channel_threads t ON t.id=e.thread_id JOIN messages m ON m.id=e.message_id AND m.erased_at IS NULL WHERE e.connection_id=? AND e.provider_message_id=? AND e.sender_hash=? AND t.channel_id=?').bind(row.id,event.editId,await digest(event.sender),event.channel).first<any>()
 if(!original)return {held:true}
 await env.DB.prepare(`INSERT OR IGNORE INTO support_channel_changes SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) AND EXISTS(SELECT 1 FROM messages WHERE id=? AND erased_at IS NULL)`).bind(row.id,await digest(event.id),original.message_id,original.conversation_id,event.deleted?'deleted':'edited',event.deleted?'':event.text,Math.min(Date.now(),event.at!),row.id,original.message_id).run()
 await publishActivity(env,row.project_id,original.conversation_id,'message');return {recorded:true}
}
