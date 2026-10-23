import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {createWebhookProtocol} from '../../vendor/base/modules/integrations/core/webhook'
import {destination} from '../api-integrations/destinations'
import {httpsTransport} from '../api-integrations/transport'
import {availableTicketSql} from '../tickets/model'
import {workflowNow} from './clock'
import type {WorkflowGuard} from './actions'
import type {WorkflowNotificationResult} from './notify'

/** A permanent workflow receipt owns one signed request. Preparation is local;
 * only the guarded pending -> sending commit admits an external effect. A lost
 * response or interrupted sending claim is uncertain, never permission to retry. */
export async function sendWorkflowWebhook(env:Env,input:{projectId:string;conversationId:string;id:string;destinationId:string;guard:WorkflowGuard}):Promise<WorkflowNotificationResult>{
 const {projectId,conversationId,id,destinationId,guard}=input
 const prior=await env.DB.prepare('SELECT state,detail FROM workflow_notifications WHERE project_id=? AND id=?').bind(projectId,id).first<any>()
 if(prior&&prior.state!=='pending'){
  if(prior.state==='sending')await env.DB.prepare("UPDATE workflow_notifications SET state='uncertain',detail='Webhook claim was interrupted; no automatic replay',updated_at=? WHERE project_id=? AND id=? AND state='sending'").bind(workflowNow(env),projectId,id).run()
  return {state:prior.state==='sending'?'uncertain':prior.state,detail:prior.state==='sending'?'Webhook claim was interrupted; no automatic replay':prior.detail??undefined}
 }
 let target
 try{target=await destination(env,projectId,destinationId)}catch{return {state:'failed',detail:'Webhook destination is unavailable'}}
 if(target.kind!=='webhook')return {state:'failed',detail:'Choose a signed webhook destination'}
 const eventId=`workflow:${await hashToken(id)}`,body=JSON.stringify({id:eventId,event:'workflow.action',data:{project_id:projectId,conversation_id:conversationId}}),now=workflowNow(env)
 const protocol=createWebhookProtocol({resolveDestination:async()=>target.secret.url,signingKey:async()=>Uint8Array.from(target.secret.key.match(/../g),(part:string)=>parseInt(part,16))})
 let wire
 try{wire=await protocol.prepare({id:eventId,tenant:projectId,destinationId,event:'workflow.action',protocol:'webhook',body},now)}catch{return {state:'failed',detail:'Webhook signing configuration is unavailable'}}
 const eligible=`EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${availableTicketSql()} AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND (${guard.sql})) AND EXISTS(SELECT 1 FROM native_integration_destinations d WHERE d.project_id=? AND d.id=? AND d.kind='webhook' AND d.enabled=1 AND d.secret_ciphertext=?)`
 const args=[projectId,conversationId,...guard.params,projectId,destinationId,target.secret_ciphertext]
 await env.DB.prepare(`INSERT OR IGNORE INTO workflow_notifications(id,project_id,conversation_id,kind,recipient_id,message,state,created_at,updated_at) SELECT ?,?,?,'webhook',?,?,'pending',?,? WHERE ${eligible}`).bind(id,projectId,conversationId,destinationId,body,now,now,...args).run()
 const claimed=await env.DB.prepare(`UPDATE workflow_notifications SET state='sending',updated_at=? WHERE project_id=? AND id=? AND state='pending' AND ${eligible}`).bind(now,projectId,id,...args).run()
 if(!claimed.meta.changes)return {state:'cancelled',detail:'Ticket, workflow or destination changed before webhook admission'}
 let result:WorkflowNotificationResult
 try{
  const outcome=protocol.classify(await httpsTransport.send(wire),workflowNow(env))
  result=outcome.kind==='accepted'?{state:'complete',detail:'Signed webhook accepted'}:outcome.kind==='rejected'||outcome.kind==='retryable'?{state:'failed',detail:`Webhook refused (${outcome.status}); review before issuing new work`}:{state:'uncertain',detail:'Webhook outcome is unknown; no automatic replay'}
 }catch{result={state:'uncertain',detail:'Webhook outcome is unknown; no automatic replay'}}
 await env.DB.prepare("UPDATE workflow_notifications SET state=?,detail=?,updated_at=? WHERE project_id=? AND id=? AND state='sending'").bind(result.state,result.detail??null,workflowNow(env),projectId,id).run()
 return result
}
