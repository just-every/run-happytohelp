import {failureCategory} from './tool-trace'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject,hashToken} from '../../platform/auth'
import {memberAccess} from '../access/gate'

const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const usageFields=['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens','reasoning_tokens','cost'] as const
function measuredUsage(json:string|null){
 let source:any;try{source=JSON.parse(json||'null')}catch{}
 // Raw events, provider errors, prompts, tool arguments and unknown metadata never leave this door.
 return Object.fromEntries(usageFields.map(key=>[key,number(source?.[key])])) as Record<typeof usageFields[number],number|null>
}
function duration(start:string,end:string|null){const ms=Date.parse(end||'')-Date.parse(start);return Number.isFinite(ms)&&ms>=0?ms:null}
export const traceRoutes=new Hono<AppEnv>()
traceRoutes.get('/projects/:projectId/conversations/:conversationId/trace',async c=>{
 c.header('Cache-Control','private, no-store');c.header('Vary','Cookie, Authorization')
 const pid=c.req.param('projectId'),cid=c.req.param('conversationId'),actor=await requireProject(c,pid,true)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('reports.view'))throw new HTTPException(403,{message:'Report permission required'})
 if(!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE id=? AND project_id=?').bind(cid,pid).first())throw new HTTPException(404,{message:'Conversation not found'})
 const offset=Number(c.req.query('offset')||0)
 if(!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400,{message:'Invalid trace offset'})
 const generations=await c.env.DB.prepare(`SELECT g.id,g.state,g.kind,g.source_revision,g.source_context_revision,g.source_last_message_id,g.ai_id,g.ai_profile_json,g.error,g.created_at,g.updated_at,
  (SELECT id FROM messages WHERE project_id=g.project_id AND conversation_id=g.conversation_id AND local_id='generation:'||g.id AND actor_role='ai') message_id
  FROM ai_generations g WHERE g.project_id=? AND g.conversation_id=? ORDER BY g.created_at,g.id LIMIT 101 OFFSET ?`).bind(pid,cid,offset).all<any>()
 const traces=[]
 for(const g of generations.results.slice(0,100)){
  const [attempts,sources,tools]=await Promise.all([
   c.env.DB.prepare('SELECT id,state,started_at,finished_at FROM ai_attempts WHERE generation_id=? ORDER BY started_at,id').bind(g.id).all<any>(),
   c.env.DB.prepare('SELECT source_id id,source_version sourceVersion FROM ai_generation_sources WHERE generation_id=? AND project_id=? ORDER BY source_id,source_version').bind(g.id,pid).all<any>(),
   c.env.DB.prepare('SELECT id,tool_name toolName,state,started_at startedAt,finished_at finishedAt,approval,authority_scope requestedScope,error_category failureCategory,responsible_user_id responsibleHumanId FROM ai_tool_traces WHERE generation_id=? ORDER BY started_at,rowid').bind(g.id).all<any>()])
  const rounds=[]
  for(const attempt of attempts.results){
   const rows=await c.env.DB.prepare('SELECT request_id,usage_json,observed FROM ai_round_usage WHERE attempt_id=? ORDER BY request_id').bind(attempt.id).all<any>()
   rounds.push(...rows.results.map(row=>({attemptId:attempt.id,requestId:row.request_id,observed:row.observed===1,usage:measuredUsage(row.usage_json)})))
  }
  const completeCost=rounds.length>0&&rounds.every(r=>r.observed&&r.usage.cost!==null)
  traces.push({generationId:g.id,state:g.state,kind:g.kind,sourceRevision:g.source_revision,contextRevision:g.source_context_revision,sourceLastMessageId:g.source_last_message_id,
   assistantId:g.ai_id,assistantVersion:await hashToken(g.ai_profile_json),sources:sources.results,
   startedAt:g.created_at,finishedAt:['queued','running'].includes(g.state)?null:g.updated_at,durationMs:['queued','running'].includes(g.state)?null:duration(g.created_at,g.updated_at),
   attempts:attempts.results.map(a=>({attemptId:a.id,state:a.state,startedAt:a.started_at,finishedAt:a.finished_at,durationMs:duration(a.started_at,a.finished_at)})),rounds,
   providerCostEstimateUsd:completeCost?rounds.reduce((sum,r)=>sum+r.usage.cost!,0):null,priceData:completeCost?'available':'unavailable',
   result:{customerMessageCommitted:!!g.message_id,messageId:g.message_id||null},
   failureCategory:failureCategory(g.error),
   toolTrace:{available:true,calls:tools.results.map(t=>({...t,durationMs:t.finishedAt===null?null:t.finishedAt-t.startedAt,outcomeKnown:t.state!=='started',businessActionExecuted:false,verifiedBusinessResult:false})),redaction:'Server-selected tool names, scope and timing only; arguments, output text and provider errors are excluded. A completed read or proposal is not an executed business action.'},
   procedure:(await c.env.DB.prepare('SELECT pg.version_id versionId,pg.release_id releaseId,v.procedure_key procedureKey,v.version,r.state releaseState,r.regression_resolution_id regressionResolutionId FROM procedure_generation pg JOIN procedure_versions v ON v.id=pg.version_id AND v.project_id=? JOIN procedure_releases r ON r.id=pg.release_id AND r.project_id=v.project_id WHERE pg.generation_id=?').bind(pid,g.id).first())||{available:false,reason:'No versioned procedure is linked to this generation.'}})
 }
 return c.json({conversationId:cid,traces,limit:100,nextOffset:generations.results.length>100?offset+100:null,accounting:'Provider cost estimates describe recorded usage, not a customer balance or savings.'})
})
