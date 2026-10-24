import type {Env} from '../../platform/env'
import {rerMail,mailService,mailJson,managedMailbox} from './rer-mail-contract'
import {mailboxControlStatus} from './rer-mailbox-control'

export async function refreshRerMailbox(env:Env,projectId:string){
 const row=await managedMailbox(env,projectId)
 if(!rerMail(env)||!row?.mailbox_id||row.state!=='active')return
 try{
  const url=mailService(env.RER_MAIL_CONTROL_URL);url.pathname+='/'+encodeURIComponent(row.mailbox_id)
  const response=await fetch(url,{redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`},signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error('Managed status unavailable')
  const outcome=mailboxControlStatus(await mailJson(response),row,'status'),now=Date.now()
  await env.DB.prepare(`UPDATE rer_mailboxes SET state=?,generation=?,configured=?,route_active=?,route_checked_at=?,route_check_next_at=?,route_check_failures=0,route_check_error=NULL,updated_at=? WHERE project_id=? AND mailbox_id=? AND generation=? AND state='active'`)
   .bind(outcome.state,outcome.generation,outcome.configured?1:0,outcome.routeActive?1:0,now,now+300000,now,projectId,row.mailbox_id,row.generation).run()
 }catch{
  // A failed read says nothing about routing authority. Keep the last known
  // binding and retry quickly, bounded to one minute even during an outage.
  await env.DB.prepare(`UPDATE rer_mailboxes SET route_check_failures=route_check_failures+1,route_check_next_at=?,route_check_error='The latest route check is unavailable. Retrying automatically; the last known route is retained.' WHERE project_id=? AND mailbox_id=? AND generation=? AND state='active'`)
   .bind(Date.now()+Math.min(60000,5000*2**Math.min(row.route_check_failures,4)),projectId,row.mailbox_id,row.generation).run()
 }
}
