import type {Env} from '../../../platform/env'
import {teamsToken,serviceUrl} from '../../support-channels/teams'
import type {Connection} from '../../support-channels/model'
import {boundedFetch} from '../../support-channels/network'
import {notificationLabels} from '../notification-kinds'
import {noticeGuardSql,noticeSourceSql} from './guard'


/** Statements one notice may cost: claim, authority, destination, link, recheck, outcome. */
export const teamsNoticeCost=14
const maxAttempts=5,perTick=5,interruptedAfter=10*60*1000
const retryDelays=[60000,300000,900000,3600000]
interface Claimed {notice_id:string;project_id:string;user_id:string;conversation_id:string;kind:string;connection_id:string;attempts:number}
const finish=(env:Env,id:string,state:string,detail:string|null,now:number,next:number|null=null)=>env.DB.prepare("UPDATE teammate_teams_deliveries SET state=?,next_attempt_at=?,detail=?,updated_at=? WHERE notice_id=? AND state='sending'").bind(state,next,detail,now,id).run()

/** Scheduled post-pass only: never on a request path and never inline with the notice
 * commit. It spends settled spare credit, in order: interrupted sends become
 * uncertain, due rate-limit retries, then newly committed notices. */
export async function drainTeammateTeams(env:Env,options:{now?:number;room:()=>number}){
 const now=options.now??Date.now()
 if(options.room()<teamsNoticeCost)return 0
 await env.DB.prepare("UPDATE teammate_teams_deliveries SET state='uncertain',next_attempt_at=NULL,detail='Delivery was interrupted. Check Teams; it is never sent again.',updated_at=? WHERE state='sending' AND started_at<?").bind(now,now-interruptedAfter).run()
 let sent=0
 const due=await env.DB.prepare("SELECT notice_id,project_id,user_id,conversation_id,kind,connection_id,attempts FROM teammate_teams_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,notice_id LIMIT ?").bind(now,perTick).all<Claimed>()
 for(const row of due.results){
  if(options.room()<teamsNoticeCost||sent>=perTick)return sent
  const claim=await env.DB.prepare(`UPDATE teammate_teams_deliveries SET state='sending',attempts=attempts+1,started_at=?,next_attempt_at=NULL,updated_at=? WHERE notice_id=? AND state='pending' AND attempts<?
   AND EXISTS(SELECT 1 FROM notification_inbox n JOIN teammate_teams_consent k ON k.project_id=n.project_id AND k.connection_id=teammate_teams_deliveries.connection_id WHERE n.id=teammate_teams_deliveries.notice_id AND ${noticeGuardSql})`)
   .bind(now,now,row.notice_id,maxAttempts,row.conversation_id,row.project_id).run()
  if(!claim.meta.changes){await env.DB.prepare("UPDATE teammate_teams_deliveries SET state='cancelled',next_attempt_at=NULL,detail='No longer eligible; nothing further was sent.',updated_at=? WHERE notice_id=? AND state='pending'").bind(now,row.notice_id).run();continue}
  await deliver(env,{...row,attempts:row.attempts+1},now);sent++
 }
 const fresh=await env.DB.prepare(`SELECT n.id notice_id,n.project_id,n.user_id,n.conversation_id,n.kind,k.connection_id,0 attempts FROM teammate_teams_consent k
  JOIN teammate_teams_links l ON l.project_id=k.project_id AND l.connection_id=k.connection_id
  JOIN teammate_teams_preferences p ON p.project_id=l.project_id AND p.user_id=l.user_id AND p.enabled=1
  JOIN notification_inbox n ON n.project_id=l.project_id AND n.user_id=l.user_id AND n.kind=p.kind AND n.created_at>l.verified_at AND n.created_at>p.enabled_at AND n.created_at>=k.enabled_at
  WHERE ${noticeSourceSql('n')} AND NOT EXISTS(SELECT 1 FROM teammate_teams_deliveries d WHERE d.notice_id=n.id) ORDER BY n.created_at,n.id LIMIT ?`).bind(perTick).all<Claimed>()
 for(const row of fresh.results){
  if(options.room()<teamsNoticeCost||sent>=perTick)break
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO teammate_teams_deliveries(notice_id,project_id,user_id,conversation_id,kind,connection_id,state,attempts,started_at,created_at,updated_at)
   SELECT n.id,n.project_id,n.user_id,n.conversation_id,n.kind,k.connection_id,'sending',1,?,?,? FROM notification_inbox n JOIN teammate_teams_consent k ON k.project_id=n.project_id WHERE n.id=? AND ${noticeGuardSql}`)
   .bind(now,now,now,row.notice_id,row.conversation_id,row.project_id).run()
  if(!claim.meta.changes){
   await env.DB.prepare("INSERT OR IGNORE INTO teammate_teams_deliveries(notice_id,project_id,user_id,conversation_id,kind,connection_id,state,attempts,detail,created_at,updated_at) VALUES(?,?,?,?,?,?,'cancelled',0,'No longer eligible; nothing was sent.',?,?)").bind(row.notice_id,row.project_id,row.user_id,row.conversation_id,row.kind,row.connection_id,now,now).run()
   continue
  }
  await deliver(env,{...row,attempts:1},now);sent++
 }
 return sent
}

/** Preparation may await token exchange; the last SQL query rechecks every predicate
 * after it, selects only the current personal conversation and pins the credential. */
async function deliver(env:Env,row:Claimed,now:number){
 let crossed=false
 try{
  const url=typeof env.APP_ORIGIN==='string'?new URL(`/projects/${encodeURIComponent(row.project_id)}/conversations/${encodeURIComponent(row.conversation_id)}`,env.APP_ORIGIN).href:''
  if(!url){await finish(env,row.notice_id,'failed','Teams notices are unavailable: no application address.',now);return}
  const query=`SELECT x.*,l.personal_conversation,l.service_url FROM teammate_teams_deliveries t
   JOIN notification_inbox n ON n.id=t.notice_id JOIN teammate_teams_consent k ON k.project_id=n.project_id AND k.connection_id=t.connection_id
   JOIN support_channel_connections x ON x.id=k.connection_id AND x.project_id=k.project_id
   JOIN teammate_teams_links l ON l.project_id=n.project_id AND l.user_id=n.user_id AND l.connection_id=k.connection_id AND l.tenant_id=x.account AND l.app_id=x.sender
   WHERE t.notice_id=? AND t.state='sending' AND ${noticeGuardSql}`
  const args=[row.notice_id,row.conversation_id,row.project_id]
  const prepared=await env.DB.prepare(query).bind(...args).first<Connection&{personal_conversation:string;service_url:string}>()
  if(!prepared){await finish(env,row.notice_id,'cancelled','Authority changed; nothing was sent.',now);return}
  const token=await teamsToken(env,prepared)
  const current=await env.DB.prepare(query+' AND x.token_cipher=? AND x.account=? AND x.sender=?').bind(...args,prepared.token_cipher,prepared.account,prepared.sender).first<Connection&{personal_conversation:string;service_url:string}>()
  if(!current){await finish(env,row.notice_id,'cancelled','Authority changed before sending; nothing was sent.',now);return}
  const target=new URL('v3/conversations/'+encodeURIComponent(current.personal_conversation)+'/activities',serviceUrl(current.service_url)).href
  const body=JSON.stringify({type:'message',textFormat:'plain',text:`${notificationLabels[row.kind]}\nTicket ${row.conversation_id}\nOpen: ${url}`})
  crossed=true
  const result=await boundedFetch(target,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body})
  if(result.status===429){
   const raw=result.headers.get('retry-after')||'',seconds=Number(raw),date=Date.parse(raw)
   const requested=raw.trim()&&Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?Math.max(0,date-now):0
   const delay=Math.max(retryDelays[row.attempts-1]??3600000,requested)
   if(row.attempts<maxAttempts&&Number.isSafeInteger(now+delay))await finish(env,row.notice_id,'pending','Teams asked us to wait; another attempt is scheduled.',now,now+delay)
   else await finish(env,row.notice_id,'failed','Teams rate limits stopped delivery; no further attempts.',now)
  }else if(result.status>=500||result.status<200||result.status>=300&&result.status<400){
   await finish(env,row.notice_id,'uncertain','Teams did not confirm delivery. Check Teams; it is never sent again.',now)
  }else if(result.status>=400){await finish(env,row.notice_id,'failed','Teams refused the notice. Ask an administrator to check the connection.',now)}
  else{
   let receipt:any;try{receipt=JSON.parse(new TextDecoder().decode(result.data))}catch{}
   await finish(env,row.notice_id,typeof receipt?.id==='string'&&receipt.id?'accepted':'uncertain',typeof receipt?.id==='string'&&receipt.id?null:'Teams returned no readable receipt. It is never sent again.',now)
  }
 }catch{
  await finish(env,row.notice_id,crossed?'uncertain':'failed',crossed?'Delivery outcome unknown. Check Teams; it is never sent again.':'Teams configuration unavailable; nothing was sent.',now)
 }
}
