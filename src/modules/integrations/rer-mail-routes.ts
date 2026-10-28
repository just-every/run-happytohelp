import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {hashToken} from '../../platform/auth'
import {rerMail,mailService,mailJson} from './rer-mail-contract'
import {recordRerAcceptance} from './rer-mail'
import {messageIds} from './email-threading'
import {auditStatement,requestSource} from '../audit/record'

/** An explicit read of a retained relay receipt can settle an uncertain command.
 * This endpoint never posts to send and never reconstructs its recipients. */
export const rerMailRoutes=new Hono<AppEnv>()
rerMailRoutes.post('/projects/:projectId/email-settings/managed/reconcile',async c=>{
 const actor=await scope(c,true),body=await c.req.json()
 if(!rerMail(c.env)||typeof body?.deliveryId!=='string'||body.deliveryId.length>200)throw new HTTPException(400)
 const row=await c.env.DB.prepare('SELECT id,state FROM email_deliveries WHERE project_id=? AND id=?').bind(actor.projectId,body.deliveryId).first<{id:string;state:string}>()
 if(!row)throw new HTTPException(404)
 if(!['uncertain','sending'].includes(row.state))return c.json({state:row.state==='sent'?'accepted':row.state})
 const url=mailService(c.env.MAIL_RELAY_URL);url.pathname+='/'+await hashToken(row.id)
 const response=await fetch(url,{redirect:'manual',headers:{Authorization:`Bearer ${c.env.MAIL_API_KEY}`},signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new HTTPException(503,{message:'The retained mail receipt is unavailable. The message has not been sent again.'})
 const receipt=await mailJson(response)
 const event={projectId:actor.projectId,category:'integration' as const,action:'managed_mail.reconciled',actor:{type:'user' as const,id:actor.id},source:requestSource(c),target:{type:'email_delivery',id:row.id}}
 const guard={sql:"EXISTS(SELECT 1 FROM email_deliveries WHERE id=? AND project_id=? AND state IN ('sending','uncertain'))",params:[row.id,actor.projectId]}
 if(response.status===202&&receipt.accepted===true&&receipt.state==='accepted'&&messageIds(receipt.messageId).length===1&&messageIds(receipt.messageId)[0]===receipt.messageId){
  await recordRerAcceptance(c.env,{projectId:actor.projectId,idempotencyKey:row.id},receipt.messageId)
  await c.env.DB.batch([auditStatement(c.env.DB,{...event,detail:{state:'accepted'}},Date.now(),guard),c.env.DB.prepare("UPDATE email_deliveries SET state='sent',provider_id=?,error=NULL,updated_at=? WHERE id=? AND project_id=? AND state IN ('sending','uncertain')").bind(receipt.messageId,Date.now(),row.id,actor.projectId)])
  return c.json({state:'accepted'})
 }
 if(receipt.state==='failed'&&receipt.failure?.phase==='before_provider_dispatch'){
  await c.env.DB.batch([auditStatement(c.env.DB,{...event,detail:{state:'failed',phase:'before_provider_dispatch'}},Date.now(),guard),c.env.DB.prepare("UPDATE email_deliveries SET state='failed',error='Managed email was refused before provider dispatch',updated_at=? WHERE id=? AND project_id=? AND state IN ('sending','uncertain')").bind(Date.now(),row.id,actor.projectId)])
  return c.json({state:'failed'})
 }
 return c.json({state:'uncertain'})
})
