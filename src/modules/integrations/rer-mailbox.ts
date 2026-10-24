import {expireRerMailRaw} from './rer-mail-retention'
import type {Env} from '../../platform/env'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {HTTPException} from 'hono/http-exception'
import {rerMail,mailService,mailJson,managedMailbox,type ManagedMailbox} from './rer-mail-contract'
import {cronRoom} from '../../platform/cron-budget'

type ControlStatus={mailboxId:string;address:string;workspaceId:string|null;generation:number;state:'reserved'|'active'|'failed'|'revoked';configured:boolean;routeActive:boolean;observed:boolean;lastInboundAt:number|null}
function status(value:any,row:ManagedMailbox,action:string):ControlStatus{
 if(!value||typeof value.mailboxId!=='string'||!value.mailboxId||typeof value.address!=='string'||!/^hth-[a-zA-Z0-9-]+@[^\s@]+\.[^\s@]+$/.test(value.address)||row.mailbox_id&&row.mailbox_id!==value.mailboxId||row.address&&row.address!==value.address||!Number.isSafeInteger(value.generation)||value.generation<Math.max(1,row.generation)||!['reserved','active','failed','revoked'].includes(value.state)||typeof value.configured!=='boolean'||typeof value.routeActive!=='boolean'||value.workspaceId!==null&&value.workspaceId!==row.project_id||action==='bind'&&(value.state!=='active'||value.workspaceId!==row.project_id)||action==='retire'&&value.state!=='revoked')throw new HTTPException(409,{message:'Managed mailbox assignment conflicts with this workspace'})
 return value
}
async function control(env:Env,payload:Record<string,string>){
 const response=await fetch(mailService(env.RER_MAIL_CONTROL_URL),{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new HTTPException(response.status===409?409:503,{message:response.status===409?'Managed mailbox assignment conflicts with this workspace':`Managed mailbox service is unavailable (${response.status})`})
 return mailJson(response)
}
/** Native provisioning/retirement owns this outbox. All control operations are
 * idempotent under allocationKey/mailboxId; retries never allocate a new address. */
export async function processRerMailbox(env:Env,projectId:string){
 if(!rerMail(env)||!env.MAIL_API_KEY)return
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
   env.DB.prepare(`UPDATE rer_mailboxes SET state=?,generation=?,configured=?,route_active=?,last_inbound_at=coalesce(last_inbound_at,?),error=NULL,updated_at=? WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?) AND (state<>'revoked' OR ?='retire')`).bind(outcome.state,outcome.generation,outcome.configured?1:0,outcome.routeActive?1:0,outcome.lastInboundAt,Date.now(),projectId,projectId,token,current.action),
   env.DB.prepare(`UPDATE email_settings SET from_address=?,inbound_address=?,is_enabled=1 WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailboxes b WHERE b.project_id=? AND b.state='active') AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=? AND action='bind')`).bind(outcome.address,outcome.address,projectId,projectId,projectId,token),
   env.DB.prepare("UPDATE rer_mailbox_outbox SET state='complete',error=NULL WHERE project_id=? AND claim_token=?").bind(projectId,token),
  ])
 }catch(error){
  const conflict=error instanceof HTTPException&&error.status===409,terminal=conflict||claimed.attempts>=8
  const reason=conflict?'Mailbox assignment conflict. Run Edit Run needs to resolve it.':'Managed mailbox could not be activated. Retry the connection.'
  await env.DB.batch([
   env.DB.prepare(`UPDATE rer_mailboxes SET error=?,state=CASE WHEN state='revoked' THEN state ELSE 'failed' END,route_active=0,updated_at=? WHERE project_id=? AND EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE project_id=? AND claim_token=?)`).bind(reason,Date.now(),projectId,projectId,token),
   env.DB.prepare('UPDATE rer_mailbox_outbox SET state=?,next_at=?,error=? WHERE project_id=? AND claim_token=?').bind(terminal?'failed':'pending',Date.now()+Math.min(3600000,1000*2**claimed.attempts),reason,projectId,token),
  ])
 }
}
export async function refreshRerMailbox(env:Env,projectId:string){
 const row=await managedMailbox(env,projectId)
 if(!rerMail(env)||!row?.mailbox_id||row.state!=='active')return
 try{
  const url=mailService(env.RER_MAIL_CONTROL_URL);url.pathname+='/'+encodeURIComponent(row.mailbox_id)
  const response=await fetch(url,{redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`},signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error('Managed status unavailable')
  const outcome=status(await mailJson(response),row,'status')
  await env.DB.prepare("UPDATE rer_mailboxes SET state=?,generation=?,configured=?,route_active=?,error=NULL,updated_at=? WHERE project_id=? AND mailbox_id=? AND state='active'").bind(outcome.state,outcome.generation,outcome.configured?1:0,outcome.routeActive?1:0,Date.now(),projectId,row.mailbox_id).run()
 }catch{
  await env.DB.prepare("UPDATE rer_mailboxes SET route_active=0,error='Managed route status could not be checked. Run Edit Run needs to restore the connection.',updated_at=? WHERE project_id=? AND state='active'").bind(Date.now(),projectId).run()
 }
}
export async function recoverRerMailboxes(env:Env){
 if(!rerMail(env)||!cronRoom(env,3))return
 await expireRerMailRaw(env)
 const rows=await env.DB.prepare("SELECT project_id FROM rer_mailbox_outbox WHERE state='pending' AND next_at<=? OR state='processing' AND claimed_at<? ORDER BY next_at LIMIT 10").bind(Date.now(),Date.now()-60000).all<{project_id:string}>()
 for(const row of rows.results)await env.JOBS.send({type:'rer.mailbox',id:row.project_id,projectId:row.project_id})
 if(!cronRoom(env,1))return
 const stale=await env.DB.prepare("SELECT project_id FROM rer_mailboxes WHERE state='active' AND updated_at<? ORDER BY updated_at LIMIT 10").bind(Date.now()-300000).all<{project_id:string}>()
 for(const row of stale.results)await env.JOBS.send({type:'rer.mailbox.status',id:row.project_id,projectId:row.project_id})
}
export async function rerMailboxStatus(env:Env,projectId:string){
 if(!rerMail(env))return null
 const row=await env.DB.prepare('SELECT * FROM rer_mailboxes WHERE project_id=?').bind(projectId).first<ManagedMailbox>()
 const latest=await env.DB.prepare('SELECT id,state,error,updated_at FROM email_deliveries WHERE project_id=? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<{id:string;state:string;error:string|null;updated_at:number}>()
 const inbound=await env.DB.prepare("SELECT state,json_extract(result_json,'$.state') outcome,error,updated_at FROM rer_mail_ingress WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").bind(projectId).first<{state:string;outcome:string|null;error:string|null;updated_at:number}>()
 return {inbound:inbound?{state:inbound.outcome||inbound.state,reason:inbound.error,at:inbound.updated_at}:null,address:row?.address||null,state:row?.state||'pending',generation:row?.generation||0,configured:Boolean(row?.configured),routeActive:row?.state==='active'&&Boolean(row?.route_active),observed:Boolean(row?.last_inbound_at),lastInboundAt:row?.last_inbound_at||null,lastOutboundAcceptanceAt:row?.last_outbound_at||null,error:row?.error||null,checkedAt:row?.updated_at||null,outbound:latest?{id:latest.id,state:latest.state==='sent'?'accepted':latest.state,reason:latest.error,at:latest.updated_at}:null}
}
export const rerMailboxRoutes=new Hono<AppEnv>()
rerMailboxRoutes.post('/projects/:projectId/email-settings/managed/retry',async c=>{
 const actor=await scope(c,true)
 if(!rerMail(c.env)||!await managedMailbox(c.env,actor.projectId))throw new HTTPException(404)
 await c.env.DB.prepare("UPDATE rer_mailbox_outbox SET state='pending',attempts=0,next_at=0 WHERE project_id=? AND state IN ('failed','complete') AND action='bind'").bind(actor.projectId).run()
 await processRerMailbox(c.env,actor.projectId)
 return c.json({managed:await rerMailboxStatus(c.env,actor.projectId)})
})
