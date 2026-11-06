import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {auditStatement} from '../../audit/record'
import {liveConnection} from '../../support-channels/model'
import {issuerGuard,type Issuer} from '../../../platform/integration-authority'

/** Owner or admin consent: one live Teams bot connection may carry personal
 * notices. SLA policy selection, escalation connections and support-channel installs
 * never create this row. Changing the destination retires every link to the old one. */
export async function readConsent(env:Env,projectId:string){
 const destinations=await env.DB.prepare(`SELECT id,account name FROM support_channel_connections WHERE project_id=? AND provider='teams' AND ${liveConnection} ORDER BY id`).bind(projectId).all<{id:string;name:string}>()
 const consent=await env.DB.prepare('SELECT connection_id,enabled_at FROM teammate_teams_consent WHERE project_id=?').bind(projectId).first<{connection_id:string;enabled_at:number}>()
 return {destinations:destinations.results,consent:consent?{...consent,connection_name:destinations.results.find(row=>row.id===consent.connection_id)?.name??null}:null}
}
export async function writeConsent(env:Env,issuer:Issuer,connectionId:unknown){
 const projectId=issuer.actor.projectId,guard=await issuerGuard(env,issuer),now=Date.now()
 if(connectionId===null){
  const result=await env.DB.batch([
   env.DB.prepare(`DELETE FROM teammate_teams_consent WHERE project_id=? AND EXISTS(${guard.sql})`).bind(projectId,...guard.params),
   env.DB.prepare(`DELETE FROM teammate_teams_codes WHERE project_id=? AND EXISTS(${guard.sql})`).bind(projectId,...guard.params),
   env.DB.prepare(`DELETE FROM teammate_teams_links WHERE project_id=? AND EXISTS(${guard.sql})`).bind(projectId,...guard.params),
   auditStatement(env.DB,{projectId,category:'integration',action:'teammate_teams.consent_revoked',actor:{type:'user',id:issuer.actor.id},source:'dashboard',target:{type:'project',id:projectId}},now,{sql:`EXISTS(${guard.sql})`,params:guard.params})
  ])
  if(!result[3].meta.changes)throw new HTTPException(409,{message:'Authority changed'})
  return {enabled:false}
 }
 if(typeof connectionId!=='string')throw new HTTPException(400,{message:'Choose a Teams connection.'})
 const usable=`EXISTS(SELECT 1 FROM support_channel_connections WHERE project_id=? AND id=? AND provider='teams' AND ${liveConnection})`
 const result=await env.DB.batch([
  env.DB.prepare(`DELETE FROM teammate_teams_codes WHERE project_id=? AND (connection_id<>? OR NOT EXISTS(SELECT 1 FROM teammate_teams_consent k WHERE k.project_id=teammate_teams_codes.project_id AND k.connection_id=teammate_teams_codes.connection_id)) AND EXISTS(${guard.sql}) AND ${usable}`).bind(projectId,connectionId,...guard.params,projectId,connectionId),
  // A new consent or different installation requires fresh personal links.
  env.DB.prepare(`DELETE FROM teammate_teams_links WHERE project_id=? AND (connection_id<>? OR NOT EXISTS(SELECT 1 FROM teammate_teams_consent k WHERE k.project_id=teammate_teams_links.project_id AND k.connection_id=teammate_teams_links.connection_id)) AND EXISTS(${guard.sql}) AND ${usable}`).bind(projectId,connectionId,...guard.params,projectId,connectionId),
  env.DB.prepare(`INSERT INTO teammate_teams_consent(project_id,user_id,connection_id,enabled_at) SELECT ?,?,?,? WHERE EXISTS(${guard.sql}) AND ${usable}
   ON CONFLICT(project_id) DO UPDATE SET user_id=excluded.user_id,connection_id=excluded.connection_id,enabled_at=CASE WHEN teammate_teams_consent.connection_id=excluded.connection_id THEN teammate_teams_consent.enabled_at ELSE excluded.enabled_at END`)
   .bind(projectId,issuer.actor.id,connectionId,now,...guard.params,projectId,connectionId),
  auditStatement(env.DB,{projectId,category:'integration',action:'teammate_teams.consent_enabled',actor:{type:'user',id:issuer.actor.id},source:'dashboard',target:{type:'destination',id:connectionId}},now,{sql:`EXISTS(${guard.sql}) AND ${usable}`,params:[...guard.params,projectId,connectionId]})
 ])
 if(!result[2].meta.changes)throw new HTTPException(409,{message:'Choose an live Teams bot connection.'})
 return {enabled:true}
}
