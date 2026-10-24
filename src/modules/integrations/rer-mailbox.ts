import {expireRerMailRaw} from './rer-mail-retention'
import type {Env} from '../../platform/env'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {HTTPException} from 'hono/http-exception'
import {rerMail,managedMailbox,type ManagedMailbox} from './rer-mail-contract'
import {cronRoom} from '../../platform/cron-budget'

import {mailboxControlStatus as status,mailboxControl as control} from './rer-mailbox-control'
import {seedMissingRerMailbox} from './rer-mailbox-adoption'
import {auditStatement,requestSource} from '../audit/record'
export {refreshRerMailbox} from './rer-mailbox-observation'

/** Native provisioning/retirement owns this outbox. All control operations are
 * idempotent under allocationKey/mailboxId; retries never allocate a new address. */
export async function processRerMailbox(env:Env,projectId:string){
 if(!rerMail(env)||!env.MAIL_API_KEY)return
 await seedMissingRerMailbox(env,projectId)
 const token=crypto.randomUUID(),now=Date.now()
 const claimed=await env.DB.prepare(`UPDATE rer_mailbox_outbox SET state='processing',claim_token=?,claimed_at=?,attempts=attempts+1 WHERE project_id=? AND next_at<=? AND (state='pending' OR state='processing' AND claimed_at<?) RETURNING *`).bind(token,now,projectId,now,now-60000).first<{action:string;attempts:number}>()
 if(!claimed)return
 try{
  let row=await env.DB.prepare('SELECT * FROM rer_mailboxes WHERE project_id=?').bind(projectId).first<ManagedMailbox>()
  if(!row)throw new Error('Mailbox history is unavailable')
  if(!row.mailbox_id){
   const reserved=status(await control(env,{action:'reserve',allocationKey:row.allocation_key}),row,'reserve')
   await env.DB.prepare('UPDATE rer_mailboxes SET mailbox_id=?,address=? WHERE project_id=? AND mailbox_id IS NULL').bind(reserved.mailboxId,reserved.address,projectId).run()
   row={...row,mailbox_id:reserved.mailboxId,address:reserved.address}
  }
  // Deletion may have replaced the outbox while reserve was in flight. Retire
  // its result on the next native attempt rather than resurrect the route.
  const current=await env.DB.prepare('SELECT action,claim_token FROM rer_mailbox_outbox WHERE project_id=?').bind(projectId).first<{action:string;claim_token:string}>()
  if(current?.claim_token!==token)return
  const outcome=status(await control(env,{action:current.action,mailboxId:row.mailbox_id!,...(current.action==='bind'?{workspaceId:projectId}:{})}),row,current.action)
  await env.DB.batch([
   env.DB.prepare(`UPDATE rer_mailboxes SET state=?,generation=?,configured=?,route_active=?,last_inbound_at=coalesce(last_inbound_at,?),error=NULL,route_checked_at=?,route_check_next_at=?,route_check_failures=0,route_check_error=NULL,updated_at=? WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?) AND (state<>'revoked' OR ?='retire')`).bind(outcome.state,outcome.generation,outcome.configured?1:0,outcome.routeActive?1:0,outcome.lastInboundAt,Date.now(),Date.now()+300000,Date.now(),projectId,projectId,token,current.action),
   env.DB.prepare(`UPDATE email_settings SET from_address=?,inbound_address=?,is_enabled=1 WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailboxes b WHERE b.project_id=? AND b.state='active') AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=? AND action='bind')`).bind(outcome.address,outcome.address,projectId,projectId,projectId,token),
   auditStatement(env.DB,{projectId,category:'integration',action:current.action==='retire'?'managed_mail.retired':'managed_mail.bound',actor:{type:'system'},source:'system',target:{type:'managed_mailbox',id:row.mailbox_id!},detail:{generation:outcome.generation,state:outcome.state}},Date.now(),{sql:'EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?)',params:[projectId,token]}),
   env.DB.prepare("UPDATE rer_mailbox_outbox SET state='complete',error=NULL WHERE project_id=? AND claim_token=?").bind(projectId,token),
  ])
 }catch(error){
  const conflict=error instanceof HTTPException&&error.status===409,terminal=conflict||claimed.attempts>=8
  const reason=conflict?'Mailbox assignment conflict. Run Edit Run needs to resolve it.':'Managed mailbox could not be activated. Retry the connection.'
  await env.DB.batch([
   env.DB.prepare(`UPDATE rer_mailboxes SET error=?,state=CASE WHEN state='revoked' THEN state ELSE 'failed' END,route_active=0,updated_at=? WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?)`).bind(reason,Date.now(),projectId,projectId,token),
   auditStatement(env.DB,{projectId,category:'integration',action:conflict?'managed_mail.binding_conflict':'managed_mail.control_failed',outcome:'failed',actor:{type:'system'},source:'system',target:{type:'workspace',id:projectId},detail:{action:claimed.action,terminal}},Date.now(),{sql:'EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?)',params:[projectId,token]}),
   env.DB.prepare('UPDATE rer_mailbox_outbox SET state=?,next_at=?,error=? WHERE project_id=? AND claim_token=?').bind(terminal?'failed':'pending',Date.now()+Math.min(3600000,1000*2**claimed.attempts),reason,projectId,token),
  ])
 }
}
export async function recoverRerMailboxes(env:Env){
 if(!rerMail(env)||!cronRoom(env,3))return
 await expireRerMailRaw(env)
 const unbound=await env.DB.prepare(`SELECT id FROM projects WHERE NOT EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id=projects.id) AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=projects.id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL) ORDER BY created_at,id LIMIT 10`).all<{id:string}>()
 for(const row of unbound.results){if(!cronRoom(env,5))break;await seedMissingRerMailbox(env,row.id)}
 if(!cronRoom(env,2))return
 const rows=await env.DB.prepare("SELECT project_id FROM rer_mailbox_outbox WHERE state='pending' AND next_at<=? OR state='processing' AND claimed_at<? ORDER BY next_at LIMIT 10").bind(Date.now(),Date.now()-60000).all<{project_id:string}>()
 for(const row of rows.results)await env.JOBS.send({type:'rer.mailbox',id:row.project_id,projectId:row.project_id})
 if(!cronRoom(env,1))return
 const stale=await env.DB.prepare("SELECT project_id FROM rer_mailboxes WHERE state='active' AND route_check_next_at<=? ORDER BY route_check_next_at LIMIT 10").bind(Date.now()).all<{project_id:string}>()
 for(const row of stale.results)await env.JOBS.send({type:'rer.mailbox.status',id:row.project_id,projectId:row.project_id})
}
export async function rerMailboxStatus(env:Env,projectId:string){
 if(!rerMail(env))return null
 await seedMissingRerMailbox(env,projectId)
 await processRerMailbox(env,projectId)
 const row=await env.DB.prepare('SELECT * FROM rer_mailboxes WHERE project_id=?').bind(projectId).first<ManagedMailbox>()
 const latest=await env.DB.prepare('SELECT id,state,error,updated_at FROM email_deliveries WHERE project_id=? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<{id:string;state:string;error:string|null;updated_at:number}>()
 const inbound=await env.DB.prepare("SELECT state,json_extract(result_json,'$.state') outcome,error,updated_at FROM rer_mail_ingress WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").bind(projectId).first<{state:string;outcome:string|null;error:string|null;updated_at:number}>()
 return {inbound:inbound?{state:inbound.outcome||inbound.state,reason:inbound.error,at:inbound.updated_at}:null,address:row?.address||null,state:row?.state||'pending',generation:row?.generation||0,configured:Boolean(row?.configured),routeActive:row?.state==='active'&&Boolean(row?.route_active),observed:Boolean(row?.last_inbound_at),lastInboundAt:row?.last_inbound_at||null,lastOutboundAcceptanceAt:row?.last_outbound_at||null,error:row?.error||null,routeUncertain:Boolean(row?.route_check_error),routeCheckError:row?.route_check_error||null,checkedAt:row?.route_checked_at||null,nextCheckAt:row?.route_check_next_at||null,outbound:latest?{id:latest.id,state:latest.state==='sent'?'accepted':latest.state,reason:latest.error,at:latest.updated_at}:null}
}
export const rerMailboxRoutes=new Hono<AppEnv>()
rerMailboxRoutes.post('/projects/:projectId/email-settings/managed/retry',async c=>{
 const actor=await scope(c,true)
 if(!rerMail(c.env))throw new HTTPException(404)
 await seedMissingRerMailbox(c.env,actor.projectId)
 if(!await managedMailbox(c.env,actor.projectId))throw new HTTPException(404)
 await c.env.DB.batch([c.env.DB.prepare("UPDATE rer_mailbox_outbox SET state='pending',attempts=0,next_at=0 WHERE project_id=? AND state IN ('failed','complete') AND action='bind'").bind(actor.projectId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'managed_mail.retry_requested',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'workspace',id:actor.projectId}})])
 await processRerMailbox(c.env,actor.projectId)
 return c.json({managed:await rerMailboxStatus(c.env,actor.projectId)})
})
