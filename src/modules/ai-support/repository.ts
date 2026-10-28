import {assistanceProfileSql,replyProfileSql} from './selection'
import {assertModelConfigured,AiConfigurationError} from './configuration'
import {publishSuggestions} from './presentation'
import type { Actor,Env } from '../../platform/env'
import {admitAutomaticReply,ceilingSkipToday,recordAutomaticReplySpend,recordSkippedReply,type ReplyAdmission} from './reply-ceiling'
export interface Generation {id:string;project_id:string;conversation_id:string;state:string;error:string|null;created_at:string;source_revision:number;source_context_revision:number;source_last_message_id:string|null;actor_json:string;model:string;ai_id:string;ai_profile_json:string;kind:string;instruction:string;options_json:string}
/** Internal transition predicates, supplied by the assignment writer, never a client. */
export interface AssignmentReplyGuard {sql:string;params:unknown[]}
/** Command identity must not depend on which writer serialized the actor: the email
 * receipt, the session row and the scheduler's replay build the same actor with different
 * key orders, and rows stored before canonical serialization keep their writer's order. */
export function canonicalActorJson(actor:unknown):string{
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value
 return JSON.stringify(canonical(actor))
}
function commandOptions(json:string){try{const options=JSON.parse(json);delete options.application_origin;delete options.operator_session_hash;return JSON.stringify(options)}catch{return null}}
function storedActorJson(actorJson:string){try{return canonicalActorJson(JSON.parse(actorJson))}catch{return null}}
export async function requestGeneration(env:Env,input:{projectId:string;conversationId:string;actor:Actor;sessionHash?:string;expectedRevision:number;id?:string;kind?:'reply'|'suggestions';instruction?:string;options?:{tool?:string;message?:string;client_request_id?:string;display_request_version?:number;loading_message?:string}},configurationFailure:'reject'|'record'='reject',assignmentGuard?:AssignmentReplyGuard){
 const profileSql=input.kind==='suggestions'?assistanceProfileSql:replyProfileSql
 const selected=await env.DB.prepare(`SELECT a.model FROM conversations c JOIN ai_profiles a ON a.id=${profileSql} AND a.project_id=c.project_id AND a.is_enabled=1 WHERE c.project_id=? AND c.id=?`).bind(input.projectId,input.conversationId).first<{model:string}>()
 if(!selected)throw new AiConfigurationError('enabled selected conversation AI')
 let configurationError:string|null=null
 try{assertModelConfigured(env,selected.model)}catch(error){if(configurationFailure==='reject')throw error;configurationError=String(error)}
 if(input.actor.projectId!==input.projectId)throw new Error('Project access denied')
 if(input.instruction && (input.actor.role==='contact'||input.instruction.length>16000))throw new Error('Operator instruction denied or too long')
 if(input.options?.tool&&!['improve','extend','shorten','complete'].includes(input.options.tool))throw new Error('Unknown assistant editing tool')
 if(input.options&&input.actor.role==='contact')throw new Error('Operator options denied')
 const clientOptions={...input.options};delete (clientOptions as Record<string,unknown>).application_origin;delete (clientOptions as Record<string,unknown>).operator_session_hash
 const optionsJson=JSON.stringify({...clientOptions,...(input.sessionHash?{operator_session_hash:input.sessionHash}:{}),...(env.APP_ORIGIN?{application_origin:new URL(String(env.APP_ORIGIN)).origin}: {})})
 const actorJson=canonicalActorJson(input.actor)
 if(optionsJson.length>40000)throw new Error('Operator options too long')
 const id=input.id||crypto.randomUUID(),now=new Date().toISOString()
 const existing=await env.DB.prepare('SELECT * FROM ai_generations WHERE id=?').bind(id).first<Generation>()
 if(existing){if(existing.project_id!==input.projectId||existing.conversation_id!==input.conversationId||existing.source_revision!==input.expectedRevision||storedActorJson(existing.actor_json)!==actorJson||existing.kind!==(input.kind||'reply')||existing.instruction!==(input.instruction||'')||commandOptions(existing.options_json)!==JSON.stringify(clientOptions))throw new Error('Generation command conflict');return ceilingSkipToday(existing)?{id,state:existing.state,ceilingReached:true}:{id,state:existing.state}}
 if(input.kind==='suggestions'&&!input.options?.tool){
  const conversation=await env.DB.prepare('SELECT last_message_id FROM conversations WHERE id=? AND project_id=?').bind(input.conversationId,input.projectId).first<{last_message_id:string|null}>()
  if(!conversation?.last_message_id)throw new Error('CONVERSATION_MESSAGE_REQUIRED: Add a customer message first')
 }
 await env.DB.prepare('INSERT OR IGNORE INTO context_subjects(project_id,subject_id) SELECT project_id,contact_id FROM conversations WHERE id=? AND project_id=?').bind(input.conversationId,input.projectId).run()
 // Visitor-caused generations spend installation provider keys: reserve them against the daily ceilings.
 // A ceiling hit is recorded as a terminal failed generation with its reason; it is never queued or replayed.
 // The reason (which ceiling, the project's spend) is operator-only: callers learn only ceilingReached.
 const admission:ReplyAdmission|null=input.actor.role==='contact'&&!configurationError?await admitAutomaticReply(env,input.projectId):null
 const skipped=admission&&!admission.admitted?admission.reason:null
 const result=await env.DB.prepare(`INSERT OR IGNORE INTO ai_generations(id,project_id,conversation_id,state,source_revision,source_context_revision,source_last_message_id,actor_json,model,ai_id,ai_profile_json,kind,instruction,options_json,created_at,updated_at,error)
 SELECT ?,c.project_id,c.id,?,c.revision,(SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id),c.last_message_id,?,a.model,a.id,json_object('id',a.id,'model',a.model,'prompt',a.prompt),?,?,?,?,?,?
 FROM conversations c JOIN ai_profiles a ON a.id=${profileSql} AND a.project_id=c.project_id AND a.is_enabled=1
 WHERE c.id=? AND c.project_id=? AND c.revision=? AND c.resolved_at IS NULL AND (? != 'contact' OR c.contact_id=?) ${assignmentGuard?`AND (${assignmentGuard.sql})`:''}`).bind(id,configurationError||skipped?'failed':'queued',actorJson,input.kind||'reply',input.instruction||'',optionsJson,now,now,configurationError||skipped,input.conversationId,input.projectId,input.expectedRevision,input.actor.role,input.actor.contactId||input.actor.id,...(assignmentGuard?.params||[])).run()
 if(!result.meta.changes){if(admission?.admitted)await admission.refund();if(assignmentGuard){const winner=await env.DB.prepare('SELECT state FROM ai_generations WHERE id=? AND project_id=? AND conversation_id=?').bind(id,input.projectId,input.conversationId).first<{state:string}>();if(winner)return {id,state:winner.state}}throw new Error('Generation admission denied or command already exists')}
 if(input.kind==='suggestions'){await env.DB.prepare("UPDATE ai_generations SET state='superseded' WHERE project_id=? AND conversation_id=? AND kind='suggestions' AND state IN ('queued','running') AND rowid<(SELECT rowid FROM ai_generations WHERE id=?)").bind(input.projectId,input.conversationId,id).run();await publishSuggestions(env,input.projectId,input.conversationId)}
 if(configurationError)return {id,state:'failed'}
 if(skipped){await recordSkippedReply(env,input.projectId);return {id,state:'failed',ceilingReached:true}}
 // The persisted queued record is authoritative; scheduled recovery resends this ID if dispatch fails.
 await env.JOBS.send({type:'ai.generate',id,projectId:input.projectId})
 return {id,state:'queued'}
}
export async function saveEvent(env:Env,attemptId:string,event:any){
 if(['agent_start','cost_update','agent_done','error','stream_end'].includes(event.type))await env.DB.prepare('INSERT INTO ai_attempt_events(attempt_id,type,event_json,created_at) VALUES(?,?,?,?)').bind(attemptId,event.type,JSON.stringify(event),new Date().toISOString()).run()
 if(event.type==='agent_start' && event.request_id)await env.DB.prepare('INSERT OR IGNORE INTO ai_round_usage(attempt_id,request_id,model) VALUES(?,?,?)').bind(attemptId,event.request_id,event.agent?.model||null).run()
 if(event.type==='cost_update'&&event.request_id)await recordAutomaticReplySpend(env,attemptId,event.request_id,event.usage?.cost)
 if(event.type==='cost_update'&&event.request_id)await env.DB.prepare(`INSERT INTO ai_round_usage(attempt_id,request_id,model,usage_json,observed) VALUES(?,?,?,?,1) ON CONFLICT(attempt_id,request_id) DO UPDATE SET model=excluded.model,usage_json=excluded.usage_json,observed=1`).bind(attemptId,event.request_id,event.usage?.model||null,JSON.stringify(event.usage)).run()
}
export async function transition(env:Env,id:string,state:string,error?:unknown){await env.DB.prepare("UPDATE ai_generations SET state=?,error=?,updated_at=? WHERE id=? AND state='running'").bind(state,error?String(error).slice(0,2000):null,new Date().toISOString(),id).run()}
