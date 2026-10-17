import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {notifyTicketEvent} from '../integrations/triggers'
import {publishActivity} from '../conversations/activity'
import {collaborationGuard,memberIds,type CollaborationAuthority} from './authority'

export async function listFollowers(env:Env,projectId:string,conversationId:string){
 return (await env.DB.prepare('SELECT u.id,u.name FROM conversation_followers f JOIN conversations c ON c.id=f.conversation_id JOIN memberships m ON m.project_id=c.project_id AND m.user_id=f.user_id JOIN users u ON u.id=m.user_id WHERE c.id=? AND c.project_id=? ORDER BY f.created_at,u.id').bind(conversationId,projectId).all<{id:string;name:string}>()).results
}
/** Exact internal-CC replacement. Embed guard in the caller's receipt to make the whole operation atomic. */
export async function prepareFollowerChange(env:Env,actor:Actor,conversationId:string,userIds:unknown,authority:CollaborationAuthority){
 const ids=memberIds(userIds),guard=await collaborationGuard(env,actor,conversationId,ids,authority,'conversations.manage')
 const before=await listFollowers(env,actor.projectId,conversationId),addedIds=ids.filter(id=>!before.some(row=>row.id===id))
 return {guard,userIds:ids,addedIds,statements(receiptGuardSql:string,receiptParams:unknown[]=[]){
  const condition=`EXISTS(${receiptGuardSql}) AND EXISTS(${guard.sql})`,params=[...receiptParams,...guard.params],now=Date.now()
  return [
   env.DB.prepare(`DELETE FROM conversation_followers WHERE conversation_id=? AND user_id NOT IN (SELECT value FROM json_each(?)) AND ${condition}`).bind(conversationId,JSON.stringify(ids),...params),
   env.DB.prepare(`INSERT OR IGNORE INTO conversation_followers(conversation_id,user_id,created_at) SELECT ?,value,? FROM json_each(?) WHERE ${condition}`).bind(conversationId,now,JSON.stringify(ids),...params),
   env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','conversation.followers_changed','succeeded','user',?,?,'conversation',?,? WHERE ${condition}`).bind(crypto.randomUUID(),actor.projectId,now,actor.id,authority.source??'dashboard',conversationId,JSON.stringify({userIds:ids}),...params),
  ]
 }}
}
export async function dispatchFollowerChange(env:Env,actor:Actor,conversationId:string,plan:{addedIds:string[]},eventId:string){
 await publishActivity(env,actor.projectId,conversationId,'followers')
 if(plan.addedIds.length)await notifyTicketEvent(env,{projectId:actor.projectId,conversationId,event:'follower',eventId,actorId:actor.id,recipientIds:plan.addedIds,source:'native'})
}
export async function setFollowers(env:Env,actor:Actor,conversationId:string,userIds:unknown,authority:CollaborationAuthority){
 const plan=await prepareFollowerChange(env,actor,conversationId,userIds,authority),eventId=crypto.randomUUID()
 // An audit receipt binds every statement and detects a lost authority race without partial writes.
 const receiptSql='SELECT 1 FROM audit_events WHERE id=?'
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','conversation.followers_requested','succeeded','user',?,?,'conversation',?,'{}' WHERE EXISTS(${plan.guard.sql})`).bind(eventId,actor.projectId,Date.now(),actor.id,authority.source??'dashboard',conversationId,...plan.guard.params),
  ...plan.statements(receiptSql,[eventId]),
 ])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Conversation access changed. Reload and try again.'})
 await dispatchFollowerChange(env,actor,conversationId,plan,eventId)
 return listFollowers(env,actor.projectId,conversationId)
}
/** Existing R8 follow routes can use this, preserving the collaborator's self-only action. */
export async function setSelfFollowing(env:Env,actor:Actor,conversationId:string,following:boolean,authority:CollaborationAuthority){
 const guard=await collaborationGuard(env,actor,conversationId,[actor.id],authority,'conversations.follow'),now=Date.now(),eventId=crypto.randomUUID()
 const write=following
  ?env.DB.prepare(`INSERT OR IGNORE INTO conversation_followers(conversation_id,user_id,created_at) SELECT ?,?,? WHERE EXISTS(${guard.sql})`).bind(conversationId,actor.id,now,...guard.params)
  :env.DB.prepare(`DELETE FROM conversation_followers WHERE conversation_id=? AND user_id=? AND EXISTS(${guard.sql})`).bind(conversationId,actor.id,...guard.params)
 const result=await env.DB.batch([write,env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,?,'conversation',?,'{}' WHERE changes()>0`).bind(eventId,actor.projectId,now,following?'conversation.followed':'conversation.unfollowed',actor.id,authority.source??'dashboard',conversationId)])
 if(!await env.DB.prepare(guard.sql).bind(...guard.params).first())throw new HTTPException(409,{message:'Conversation access changed. Reload and try again.'})
 if(result[0].meta.changes)await dispatchFollowerChange(env,actor,conversationId,{addedIds:following?[actor.id]:[]},eventId)
 return listFollowers(env,actor.projectId,conversationId)
}
