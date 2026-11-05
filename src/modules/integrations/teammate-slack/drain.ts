import type {Env} from '../../../platform/env'
import {destination} from '../../api-integrations/destinations'
import {notificationLabels} from '../notification-kinds'
import {noticeGuardSql,noticeSourceSql} from './guard'
import {installerAuthorized} from './authority'
import {prepareDirectMessage,sendPrepared} from './slack-api'

/** Statements one notice may cost: claim, authority, destination, link, recheck, outcome. */
export const noticeCost=14
const maxAttempts=5,perTick=5,interruptedAfter=10*60*1000
const retryDelays=[60000,300000,900000,3600000]
interface Claimed {notice_id:string;project_id:string;user_id:string;conversation_id:string;kind:string;destination_id:string;attempts:number}
const finish=(env:Env,id:string,state:string,detail:string|null,now:number,next:number|null=null)=>env.DB.prepare("UPDATE teammate_slack_deliveries SET state=?,next_attempt_at=?,detail=?,updated_at=? WHERE notice_id=? AND state='sending'").bind(state,next,detail,now,id).run()

/** Scheduled post-pass only: never on a request path and never inline with the notice
 * commit. It spends settled spare credit, in order: interrupted sends become
 * uncertain, due rate-limit retries, then newly committed notices. */
export async function drainTeammateSlack(env:Env,options:{now?:number;room:()=>number}){
 const now=options.now??Date.now()
 if(options.room()<noticeCost)return 0
 await env.DB.prepare("UPDATE teammate_slack_deliveries SET state='uncertain',next_attempt_at=NULL,detail='Delivery was interrupted. Check Slack; it is never sent again.',updated_at=? WHERE state='sending' AND started_at<?").bind(now,now-interruptedAfter).run()
 let sent=0
 const due=await env.DB.prepare("SELECT notice_id,project_id,user_id,conversation_id,kind,destination_id,attempts FROM teammate_slack_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,notice_id LIMIT ?").bind(now,perTick).all<Claimed>()
 for(const row of due.results){
  if(options.room()<noticeCost||sent>=perTick)return sent
  const claim=await env.DB.prepare(`UPDATE teammate_slack_deliveries SET state='sending',attempts=attempts+1,started_at=?,next_attempt_at=NULL,updated_at=? WHERE notice_id=? AND state='pending' AND attempts<?
   AND EXISTS(SELECT 1 FROM notification_inbox n JOIN teammate_slack_consent k ON k.project_id=n.project_id AND k.destination_id=teammate_slack_deliveries.destination_id WHERE n.id=teammate_slack_deliveries.notice_id AND ${noticeGuardSql})`)
   .bind(now,now,row.notice_id,maxAttempts,row.conversation_id,row.project_id).run()
  if(!claim.meta.changes){await env.DB.prepare("UPDATE teammate_slack_deliveries SET state='cancelled',next_attempt_at=NULL,detail='No longer eligible; nothing further was sent.',updated_at=? WHERE notice_id=? AND state='pending'").bind(now,row.notice_id).run();continue}
  await deliver(env,{...row,attempts:row.attempts+1},now);sent++
 }
 const fresh=await env.DB.prepare(`SELECT n.id notice_id,n.project_id,n.user_id,n.conversation_id,n.kind,k.destination_id,0 attempts FROM teammate_slack_consent k
  JOIN teammate_slack_links l ON l.project_id=k.project_id AND l.state='verified' AND l.destination_id=k.destination_id
  JOIN teammate_slack_preferences p ON p.project_id=l.project_id AND p.user_id=l.user_id AND p.enabled=1
  JOIN notification_inbox n ON n.project_id=l.project_id AND n.user_id=l.user_id AND n.kind=p.kind AND n.created_at>l.verified_at AND n.created_at>p.enabled_at AND n.created_at>=k.enabled_at
  WHERE ${noticeSourceSql('n')} AND NOT EXISTS(SELECT 1 FROM teammate_slack_deliveries d WHERE d.notice_id=n.id) ORDER BY n.created_at,n.id LIMIT ?`).bind(perTick).all<Claimed>()
 for(const row of fresh.results){
  if(options.room()<noticeCost||sent>=perTick)break
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO teammate_slack_deliveries(notice_id,project_id,user_id,conversation_id,kind,destination_id,state,attempts,started_at,created_at,updated_at)
   SELECT n.id,n.project_id,n.user_id,n.conversation_id,n.kind,k.destination_id,'sending',1,?,?,? FROM notification_inbox n JOIN teammate_slack_consent k ON k.project_id=n.project_id WHERE n.id=? AND ${noticeGuardSql}`)
   .bind(now,now,now,row.notice_id,row.conversation_id,row.project_id).run()
  if(!claim.meta.changes){
   await env.DB.prepare("INSERT OR IGNORE INTO teammate_slack_deliveries(notice_id,project_id,user_id,conversation_id,kind,destination_id,state,attempts,detail,created_at,updated_at) VALUES(?,?,?,?,?,?,'cancelled',0,'No longer eligible; nothing was sent.',?,?)").bind(row.notice_id,row.project_id,row.user_id,row.conversation_id,row.kind,row.destination_id,now,now).run()
   continue
  }
  await deliver(env,{...row,attempts:1},now);sent++
 }
 return sent
}

/** The claim above already rechecked every authority in one statement. Credential
 * preparation is asynchronous, so the same statement runs again before the request
 * crosses to Slack. After that point an interrupted outcome is uncertain, never replayed. */
async function deliver(env:Env,row:Claimed,now:number){
 let crossed=false
 try{
  const url=typeof env.APP_ORIGIN==='string'?new URL(`/projects/${encodeURIComponent(row.project_id)}/conversations/${encodeURIComponent(row.conversation_id)}`,env.APP_ORIGIN).href:''
  if(!url){await finish(env,row.notice_id,'failed','Slack notices are unavailable: this installation has no application address.',now);return}
  if(!await installerAuthorized(env,row.project_id,row.destination_id)){await finish(env,row.notice_id,'cancelled','The Slack connection owner no longer has authority; nothing was sent.',now);return}
  const link=await env.DB.prepare("SELECT dm_channel FROM teammate_slack_links WHERE project_id=? AND user_id=? AND state='verified' AND destination_id=?").bind(row.project_id,row.user_id,row.destination_id).first<{dm_channel:string}>()
  if(!link){await finish(env,row.notice_id,'cancelled','The Slack link is no longer current; nothing was sent.',now);return}
  const target=await destination(env,row.project_id,row.destination_id)
  const label=notificationLabels[row.kind]
  // Fixed identifiers only: no subject, customer, message text, name, address, note or tag.
  const prepared=await prepareDirectMessage({id:row.notice_id,projectId:row.project_id,destinationId:row.destination_id,token:target.secret.token,channel:link.dm_channel,summary:label,sections:[label,`Ticket ${row.conversation_id}`,`Open: ${url}`]},now)
  const current=await env.DB.prepare(`SELECT 1 FROM teammate_slack_deliveries t JOIN notification_inbox n ON n.id=t.notice_id JOIN teammate_slack_consent k ON k.project_id=n.project_id AND k.destination_id=t.destination_id WHERE t.notice_id=? AND t.state='sending' AND ${noticeGuardSql}`).bind(row.notice_id,row.conversation_id,row.project_id).first()
  if(!current||!await installerAuthorized(env,row.project_id,row.destination_id)){await finish(env,row.notice_id,'cancelled','Authority changed before sending; nothing was sent.',now);return}
  crossed=true
  const result=prepared.classify(await sendPrepared(prepared),now)
  const retry=result.kind==='retryable'&&row.attempts<maxAttempts
  const delay=Math.max(retryDelays[row.attempts-1]??3600000,result.retryAfterMs??0),next=retry&&Number.isSafeInteger(now+delay)?now+delay:null
  if(result.kind==='accepted')await finish(env,row.notice_id,'accepted',null,now)
  else if(result.kind==='uncertain')await finish(env,row.notice_id,'uncertain','Slack did not confirm delivery. Check Slack; it is never sent again.',now)
  else if(result.kind==='retryable'&&next!==null)await finish(env,row.notice_id,'pending','Slack asked us to wait; one more attempt is scheduled.',now,next)
  else if(result.kind==='retryable')await finish(env,row.notice_id,'failed','Slack rate limits stopped delivery; no further attempts.',now)
  else await finish(env,row.notice_id,'failed','Slack refused the notice. Ask an administrator to check the Slack connection.',now)
 }catch{
  await finish(env,row.notice_id,crossed?'uncertain':'failed',crossed?'Delivery outcome unknown. Check Slack; it is never sent again.':'Slack configuration unavailable; nothing was sent.',now)
 }
}
