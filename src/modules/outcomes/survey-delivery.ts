import {cronRoom} from '../../platform/cron-budget'
import type {Env} from '../../platform/env'
import {emailConfigured,sendEmail} from '../integrations/email'
import {auditStatement} from '../audit/record'
import {liveCycleSql,surveyRecipientSql,surveyJoins,type Survey} from './survey-store'
import {surveySigningConfigured,surveyURL} from './survey-links'
import {surveyCopy} from './survey-html'
const mailbox=(value:string)=>value.length<=254&&/^[^\s@<>(),:;"\\]+@[^\s@<>(),:;"\\]+\.[^\s@<>(),:;"\\]+$/.test(value)
/** The sole transition hook; the dispatcher also discovers missed native commits.
 * Enabled-at excludes old closed history, and UNIQUE(resolution_id) fences repeats. */
type Candidate={project_id:string;conversation_id:string}
async function scheduleSurveys(env:Env,rows:Candidate[],now:number){
 const candidates=rows.map(row=>({...row,id:crypto.randomUUID()}))
 await env.DB.prepare(`INSERT OR IGNORE INTO csat_surveys(id,project_id,resolution_id,conversation_id,contact_id,recipient,scale,locale,due_at,expires_at,state,created_at,updated_at)
 SELECT json_extract(candidate.value,'$.id'),r.project_id,r.id,c.id,r.contact_id,lower(trim(ct.email)),cfg.scale,cfg.locale,r.resolved_at+cfg.delay_minutes*60000,r.resolved_at+cfg.delay_minutes*60000+cfg.expires_days*86400000,'pending',?,?
 FROM json_each(?) candidate JOIN conversation_resolutions r ON r.project_id=json_extract(candidate.value,'$.project_id') AND r.conversation_id=json_extract(candidate.value,'$.conversation_id') JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id JOIN contacts ct ON ct.id=r.contact_id AND ct.project_id=r.project_id JOIN csat_settings cfg ON cfg.project_id=r.project_id
 WHERE cfg.enabled=1 AND r.resolved_at>=cfg.enabled_at AND ${liveCycleSql} AND ${surveyRecipientSql}
 AND ct.email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM csat_responses v WHERE v.resolution_id=r.id)`).bind(now,now,JSON.stringify(candidates)).run()
}
export async function scheduleConversationSurvey(env:Env,projectId:string,conversationId:string,now=Date.now()){
 await scheduleSurveys(env,[{project_id:projectId,conversation_id:conversationId}],now)
}
/** Bounded poll seam for scheduled/queue execution. Sending/unknown commands are
 * reconciliation-only, including a process lost between claim and provider call. */
export async function dispatchSurveys(env:Env,options:{now?:number;projectId?:string;conversationId?:string}={}){
 const now=options.now??Date.now()
 if(!cronRoom(env,3))return {processed:0,configured:false}
 const candidates=await env.DB.prepare(`SELECT r.project_id,r.conversation_id FROM conversation_resolutions r JOIN csat_settings cfg ON cfg.project_id=r.project_id JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id JOIN contacts ct ON ct.id=r.contact_id AND ct.project_id=r.project_id
 WHERE ${liveCycleSql} AND ${surveyRecipientSql} AND NOT EXISTS(SELECT 1 FROM csat_responses v WHERE v.resolution_id=r.id) AND cfg.enabled=1 AND r.resolved_at>=cfg.enabled_at AND r.reopened_at IS NULL AND NOT EXISTS(SELECT 1 FROM csat_surveys s WHERE s.resolution_id=r.id)
 ${options.projectId?'AND r.project_id=?':''} ${options.conversationId?'AND r.conversation_id=?':''} ORDER BY r.resolved_at LIMIT 50`)
 .bind(...(options.projectId?[options.projectId]:[]),...(options.conversationId?[options.conversationId]:[])).all<{project_id:string;conversation_id:string}>()
 // One bounded page, with the same live-cycle and recipient guards checked in
 // the insert itself. Discovery must not spend one statement per invitation.
 if(candidates.results.length&&cronRoom(env,3))await scheduleSurveys(env,candidates.results,now)
 await env.DB.prepare(`UPDATE csat_surveys SET state='cancelled',revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE state='pending' AND (expires_at<=? OR NOT EXISTS(
 SELECT 1 ${surveyJoins} WHERE s.id=csat_surveys.id AND ${liveCycleSql} AND ${surveyRecipientSql} AND lower(trim(ct.email))=s.recipient AND EXISTS(SELECT 1 FROM csat_settings cfg WHERE cfg.project_id=s.project_id AND cfg.enabled=1)))`).bind(now,now,now).run()
 if(!emailConfigured(env)||!surveySigningConfigured(env))return {processed:0,configured:false}
 const rows=await env.DB.prepare(`SELECT * FROM csat_surveys WHERE state='pending' AND due_at<=? AND expires_at>? ${options.projectId?'AND project_id=?':''} ${options.conversationId?'AND conversation_id=?':''} ORDER BY due_at,id LIMIT 25`)
 .bind(now,now,...(options.projectId?[options.projectId]:[]),...(options.conversationId?[options.conversationId]:[])).all<Survey>()
 let processed=0
 for(const row of rows.results){
  // Nine covers the claim, email outcome (including a rejected provider), and audit.
  if(!cronRoom(env,9))break;
  if(!mailbox(row.recipient)){await env.DB.prepare("UPDATE csat_surveys SET state='cancelled',revoked_at=?,updated_at=? WHERE id=? AND state='pending'").bind(now,now,row.id).run();continue}
  // Prepare the signed link before claiming. A missing configuration has no send effect.
  const url=await surveyURL(env,row),copy=surveyCopy[row.locale]
  const claimed=await env.DB.prepare(`UPDATE csat_surveys SET state='sending',updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 ${surveyJoins} WHERE s.id=csat_surveys.id AND ${liveCycleSql} AND ${surveyRecipientSql} AND lower(trim(ct.email))=s.recipient AND s.revoked_at IS NULL AND s.expires_at>? AND EXISTS(SELECT 1 FROM csat_settings cfg WHERE cfg.project_id=s.project_id AND cfg.enabled=1) AND NOT EXISTS(SELECT 1 FROM csat_responses v WHERE v.resolution_id=r.id))`).bind(now,row.id,now).run()
  if(!claimed.meta.changes)continue
  processed++
  let state='uncertain'
  try{
   const result=await sendEmail(env,{projectId:row.project_id,to:row.recipient,subject:copy.subject,text:`${copy.question}\n\n${copy.invite}\n${url}\n\n${copy.optout}: ${url}/optout`,idempotencyKey:'csat:'+row.id,headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}})
   state=['sent','suppressed'].includes(result.state)?result.state:'uncertain'
  }catch{
   const delivery=await env.DB.prepare('SELECT state FROM email_deliveries WHERE id=?').bind('csat:'+row.id).first<{state:string}>()
   state=delivery?.state==='failed'?'failed':'uncertain'
  }
  await env.DB.batch([
   env.DB.prepare('UPDATE csat_surveys SET state=?,updated_at=? WHERE id=?').bind(state,Date.now(),row.id),
   auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'csat.invitation',actor:{type:'system'},source:'system',target:{type:'survey',id:row.id},detail:{state,resolutionId:row.resolution_id}})
  ])
 }
 return {processed,configured:true}
}
