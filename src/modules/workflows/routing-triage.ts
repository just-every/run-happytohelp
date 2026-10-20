import type {Env} from '../../platform/env'
import {dimensions,settings} from '../triage/model'
import {applyWorkflowActions} from './actions'
import type {Conditions} from './conditions'
/** Existing rules retain their meaning. Intent is an additional native field
 * condition whose use for assignment needs measured, explicit lead approval. */
export async function triageRouting(env:Env,ticket:any,event:string){
 const s=await settings(env,ticket.project_id)
 if(!s.enabled)return {eligible:(conditions:Conditions)=>![...conditions.all,...conditions.any].some(c=>c.field==='field:triage_intent'),guard:{sql:'1',params:[] as unknown[]}}
 const job=await env.DB.prepare('SELECT * FROM triage_jobs WHERE project_id=? AND conversation_id=? ORDER BY source_revision DESC LIMIT 1').bind(ticket.project_id,ticket.id).first<any>()
 const label=await env.DB.prepare('SELECT max(rowid) version FROM triage_labels WHERE project_id=? AND conversation_id=?').bind(ticket.project_id,ticket.id).first<{version:number|null}>()
 const guard={sql:`EXISTS(SELECT 1 FROM triage_settings s WHERE s.project_id=c.project_id AND s.version=? AND s.enabled=1) AND (SELECT id FROM triage_jobs j WHERE j.conversation_id=c.id ORDER BY source_revision DESC LIMIT 1) IS ? AND (SELECT updated_at FROM triage_jobs j WHERE j.id=?) IS ? AND (SELECT max(rowid) FROM triage_labels l WHERE l.conversation_id=c.id) IS ?`,params:[s.version,job?.id??null,job?.id??null,job?.updated_at??null,label?.version??null] as unknown[]}
 const p=job?.predictions_json?JSON.parse(job.predictions_json):null
 const latestCustomer=await env.DB.prepare("SELECT max(revision) revision FROM messages WHERE conversation_id=? AND actor_role='contact'").bind(ticket.id).first<{revision:number}>()
 const confident=job?.state==='complete'&&job.source_revision===latestCustomer?.revision&&p&&dimensions.every(field=>p[field]?.confidence>=s.threshold)&&s.taxonomy.some((t:any)=>t.id===ticket.fields?.triage_intent&&t.active)
 if(!confident){
  const group=s.default_group_id&&await env.DB.prepare('SELECT id FROM ticket_groups WHERE project_id=? AND id=?').bind(ticket.project_id,s.default_group_id).first()?s.default_group_id:null
  if(ticket.group_id!==group){const result=await applyWorkflowActions(env,{projectId:ticket.project_id,conversationId:ticket.id,id:`triage-default:${ticket.id}:${event}`,source:'rule',actorId:'triage default queue',expectedVersion:ticket.ticket_version,expectedRevision:ticket.revision,expectedLastMessageId:ticket.last_message_id,actions:[{type:'assign',user_id:null,group_id:group}],guard:{sql:`(${guard.sql}) AND c.assigned_to IS NULL`,params:guard.params}});if(result.state!=='complete')return {held:{state:'pending' as const,explanation:'Default queue changed concurrently'},eligible:()=>false,guard}}
  return {held:{state:'skipped' as const,explanation:job?.reason??'Triage is pending, unavailable or below the lead’s confidence threshold; the default queue is responsible'},eligible:()=>false,guard}
 }
 return {eligible:(conditions:Conditions)=>s.routing_enabled||![...conditions.all,...conditions.any].some(c=>c.field==='field:triage_intent'),guard}
}
