import {batchTicket,admitTicketWork,batchRead,batchTicketIds} from '../tickets/request-batch'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {availableTicketSql,getTicket,ticketAuthority,type TicketAuthority} from '../tickets/model'
import {dispatchFollowerChange} from '../collaboration/followers'
import {publishActivity} from '../conversations/activity'
import {publishResolution} from '../outcomes/state'
import {assertMacroFieldsReadable} from './read-access'
import {readMacro} from './store'
import {notifyTicketEvent} from '../integrations/triggers'
import {dispatchRequestAssignment} from '../integrations/notification-request'
import {prepareMacro,type MacroSelection} from './preview'
import {ticketStatements} from './commit'
import {copyAttachments,attachmentStatements,macroAttachmentAvailableSql} from './attachments'
export async function applyMacro(env:Env,actor:Actor,macroId:string,version:number,selected:MacroSelection,commandId:string,authority:TicketAuthority){
 await ticketAuthority(env,actor,authority,'conversations.reply');await ticketAuthority(env,actor,authority)
 const ticket=batchTicket(env,selected.id)??await getTicket(env,actor,selected.id);await readMacro(env,actor,macroId,ticket.brand_id??actor.projectId)
 const ids=batchTicketIds(env)
 const prior=await batchRead(env,`uses:${actor.projectId}:${actor.id}:${commandId}`,async()=>(await env.DB.prepare('SELECT * FROM macro_usage WHERE project_id=? AND actor_id=? AND command_id=? AND conversation_id IN (SELECT value FROM json_each(?))').bind(actor.projectId,actor.id,commandId,JSON.stringify(ids.length?ids:[selected.id])).all<any>()).results)
 const duplicate=prior.find(row=>row.conversation_id===selected.id)
 if(duplicate){if(duplicate.macro_id!==macroId||duplicate.version!==version)throw new HTTPException(409,{message:'This command was already used for a different macro'});return {id:selected.id,status:'duplicate',usage_id:duplicate.id,committed:true,draft:null}}
 const plan=await prepareMacro(env,actor,macroId,version,selected,authority,false),{prepared,macroGuard,replyGuard,followerPlan}=plan,{current,guard,predicates,params}=prepared
 admitTicketWork(env,40+Object.keys(prepared.fields).length+(prepared.change.tags_add?.length??0)+(prepared.change.tags_remove?.length??0)+plan.media.length*2)
 const {copies,cleanup}=await copyAttachments(env,actor,selected.id,plan.media),usage=crypto.randomUUID(),now=Math.max(Date.now(),current.updated_at+1),accepted='EXISTS(SELECT 1 FROM macro_usage WHERE id=?)'
 const guards=[`EXISTS(${guard.sql})`,`EXISTS(${replyGuard.sql})`,`EXISTS(${macroGuard.sql})`,...predicates]
 const args:any[]=[...guard.params,...replyGuard.params,...macroGuard.params,...params]
 if(followerPlan){guards.push(`EXISTS(${followerPlan.guard.sql})`);args.push(...followerPlan.guard.params)}
 const statements=[env.DB.prepare(`INSERT INTO macro_usage(id,project_id,macro_id,version,conversation_id,actor_id,command_id,created_at) SELECT ?,c.project_id,?,?,c.id,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.ticket_version=? AND c.updated_at=? AND c.revision=? AND c.last_message_id IS ? AND c.status_category<>'closed' AND ${availableTicketSql()} AND ${guards.join(' AND ')}`).bind(usage,macroId,version,actor.id,commandId,now,current.id,actor.projectId,current.ticket_version,current.updated_at,current.revision,current.last_message_id,...args),
 ...(Object.keys(plan.macro.actions).some(key=>!['reply_type','attachments'].includes(key))?ticketStatements(env,actor,prepared,usage,now):[]),...attachmentStatements(env,copies,accepted,[usage]),
 env.DB.prepare(`INSERT INTO macro_drafts(project_id,conversation_id,actor_id,usage_id,content,reply_type,unresolved_json,media_ids_json,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${accepted} ON CONFLICT(project_id,conversation_id,actor_id) DO UPDATE SET usage_id=excluded.usage_id,content=excluded.content,reply_type=excluded.reply_type,unresolved_json=excluded.unresolved_json,media_ids_json=excluded.media_ids_json,updated_at=excluded.updated_at`).bind(actor.projectId,current.id,actor.id,usage,plan.rendered.text,plan.macro.actions.reply_type??'public',JSON.stringify(plan.rendered.unresolved),JSON.stringify(copies.map(row=>row.id)),now,usage),
 ...(followerPlan?.statements('SELECT 1 FROM macro_usage WHERE id=?',[usage])??[])]
 admitTicketWork(env,statements.length+24)
 let committed=false
 try{const result=await env.DB.batch(statements);committed=Boolean(result[0].meta.changes);if(!committed)throw new HTTPException(409,{message:'Ticket, macro, fields or permissions changed. Review a new preview.'})}
 catch(error){
  // A lost batch response can follow a committed transaction. Read the durable
  // receipt before deleting copied objects; never delete admitted attachments.
  try{committed=Boolean(await env.DB.prepare('SELECT 1 FROM macro_usage WHERE id=?').bind(usage).first())}catch{throw new HTTPException(503,{message:'Macro outcome could not be confirmed. Reload before trying again.'})}
  if(!committed){await cleanup();throw error}
 }
 // Stored drafts are never sent, including in bulk. Failure after commit is explicit
 // and must not invite replay of an operation with an unknown delivery result.
 if(current.assigned_to!==prepared.next.assigned_to)await dispatchRequestAssignment(env,actor.projectId,current.id)
 let refresh_error=false
 try{await publishActivity(env,actor.projectId,current.id,'macro');if(Object.keys(plan.macro.actions).some(key=>!['reply_type','attachments'].includes(key)))await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:current.id,event:'ticket_updated',eventId:usage,actorId:actor.id,source:'native'});if(current.status_id!==prepared.next.status_id)await publishResolution(env,actor.projectId,current.id);if(prepared.current.group_id!==prepared.next.group_id&&prepared.next.group_id&&!prepared.next.assigned_to){const members=(await env.DB.prepare('SELECT user_id FROM ticket_group_members WHERE project_id=? AND group_id=?').bind(actor.projectId,prepared.next.group_id).all<any>()).results.map(m=>m.user_id);await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:current.id,event:'group',eventId:usage,actorId:actor.id,recipientIds:members,source:'native'})};if(followerPlan)await dispatchFollowerChange(env,actor,current.id,followerPlan,usage)}catch(error){console.error('Macro committed; refresh failed',error);refresh_error=true}
 return {id:selected.id,status:'applied',committed:true,usage_id:usage,...(refresh_error?{refresh_error:true}:{}),draft:{content:plan.rendered.text,reply_type:plan.macro.actions.reply_type??'public',unresolved:plan.rendered.unresolved,media_ids:copies.map(row=>row.id),media:copies.map(({id,filename,content_type,size})=>({id,filename,content_type,size}))}}
}
/** Only the named use's draft goes: a newer macro applied meanwhile stays. */
export async function discardDraft(env:Env,actor:Actor,conversationId:string,usageId:unknown){
 if(typeof usageId!=='string'||!usageId||usageId.length>200)throw new HTTPException(400,{message:'Name the macro draft to discard'})
 const result=await env.DB.prepare('DELETE FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=? AND usage_id=?').bind(actor.projectId,conversationId,actor.id,usageId).run()
 return result.meta.changes>0
}
export async function readDraft(env:Env,actor:Actor,conversationId:string,usageId?:string){
 const row=await env.DB.prepare(`SELECT * FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=? ${usageId?'AND usage_id=?':''}`).bind(actor.projectId,conversationId,actor.id,...(usageId?[usageId]:[])).first<any>()
 if(row){const usage=await env.DB.prepare('SELECT macro_id,version FROM macro_usage WHERE id=? AND actor_id=? AND project_id=?').bind(row.usage_id,actor.id,actor.projectId).first<any>();if(!usage)throw new HTTPException(404);await readMacro(env,actor,usage.macro_id);const definition=await env.DB.prepare('SELECT content,actions_json FROM macro_versions WHERE macro_id=? AND version=? AND project_id=?').bind(usage.macro_id,usage.version,actor.projectId).first<any>();if(!definition)throw new HTTPException(404);await assertMacroFieldsReadable(env,actor,definition)}
 if(!row)return null
 const media=(await env.DB.prepare(`SELECT media.id,media.filename,media.content_type,media.size FROM media WHERE media.project_id=? AND media.conversation_id=? AND media.uploaded_by=? AND media.id IN(SELECT value FROM json_each(?)) AND ${macroAttachmentAvailableSql()}`).bind(actor.projectId,conversationId,actor.id,row.media_ids_json).all<any>()).results
 return {content:row.content,reply_type:row.reply_type,unresolved:JSON.parse(row.unresolved_json),media_ids:media.map(m=>m.id),media,usage_id:row.usage_id}
}
