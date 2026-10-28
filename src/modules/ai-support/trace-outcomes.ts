import type {Env} from '../../platform/env'

const unknown=(reason:string)=>({state:'unknown' as const,reason,cycle:null})
const kinds=new Set(['ai','assisted','human','unknown'])
/** Join retained contributions, never text or the conversation's latest label.
 * More than one matching cycle is ambiguous, even if its feedback agrees. */
export async function traceOutcomes(env:Env,projectId:string,conversationId:string,ids:string[]){
 const slots=ids.map(()=>'?').join(',')
 const rows=await env.DB.prepare(`SELECT a.source_id generation_id,a.kind,a.source_kind,m.id message_id,m.revision,m.erased_at,
 r.id resolution_id,r.resolved_at,r.reopened_at,r.outcome,
 json_extract(r.evidence_json,'$.historicalResolutionOrderUnknown') order_unknown,
 cs.scale,cs.score,cs.revision rating_revision,
 (EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=r.project_id AND e.contact_id=r.contact_id)
 OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=r.project_id AND ct.id=r.contact_id
 AND (json_extract(ct.metadata_json,'$.is_erasing')=1 OR json_extract(ct.metadata_json,'$.is_erased')=1))) cycle_erased
 FROM message_authorship a JOIN messages m ON m.id=a.message_id AND m.project_id=a.project_id
 LEFT JOIN conversation_resolutions r ON r.project_id=m.project_id AND r.conversation_id=m.conversation_id
 AND m.revision>r.cycle_start_revision AND m.revision<=r.resolved_revision
 LEFT JOIN csat_responses cs ON cs.resolution_id=r.id AND cs.project_id=r.project_id AND cs.contact_id=r.contact_id
 WHERE a.project_id=? AND m.conversation_id=? AND a.source_id IN (${slots})
 AND ((a.kind='ai' AND a.source_kind='generation') OR (a.kind='assisted' AND a.source_kind='ai-draft'))
 ORDER BY m.revision,m.id`).bind(projectId,conversationId,...ids).all<any>()
 return (id:string,kind:string,state:string)=>{
  const contributions=rows.results.filter(row=>row.generation_id===id)
  if(!contributions.length)return {contribution:state==='uncertain'?'uncertain attempt':['failed','cancelled','superseded'].includes(state)?'failed attempt':kind==='suggestions'?'unsent suggestion':'unavailable',committedAnswer:null,outcome:unknown(kind==='suggestions'?'No retained adoption of this suggestion.':'No retained committed authorship for this execution.')}
  const answer=contributions[0]
  const contribution=answer.kind==='assisted'?'adopted suggestion':'direct AI answer'
  const committedAnswer=answer.erased_at?null:{id:answer.message_id,revision:answer.revision}
  if(contributions.some(row=>row.erased_at||row.cycle_erased))return {contribution,committedAnswer:null,outcome:unknown('Contribution or cycle evidence was erased.')}
  const resolutions=new Set(contributions.map(row=>row.resolution_id))
  if(resolutions.size!==1||contributions.some(row=>row.order_unknown===1))return {contribution,committedAnswer,outcome:unknown('Retained contributions do not identify one unambiguous resolution cycle.')}
  if(!answer.resolution_id)return {contribution,committedAnswer,outcome:unknown('No recorded resolution cycle contains this contribution yet.')}
  return {contribution,committedAnswer,outcome:{state:'recorded' as const,reason:null,cycle:{id:answer.resolution_id,resolvedAt:new Date(answer.resolved_at).toISOString(),attribution:kinds.has(answer.outcome)?answer.outcome:'unknown',rating:answer.scale==='thumbs'||answer.scale==='five'?{scale:answer.scale,value:answer.score,revision:answer.rating_revision}:null,reopenedAt:answer.reopened_at===null?null:new Date(answer.reopened_at).toISOString()}}}
 }
}
