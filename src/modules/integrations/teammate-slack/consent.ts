import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {auditStatement} from '../../audit/record'
import {issuerGuard,type Issuer} from '../../../platform/integration-authority'

/** Owner or admin consent: one enabled bot-mode Slack destination may carry personal
 * notices. SLA policy selection, escalation connections and support-channel installs
 * never create this row. Changing the destination retires every link to the old one. */
export async function readConsent(env:Env,projectId:string){
 const destinations=await env.DB.prepare("SELECT id,name FROM native_integration_destinations WHERE project_id=? AND kind='slack' AND mode='bot' AND enabled=1 ORDER BY created_at,id").bind(projectId).all<{id:string;name:string}>()
 const consent=await env.DB.prepare('SELECT destination_id,enabled_at FROM teammate_slack_consent WHERE project_id=?').bind(projectId).first<{destination_id:string;enabled_at:number}>()
 return {destinations:destinations.results,consent:consent?{...consent,destination_name:destinations.results.find(row=>row.id===consent.destination_id)?.name??null}:null}
}
export async function writeConsent(env:Env,issuer:Issuer,destinationId:unknown){
 const projectId=issuer.actor.projectId,guard=await issuerGuard(env,issuer),now=Date.now()
 if(destinationId===null){
  const result=await env.DB.batch([
   env.DB.prepare(`DELETE FROM teammate_slack_consent WHERE project_id=? AND EXISTS(${guard.sql})`).bind(projectId,...guard.params),
   env.DB.prepare(`DELETE FROM teammate_slack_links WHERE project_id=? AND EXISTS(${guard.sql})`).bind(projectId,...guard.params),
   auditStatement(env.DB,{projectId,category:'integration',action:'teammate_slack.consent_revoked',actor:{type:'user',id:issuer.actor.id},source:'dashboard',target:{type:'project',id:projectId}},now,{sql:`EXISTS(${guard.sql})`,params:guard.params})
  ])
  if(!result[2].meta.changes)throw new HTTPException(409,{message:'Authority changed'})
  return {enabled:false}
 }
 if(typeof destinationId!=='string')throw new HTTPException(400,{message:'Choose a Slack connection.'})
 const usable="EXISTS(SELECT 1 FROM native_integration_destinations WHERE project_id=? AND id=? AND kind='slack' AND mode='bot' AND enabled=1)"
 const result=await env.DB.batch([
  // A different destination means different Slack teams: links must be proven again.
  env.DB.prepare(`DELETE FROM teammate_slack_links WHERE project_id=? AND destination_id<>? AND EXISTS(${guard.sql}) AND ${usable}`).bind(projectId,destinationId,...guard.params,projectId,destinationId),
  env.DB.prepare(`INSERT INTO teammate_slack_consent(project_id,user_id,destination_id,enabled_at) SELECT ?,?,?,? WHERE EXISTS(${guard.sql}) AND ${usable}
   ON CONFLICT(project_id) DO UPDATE SET user_id=excluded.user_id,destination_id=excluded.destination_id,enabled_at=CASE WHEN teammate_slack_consent.destination_id=excluded.destination_id THEN teammate_slack_consent.enabled_at ELSE excluded.enabled_at END`)
   .bind(projectId,issuer.actor.id,destinationId,now,...guard.params,projectId,destinationId),
  auditStatement(env.DB,{projectId,category:'integration',action:'teammate_slack.consent_enabled',actor:{type:'user',id:issuer.actor.id},source:'dashboard',target:{type:'destination',id:destinationId}},now,{sql:`EXISTS(${guard.sql}) AND ${usable}`,params:[...guard.params,projectId,destinationId]})
 ])
 if(!result[1].meta.changes)throw new HTTPException(409,{message:'Choose an enabled bot-mode Slack connection.'})
 return {enabled:true}
}
