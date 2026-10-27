import type {Env} from '../../platform/env'

const parse=(value:string|null)=>{try{return JSON.parse(value||'null')}catch{return null}}
const states=new Set(['queued','running','completed','uncertain','cancelled','superseded','failed'])
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const duration=(start:string,end:string|null)=>end?number(Date.parse(end)-Date.parse(start)):null
/** Only metadata selected here crosses the operator door. Never return provider events or error text. */
export async function conversationTrace(env:Env,projectId:string,conversationId:string){
 const conversation=await env.DB.prepare('SELECT id FROM conversations WHERE id=? AND project_id=?').bind(conversationId,projectId).first()
 if(!conversation)return null
 const rows=await env.DB.prepare('SELECT id,state,source_revision,source_context_revision,actor_json,ai_profile_json,kind,created_at,error FROM ai_generations WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC,id LIMIT 50').bind(projectId,conversationId).all<any>()
 if(!rows.results.length)return {generations:[],limit:50}
 const ids=rows.results.map(row=>row.id),slots=ids.map(()=>'?').join(',')
 // A bounded set of reads also works within the free Worker's query allowance.
 const [attemptRows,roundRows,sourceRows,answerRows,handoffRows,eventRows]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT * FROM ai_attempts WHERE generation_id IN (${slots})`).bind(...ids),
  env.DB.prepare(`SELECT t.generation_id,u.observed,u.usage_json FROM ai_round_usage u JOIN ai_attempts t ON t.id=u.attempt_id WHERE t.generation_id IN (${slots})`).bind(...ids),
  env.DB.prepare(`SELECT generation_id,source_id,source_version FROM ai_generation_sources WHERE project_id=? AND generation_id IN (${slots})`).bind(projectId,...ids),
  env.DB.prepare(`SELECT id,revision,local_id FROM messages WHERE project_id=? AND conversation_id=? AND actor_role='ai' AND local_id IN (${slots})`).bind(projectId,conversationId,...ids.map(id=>`generation:${id}`)),
  env.DB.prepare(`SELECT generation_id FROM ai_handoff_receipts WHERE project_id=? AND conversation_id=? AND generation_id IN (${slots})`).bind(projectId,conversationId,...ids),
  env.DB.prepare(`SELECT t.generation_id,e.event_json FROM ai_attempt_events e JOIN ai_attempts t ON t.id=e.attempt_id WHERE e.type='tool_trace' AND t.generation_id IN (${slots}) ORDER BY e.id LIMIT 5000`).bind(...ids),
 ])
 const generations=[]
 for(const row of rows.results){
  const attempt=attemptRows.results.find(item=>item.generation_id===row.id)
  const rounds=roundRows.results.filter(item=>item.generation_id===row.id)
  const sources=sourceRows.results.filter(item=>item.generation_id===row.id).map(({source_id,source_version})=>({source_id,source_version}))
  const committed=answerRows.results.find(item=>item.local_id===`generation:${row.id}`)
  const answer=committed?{id:committed.id,revision:committed.revision}:null
  const handoff=handoffRows.results.some(item=>item.generation_id===row.id)
  const events=eventRows.results.filter(item=>item.generation_id===row.id).slice(0,100)
  const actor=parse(row.actor_json),error=String(attempt?.error||row.error||'')
  const timedOut=/GENERATION_DEADLINE|TimeoutError|timed?\s*out/i.test(error)
  generations.push({id:row.id,state:states.has(row.state)?row.state:'uncertain',
   source:{assistantVersion:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.ai_profile_json)))).map(n=>n.toString(16).padStart(2,'0')).join(''),conversationRevision:row.source_revision,contextRevision:row.source_context_revision,knowledge:sources},
   requestedScope:row.kind==='suggestions'?'operator suggestions':'conversation reply',
   approval:actor?.role==='contact'?'automatic assistant policy':['owner','admin','operator'].includes(actor?.role)?'explicit operator request':'unavailable',
   timing:{requestedAt:row.created_at,startedAt:attempt?.started_at||null,finishedAt:attempt?.finished_at||null,durationMs:attempt?duration(attempt.started_at,attempt.finished_at):null},
   providerOutcome:timedOut?'timeout':rounds.length?(row.state==='completed'?'completed':'unknown'):'not observed',
   result:handoff?'handoff':answer?'committed answer':row.state==='uncertain'?'unknown':'no committed answer',
   committedAnswer:answer||null,
   usage:rounds.map(round=>{const usage=parse(round.usage_json);return {observed:!!round.observed,inputTokens:number(usage?.input_tokens),outputTokens:number(usage?.output_tokens)}}),
   // Token accounting alone cannot establish a priced, reconciled USD amount.
   providerCostUsd:null,
   tools:events.map(event=>{const e=parse(event.event_json);return {name:toolName(e?.name),outcome:['started','completed','denied','handoff','timeout','unknown'].includes(e?.outcome)?e.outcome:'unknown',durationMs:number(e?.durationMs)}}),
  })
 }
 return {generations,limit:50}
}
const toolNames=new Set(['search_knowledge','read_knowledge_source','cite_knowledge','read_conversation_entry','read_conversation_history','search_conversation_history','switch_agent','repo_search','repo_read_file'])
export const toolName=(name:unknown)=>typeof name==='string'&&toolNames.has(name)?name:'other tool'
