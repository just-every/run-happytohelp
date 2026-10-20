import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {Actor,AppEnv,Env} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import {availableTicketSql,named,object,ticketAuthority} from '../tickets/model'

export const timerRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/conversations/:conversationId/timer'
async function timerScope(c:Context<AppEnv>){
 const actor=await scope(c) as Actor,access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access||access.base==='collaborator'||!access.permissions.has('conversations.manage'))throw new HTTPException(403,{message:'Ticket management permission is required to use handle timers'})
 const id=c.req.param('conversationId')!,ticket=await c.env.DB.prepare(`SELECT c.status_category FROM conversations c WHERE c.project_id=? AND c.id=? AND ${availableTicketSql()}`).bind(actor.projectId,id).first<{status_category:string}>()
 if(!ticket)throw new HTTPException(404)
 return {actor,id,ticket,access}
}
export async function readTimer(env:Env,projectId:string,conversationId:string,userId:string,now=Date.now()){
 const [sessions,total]=await Promise.all([
  env.DB.prepare('SELECT id,user_id,started_at,ended_at,adjusted_duration_ms,adjustment_reason FROM ticket_handle_sessions WHERE project_id=? AND conversation_id=? ORDER BY started_at DESC,id DESC LIMIT 100').bind(projectId,conversationId).all<{id:string;user_id:string;started_at:number;ended_at:number|null;adjusted_duration_ms:number|null;adjustment_reason:string|null}>(),
  env.DB.prepare('SELECT COALESCE(SUM(coalesce(adjusted_duration_ms,max(0,coalesce(ended_at,?)-started_at))),0) ticketTotalMs,COALESCE(SUM(CASE WHEN user_id=? THEN coalesce(adjusted_duration_ms,max(0,coalesce(ended_at,?)-started_at)) ELSE 0 END),0) totalMs,(SELECT id FROM ticket_handle_sessions WHERE project_id=? AND conversation_id=? AND user_id=? AND ended_at IS NULL) runningId FROM ticket_handle_sessions WHERE project_id=? AND conversation_id=?').bind(now,userId,now,projectId,conversationId,userId,projectId,conversationId).first<{ticketTotalMs:number;totalMs:number;runningId:string|null}>(),
 ])
 return {sessions:sessions.results,running:total?.runningId??null,totalMs:total?.totalMs??0,ticketTotalMs:total?.ticketTotalMs??0,now,userId}
}
timerRoutes.get(path,async c=>{const {actor,id,access}=await timerScope(c);return c.json({...await readTimer(c.env,actor.projectId,id,actor.id),canAdjustOthers:['owner','admin'].includes(access.base)})})
timerRoutes.post(`${path}/start`,async c=>{
 const {actor,id,ticket,access}=await timerScope(c)
 if(['solved','closed'].includes(ticket.status_category))throw new HTTPException(409,{message:'Reopen the ticket before starting a handle timer'})
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')}),now=Date.now()
 await c.env.DB.prepare(`INSERT OR IGNORE INTO ticket_handle_sessions(id,project_id,conversation_id,user_id,started_at) SELECT ?,c.project_id,c.id,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.status_category NOT IN ('solved','closed') AND ${availableTicketSql()} AND EXISTS(${guard.sql})`).bind(crypto.randomUUID(),actor.id,now,id,actor.projectId,...guard.params).run()
 const result=await readTimer(c.env,actor.projectId,id,actor.id)
 if(!result.running)throw new HTTPException(409,{message:'The ticket or your access changed. Reload before starting the timer.'})
 return c.json({...result,canAdjustOthers:['owner','admin'].includes(access.base)})
})
// A member stops their own running timer. A lead (owner or admin) stops a teammate's only by naming
// its session, as /adjust does; the stop records who made it (migration 205).
timerRoutes.post(`${path}/stop`,async c=>{
 const {actor,id,access}=await timerScope(c),b=object(await c.req.json()),sessionId=b.sessionId===undefined?null:named(b.sessionId,200)
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')}),lead=['owner','admin'].includes(access.base)
 const target=sessionId===null?{sql:'user_id=?',params:[actor.id]}:{sql:'id=? AND (user_id=? OR ?=1)',params:[sessionId,actor.id,Number(lead)]}
 const result=await c.env.DB.prepare(`UPDATE ticket_handle_sessions SET ended_at=max(started_at,?),ended_by=? WHERE project_id=? AND conversation_id=? AND ${target.sql} AND ended_at IS NULL AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=ticket_handle_sessions.conversation_id AND c.project_id=ticket_handle_sessions.project_id AND ${availableTicketSql()})`).bind(Date.now(),actor.id,actor.projectId,id,...target.params,...guard.params).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'No running timer to stop. Reload to see the current timer.'})
 return c.json({...await readTimer(c.env,actor.projectId,id,actor.id),canAdjustOthers:['owner','admin'].includes(access.base)})
})

timerRoutes.post(`${path}/adjust`,async c=>{
 const {actor,id,access}=await timerScope(c),b=object(await c.req.json()),sessionId=named(b.sessionId,200),reason=named(b.reason,1000)
 if(!Number.isSafeInteger(b.durationMs)||b.durationMs<0||b.durationMs>366*86400000)throw new HTTPException(400,{message:'Enter a duration between zero and 366 days'})
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')}),lead=['owner','admin'].includes(access.base)
 const result=await c.env.DB.prepare(`UPDATE ticket_handle_sessions SET adjusted_duration_ms=?,adjustment_reason=?,adjusted_by=?,adjusted_at=? WHERE id=? AND project_id=? AND conversation_id=? AND ended_at IS NOT NULL AND (user_id=? OR ?=1) AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=ticket_handle_sessions.conversation_id AND c.project_id=ticket_handle_sessions.project_id AND ${availableTicketSql()})`).bind(b.durationMs,reason,actor.id,Date.now(),sessionId,actor.projectId,id,actor.id,Number(lead),...guard.params).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Only your completed timer, or a completed timer managed by a lead, can be adjusted. Reload before trying again.'})
 return c.json({...await readTimer(c.env,actor.projectId,id,actor.id),canAdjustOthers:['owner','admin'].includes(access.base)})
})

/** A member who loses ticket access (removed, or moved to a role without it) stops accruing handle time now. */
export function endHandleTimers(db:D1Database,projectId:string,userId:string,now:number){return db.prepare('UPDATE ticket_handle_sessions SET ended_at=max(started_at,?) WHERE project_id=? AND user_id=? AND ended_at IS NULL').bind(now,projectId,userId)}

const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
export const reportTimerErasureCount=`(SELECT count(*) FROM ticket_handle_sessions WHERE project_id=?1 AND conversation_id IN (${owned}))`
export function reportTimerErasureStatements(env:Env,projectId:string,contactId:string){return [env.DB.prepare(`DELETE FROM ticket_handle_sessions WHERE project_id=?1 AND conversation_id IN (${owned})`).bind(projectId,contactId)]}
