import {settingsGuard} from './procedure-authority'
import {auditStatement,requestSource} from '../audit/record'
import {failureCategory} from './tool-trace'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {memberAccess} from '../access/gate'
/** Attribute a resolution cycle to its last committed procedure answer within
 * that cycle. An attempted generation never establishes a resolved outcome. */
export const procedureCycles=`WITH attributed AS (SELECT r.id resolutionId,r.conversation_id conversationId,r.resolved_at resolvedAt,r.reopened_at reopenedAt,r.outcome,
 coalesce((SELECT decision='include' FROM procedure_attribution_reviews ar WHERE ar.resolution_id=r.id AND ar.project_id=r.project_id ORDER BY created_at DESC,rowid DESC LIMIT 1),1) included,
 (SELECT pg.version_id FROM ai_generations g JOIN procedure_generation pg ON pg.generation_id=g.id JOIN messages m ON m.project_id=g.project_id AND m.conversation_id=g.conversation_id AND m.local_id='generation:'||g.id AND m.actor_role='ai' WHERE g.project_id=r.project_id AND g.conversation_id=r.conversation_id AND m.revision>=r.cycle_start_revision AND m.revision<=r.resolved_revision ORDER BY m.revision DESC LIMIT 1) versionId,
 coalesce((SELECT score FROM csat_responses WHERE resolution_id=r.id),(SELECT value FROM conversation_ratings WHERE resolution_id=r.id)) score,
 coalesce((SELECT CASE WHEN scale='five' THEN score<=2 ELSE score<0 END FROM csat_responses WHERE resolution_id=r.id),(SELECT value=-1 FROM conversation_ratings WHERE resolution_id=r.id),0) negativeCsat
 FROM conversation_resolutions r WHERE r.project_id=?), cases AS (SELECT a.*,v.version,v.id procedureVersionId FROM attributed a JOIN procedure_versions v ON v.id=a.versionId WHERE v.project_id=? AND v.procedure_key=?)`
export async function validateProcedureProposal(env:Env,pid:string,key:string,proposal:any){
 if(proposal===undefined)return {}
 if(!proposal||typeof proposal.fromVersionId!=='string'||typeof proposal.expectedEffect!=='string'||!proposal.expectedEffect.trim()||proposal.expectedEffect.length>2000||!Array.isArray(proposal.resolutionIds)||proposal.resolutionIds.length<1||proposal.resolutionIds.length>50||new Set(proposal.resolutionIds).size!==proposal.resolutionIds.length)throw new HTTPException(400,{message:'Cite 1–50 resolution cycles, their source version and the expected effect'})
 const rows=await env.DB.prepare(`${procedureCycles} SELECT resolutionId,reopenedAt,score,negativeCsat FROM cases WHERE versionId=? AND resolutionId IN (${proposal.resolutionIds.map(()=>'?').join(',')})`).bind(pid,pid,key,proposal.fromVersionId,...proposal.resolutionIds).all<any>()
 if(rows.results.length!==proposal.resolutionIds.length||!rows.results.some(r=>r.reopenedAt||r.negativeCsat))throw new HTTPException(400,{message:'Cited cases must belong to this procedure/version and include a reopened or negative-CSAT cycle'})
 return {fromVersionId:proposal.fromVersionId,resolutionIds:proposal.resolutionIds,expectedEffect:proposal.expectedEffect}
}
export const procedureReportRoutes=new Hono<AppEnv>()
procedureReportRoutes.get('/projects/:projectId/procedure-reports/:key',async c=>{
 const pid=c.req.param('projectId'),key=c.req.param('key'),actor=await requireProject(c,pid,true)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('reports.view'))throw new HTTPException(403)
 c.header('Cache-Control','private, no-store')
 const offset=Number(c.req.query('offset')||0)
 if(!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400,{message:'Invalid case offset'})
 const [counts,cases,coverage,usage,production,reviews]=await Promise.all([
 c.env.DB.prepare(`${procedureCycles} SELECT versionId,version,count(*) originalDenominator,sum(included) denominator,sum(included=0) excluded,sum(included=1 AND reopenedAt IS NOT NULL) reopened,sum(included=1 AND score IS NOT NULL) rated,sum(included*negativeCsat) negativeCsat FROM cases GROUP BY versionId,version ORDER BY version`).bind(pid,pid,key).all<any>(),
 c.env.DB.prepare(`${procedureCycles} SELECT * FROM cases ORDER BY resolvedAt,resolutionId LIMIT 100 OFFSET ?`).bind(pid,pid,key,offset).all<any>(),
 c.env.DB.prepare(`SELECT v.id versionId,v.version,count(tc.id) cases,sum(tc.status='completed' AND coalesce(json_extract(tc.checks,'$.passed'),0)=1) passed,sum(tc.status='uncertain') uncertain FROM procedure_versions v LEFT JOIN training_runs r ON r.project_id=v.project_id AND json_extract(r.config,'$.procedureVersionId')=v.id LEFT JOIN training_cases tc ON tc.run_id=r.id WHERE v.project_id=? AND v.procedure_key=? GROUP BY v.id,v.version ORDER BY v.version`).bind(pid,key).all(),
 c.env.DB.prepare(`SELECT v.id versionId,v.version,g.id generationId,g.conversation_id conversationId,g.state,a.id attemptId,r.request_id requestId,r.observed,json_extract(r.usage_json,'$.input_tokens') inputTokens,json_extract(r.usage_json,'$.output_tokens') outputTokens,json_extract(r.usage_json,'$.cost') cost FROM procedure_versions v JOIN procedure_generation pg ON pg.version_id=v.id JOIN ai_generations g ON g.id=pg.generation_id LEFT JOIN ai_attempts a ON a.generation_id=g.id LEFT JOIN ai_round_usage r ON r.attempt_id=a.id WHERE v.project_id=? AND v.procedure_key=? ORDER BY v.version,g.id,a.id,r.request_id`).bind(pid,key).all<any>(),
 c.env.DB.prepare(`SELECT v.id versionId,v.version,g.id generationId,g.conversation_id conversationId,g.state,g.error,EXISTS(SELECT 1 FROM messages m WHERE m.project_id=g.project_id AND m.conversation_id=g.conversation_id AND m.local_id='generation:'||g.id AND m.actor_role='ai') committed,EXISTS(SELECT 1 FROM ai_tool_traces t WHERE t.generation_id=g.id AND t.state='handoff') handedOff FROM procedure_versions v JOIN procedure_generation pg ON pg.version_id=v.id JOIN ai_generations g ON g.id=pg.generation_id WHERE v.project_id=? AND v.procedure_key=? ORDER BY v.version,g.id`).bind(pid,key).all<any>(),
 c.env.DB.prepare(`${procedureCycles} SELECT ar.id,ar.resolution_id resolutionId,ar.decision,ar.reason,ar.evidence_message_id evidenceMessageId,ar.reviewed_by reviewedBy,ar.created_at createdAt FROM procedure_attribution_reviews ar JOIN cases ON cases.resolutionId=ar.resolution_id WHERE ar.project_id=? ORDER BY ar.created_at,ar.rowid`).bind(pid,pid,key,pid).all<any>()])
 const total=counts.results.reduce((n,r)=>n+r.originalDenominator,0),known=(x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>=0
 // Numeric allowlist only: prompts, errors, tool arguments and provider metadata stay private.
 const accounting=usage.results.map(r=>({...r,inputTokens:known(r.inputTokens)?r.inputTokens:null,outputTokens:known(r.outputTokens)?r.outputTokens:null,cost:known(r.cost)&&r.observed===1?r.cost:null}))
 const generations=production.results.map(g=>({versionId:g.versionId,version:g.version,generationId:g.generationId,conversationId:g.conversationId,state:g.state,customerMessageCommitted:g.committed===1,handedOff:g.handedOff===1,failureCategory:failureCategory(g.error)}))
 const productionVersions=[...new Set(generations.map(g=>g.versionId))].map(versionId=>{const rows=generations.filter(g=>g.versionId===versionId);return {versionId,generationDenominator:rows.length,committedAnswers:rows.filter(g=>g.customerMessageCommitted).length,handoffs:rows.filter(g=>g.handedOff).length,handoffRate:rows.filter(g=>g.handedOff).length/rows.length,failures:rows.filter(g=>g.failureCategory).length}})
 const clusters=[...new Set(generations.map(g=>g.failureCategory).filter(Boolean))].map(category=>({category,count:generations.filter(g=>g.failureCategory===category).length,cases:generations.filter(g=>g.failureCategory===category)}))
 return c.json({procedureKey:key,attributionReviews:reviews.results,productionVersions,failureClusters:clusters,generations,productionScope:'Generation and handoff rates use every linked generation, including failed and uncertain attempts. Native resolution-cycle denominators below remain separate.', attribution:'Last committed procedure answer inside each native resolution cycle; attempts without a committed answer and unversioned cycles are excluded from resolution denominators. A closed cycle is not verified recovery.',versions:counts.results.map(r=>({...r,reopenRate:r.denominator?r.reopened/r.denominator:null,negativeCsatRate:r.rated?r.negativeCsat/r.rated:null})),cases:cases.results,totalCases:total,nextOffset:offset+cases.results.length<total?offset+cases.results.length:null,evaluationCoverage:coverage.results,
  accounting,providerCostEstimateUsd:accounting.length&&accounting.every(r=>r.cost!==null)?accounting.reduce((sum,r)=>sum+r.cost,0):null,priceData:accounting.length&&accounting.every(r=>r.cost!==null)?'available':'unavailable',accountingScope:'All recorded rounds for linked generations, including failed and uncertain attempts; estimates are not savings or a customer balance.',toolOutcomes:{available:false,reason:'Business-tool outcomes are not recorded by this advice-only procedure surface.'}})
})

procedureReportRoutes.post('/projects/:projectId/procedure-reports/:key/cases/:resolutionId/review',async c=>{
 const pid=c.req.param('projectId'),key=c.req.param('key'),rid=c.req.param('resolutionId'),actor=await requireProject(c,pid,true),body=await c.req.json(),guard=settingsGuard(c)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('settings.manage'))throw new HTTPException(403)
 if(!['include','exclude'].includes(body.decision)||!(body.decision==='exclude'?['human-led','unrelated']:['procedure-contributed']).includes(body.reason)||typeof body.evidenceMessageId!=='string'||typeof body.quote!=='string'||!body.quote.trim()||body.quote.length>2000)throw new HTTPException(400,{message:'Choose an attribution decision and cite exact native human evidence'})
 const cycle=await c.env.DB.prepare(`${procedureCycles} SELECT resolutionId,conversationId FROM cases WHERE resolutionId=?`).bind(pid,pid,key,rid).first<any>()
 if(!cycle)throw new HTTPException(404)
 const id=crypto.randomUUID(),now=Date.now()
 const result=await c.env.DB.prepare(`INSERT INTO procedure_attribution_reviews SELECT ?,r.project_id,r.id,?,?,?,?,? FROM conversation_resolutions r JOIN messages m ON m.project_id=r.project_id AND m.conversation_id=r.conversation_id WHERE r.id=? AND r.project_id=? AND m.id=? AND m.revision>=r.cycle_start_revision AND m.revision<=r.resolved_revision AND m.erased_at IS NULL AND m.actor_role IN ('contact','owner','admin','operator') AND instr(m.content,?)>0 AND ${guard.sql}`).bind(id,body.decision,body.reason,body.evidenceMessageId,actor.id,now,rid,pid,body.evidenceMessageId,body.quote,...guard.args).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Evidence or review authority changed'})
 await auditStatement(c.env.DB,{projectId:pid,category:'data',action:'procedure.attribution.reviewed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'resolution',id:rid},detail:{decision:body.decision,reason:body.reason}}).run()
 return c.json({id,decision:body.decision,originalEvidencePreserved:true})
})
