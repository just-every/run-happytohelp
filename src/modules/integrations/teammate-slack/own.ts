import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {ticketScopeSql} from '../../access/ticket-scope'
import {contactAvailableSql} from '../../conversations/contact-privacy'
import {auditStatement} from '../../audit/record'
import {teammateKinds,notificationLabels} from '../notification-kinds'
import {installerAuthorized} from './authority'

type Member={id:string;projectId:string}

/** Why personal Slack cannot deliver right now, or null. Shown to the teammate, never hidden. */
export async function unavailableReason(env:Env,projectId:string){
 const consent=await env.DB.prepare('SELECT destination_id FROM teammate_slack_consent WHERE project_id=?').bind(projectId).first<{destination_id:string}>()
 if(!consent)return 'An owner or admin has not enabled personal Slack notices.'
 const destination=await env.DB.prepare("SELECT 1 FROM native_integration_destinations WHERE project_id=? AND id=? AND kind='slack' AND mode='bot' AND enabled=1").bind(projectId,consent.destination_id).first()
 if(!destination)return 'The Slack connection is disabled or removed.'
 if(!await installerAuthorized(env,projectId,consent.destination_id))return 'The Slack connection needs an administrator to reconnect it.'
 if(typeof env.APP_ORIGIN!=='string'||typeof env.INTEGRATION_ENCRYPTION_KEY!=='string')return 'This installation is not configured for Slack notices.'
 return null
}
export async function ownStatus(env:Env,member:Member){
 const link=await env.DB.prepare('SELECT state,slack_user_id,verified_at FROM teammate_slack_links WHERE project_id=? AND user_id=?').bind(member.projectId,member.id).first<{state:string;slack_user_id:string;verified_at:number|null}>()
 const rows=await env.DB.prepare('SELECT kind,enabled FROM teammate_slack_preferences WHERE project_id=? AND user_id=?').bind(member.projectId,member.id).all<{kind:string;enabled:number}>()
 const reason=await unavailableReason(env,member.projectId)
 return {available:reason===null,unavailable_reason:reason,link:link?{state:link.state,slack_user_id:link.slack_user_id}:null,
  preferences:teammateKinds.map(kind=>({kind,label:notificationLabels[kind],enabled:rows.results.some(row=>row.kind===kind&&row.enabled===1)}))}
}
export async function savePreferences(env:Env,member:Member,entries:unknown){
 if(!Array.isArray(entries)||entries.length>teammateKinds.length||new Set(entries.map((e:any)=>e?.kind)).size!==entries.length)throw new HTTPException(400)
 for(const entry of entries as any[])if(!teammateKinds.includes(entry?.kind)||![true,false,0,1].includes(entry.enabled))throw new HTTPException(400)
 const now=Date.now()
 // Turning a kind on stamps it: only notices committed afterwards can be sent (no backfill).
 const statements=(entries as any[]).map(entry=>env.DB.prepare(`INSERT INTO teammate_slack_preferences(project_id,user_id,kind,enabled,enabled_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)
  ON CONFLICT(project_id,user_id,kind) DO UPDATE SET enabled=excluded.enabled,enabled_at=CASE WHEN excluded.enabled=1 AND teammate_slack_preferences.enabled=0 THEN excluded.enabled_at ELSE teammate_slack_preferences.enabled_at END`)
  .bind(member.projectId,member.id,entry.kind,entry.enabled?1:0,now,member.projectId,member.id))
 if(statements.length)await env.DB.batch([...statements,auditStatement(env.DB,{projectId:member.projectId,category:'data',action:'teammate_slack.preferences_updated',actor:{type:'user',id:member.id},source:'dashboard',target:{type:'user',id:member.id},detail:{kinds:(entries as any[]).map(entry=>entry.kind)}},now)])
 return {updated:true}
}
/** The recipient's own outcomes, under the inbox read's predicates: current membership,
 * ticket scope and an available contact. Rows where nothing was sent stay out of view. */
export async function ownOutcomes(env:Env,member:Member){
 const rows=await env.DB.prepare(`SELECT d.notice_id id,d.conversation_id,d.kind,d.state,d.attempts,d.detail,d.created_at,d.updated_at FROM teammate_slack_deliveries d
  JOIN conversations c ON c.id=d.conversation_id AND c.project_id=d.project_id JOIN memberships m ON m.project_id=d.project_id AND m.user_id=d.user_id
  WHERE d.project_id=? AND d.user_id=? AND d.state<>'cancelled' AND ${ticketScopeSql('m.user_id')} AND ${contactAvailableSql()} ORDER BY d.created_at DESC,d.notice_id DESC LIMIT 100`).bind(member.projectId,member.id).all<any>()
 return {data:rows.results.map(row=>({...row,label:notificationLabels[row.kind]}))}
}
