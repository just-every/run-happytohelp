import type {Env} from '../../platform/env'
import {dimensions,settings} from '../triage/model'
import {applyWorkflowActions,type WorkflowGuard} from './actions'
import {ruleTicket,type RuleDefinition} from './rule-model'
import type {Conditions} from './conditions'
const readsTriage=(conditions:Conditions,prefix='field:triage_')=>[...conditions.all,...conditions.any].some(c=>c.field.startsWith(prefix))
/** The latest triage outcome for a ticket and the guard that pins it at commit. */
async function triageVerdict(env:Env,ticket:any){
 const s=await settings(env,ticket.project_id)
 const job=await env.DB.prepare('SELECT * FROM triage_jobs WHERE project_id=? AND conversation_id=? ORDER BY source_revision DESC LIMIT 1').bind(ticket.project_id,ticket.id).first<any>()
 const label=await env.DB.prepare('SELECT max(rowid) version FROM triage_labels WHERE project_id=? AND conversation_id=?').bind(ticket.project_id,ticket.id).first<{version:number|null}>()
 const guard:WorkflowGuard={sql:`EXISTS(SELECT 1 FROM triage_settings s WHERE s.project_id=c.project_id AND s.version=? AND s.enabled=1) AND (SELECT id FROM triage_jobs j WHERE j.conversation_id=c.id ORDER BY source_revision DESC LIMIT 1) IS ? AND (SELECT updated_at FROM triage_jobs j WHERE j.id=?) IS ? AND (SELECT max(rowid) FROM triage_labels l WHERE l.conversation_id=c.id) IS ?`,params:[s.version,job?.id??null,job?.id??null,job?.updated_at??null,label?.version??null]}
 const p=job?.predictions_json?JSON.parse(job.predictions_json):null
 const latestCustomer=await env.DB.prepare("SELECT max(revision) revision FROM messages WHERE conversation_id=? AND actor_role='contact'").bind(ticket.id).first<{revision:number}>()
 const confident=s.enabled&&job?.state==='complete'&&job.source_revision===latestCustomer?.revision&&!!p&&dimensions.every(field=>p[field]?.confidence>=s.threshold)&&s.taxonomy.some((t:any)=>t.id===ticket.fields?.triage_intent&&t.active)
 return {settings:s,job,confident,guard}
}

/** Only a rule that reads a triage field depends on triage. Every other rule keeps
 * its R5 meaning whatever triage is doing. A triage rule passes only on a confident
 * result for the latest customer message, and an intent rule also needs the lead's
 * routing approval; classification writes the triage fields, whose change events
 * evaluate the rule again. Returns the commit guard, or null when the rule waits. */
export async function triageRuleGate(env:Env,ticket:any,conditions:Conditions):Promise<WorkflowGuard|null>{
 if(!readsTriage(conditions))return {sql:'1',params:[]}
 const verdict=await triageVerdict(env,ticket)
 return verdict.confident&&(verdict.settings.routing_enabled||!readsTriage(conditions,'field:triage_intent'))?verdict.guard:null
}

/** Event/time assignment actions use the same extra triage condition as queue
 * rules. Rules unrelated to triage never enter this path. */
export async function triageAssignmentGuard(env:Env,ticket:any,definition:RuleDefinition){
 if(!readsTriage(definition.conditions))return null
 const live=await ruleTicket(env,ticket.project_id,ticket.id)
 return (live&&await triageRuleGate(env,live,definition.conditions))??{sql:'0',params:[]}
}

/** When a triage job ends unsure or failed, an unplaced ticket goes to the lead's
 * default queue once. A ticket a teammate or rule has assigned or queued, at any
 * time, keeps that choice. */
export async function placeUnsureTicket(env:Env,projectId:string,conversationId:string,jobId:string){
 const ticket=await ruleTicket(env,projectId,conversationId)
 if(!ticket||ticket.assigned_to||ticket.group_id||['solved','closed'].includes(ticket.status_category))return
 const verdict=await triageVerdict(env,ticket),group=verdict.settings.default_group_id
 if(!verdict.settings.enabled||verdict.confident||verdict.job?.id!==jobId||!['complete','unavailable'].includes(verdict.job.state)||!group)return
 await applyWorkflowActions(env,{projectId,conversationId,id:`triage-default:${jobId}`,source:'rule',actorId:'triage default queue',expectedVersion:ticket.ticket_version,expectedRevision:ticket.revision,expectedLastMessageId:ticket.last_message_id,actions:[{type:'assign',user_id:null,group_id:group}],guard:{sql:`(${verdict.guard.sql}) AND c.assigned_to IS NULL AND c.group_id IS NULL AND EXISTS(SELECT 1 FROM ticket_groups g WHERE g.project_id=c.project_id AND g.id=?) AND NOT EXISTS(SELECT 1 FROM ticket_history h WHERE h.conversation_id=c.id AND (json_extract(h.changes_json,'$.group_id.from') IS NOT json_extract(h.changes_json,'$.group_id.to') OR json_extract(h.changes_json,'$.assigned_to.from') IS NOT json_extract(h.changes_json,'$.assigned_to.to')))`,params:[...verdict.guard.params,group]}})
}
