import {redactKnowledgeDraft} from '../knowledge/proposals'
import {validateProcedureProposal,procedureCycles} from './procedure-reports'
import {settingsGuard} from './procedure-authority'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import {auditStatement,requestSource} from '../audit/record'
import {activeSourceProjectSql} from '../knowledge/public-sources'
import {contactAvailableSql} from '../conversations/contact-privacy'
const root='/projects/:projectId/procedures'


// Procedures can narrow the existing read-only tool surface. They cannot confer
// business-action authority that the application does not implement.
export const procedureTools=['search_knowledge','read_knowledge_source','cite_knowledge','read_conversation_entry','read_conversation_history','search_conversation_history','propose_followup','list_followup_dependencies']
const validText=(value:unknown,max:number)=>typeof value==='string'&&!!value.trim()&&value.length<=max
export const procedureRoutes=new Hono<AppEnv>()
procedureRoutes.use(root+'*',async(c,next)=>{
 const pid=c.req.param('projectId')!,actor=await requireProject(c,pid,true)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('settings.manage'))throw new HTTPException(403,{message:'Procedure settings permission required'})
 c.header('Cache-Control','private, no-store');await next()
})
procedureRoutes.get(root,async c=>{
 const pid=c.req.param('projectId')!,[versions,releases]=await Promise.all([c.env.DB.prepare('SELECT * FROM advice_procedure_versions WHERE project_id=? ORDER BY procedure_key,version').bind(pid).all<any>(),c.env.DB.prepare('SELECT * FROM procedure_releases WHERE project_id=? ORDER BY created_at,id').bind(pid).all()])
 return c.json({versions:versions.results.map(v=>({...v,config:JSON.parse(v.config_json),proposal:JSON.parse(v.proposal_json),config_json:undefined,proposal_json:undefined})),releases:releases.results,businessActionsAvailable:false})
})
procedureRoutes.get(root+'/:key/versions/:versionId/replay-preview',async c=>{
 const pid=c.req.param('projectId')!,key=c.req.param('key')!,version=await c.env.DB.prepare('SELECT proposal_json FROM advice_procedure_versions WHERE id=? AND project_id=? AND procedure_key=?').bind(c.req.param('versionId')!,pid,key).first<{proposal_json:string}>()
 if(!version)throw new HTTPException(404)
 const proposal=JSON.parse(version.proposal_json),cases=[]
 for(const resolutionId of proposal.resolutionIds||[]){
  const cycle=await c.env.DB.prepare(`${procedureCycles} SELECT cases.*,c.contact_id,ct.name,r.cycle_start_revision,r.resolved_revision FROM cases JOIN conversations c ON c.id=cases.conversationId AND c.project_id=? JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id JOIN conversation_resolutions r ON r.id=cases.resolutionId WHERE cases.resolutionId=? AND cases.versionId=? AND ${contactAvailableSql()}`).bind(pid,pid,key,pid,resolutionId,proposal.fromVersionId).first<any>()
  if(!cycle)continue
  const messages=await c.env.DB.prepare("SELECT id,actor_role,content,revision FROM messages WHERE project_id=? AND conversation_id=? AND revision>=? AND revision<=? AND actor_role='contact' AND erased_at IS NULL ORDER BY revision LIMIT 51").bind(pid,cycle.conversationId,cycle.cycle_start_revision,cycle.resolved_revision).all<any>()
  if(messages.results.length>50)throw new HTTPException(409,{message:'This case exceeds the bounded replay preview; choose a smaller cited cycle'})
  cases.push({resolutionId,conversationId:cycle.conversationId,sourceVersionId:cycle.versionId,reopened:!!cycle.reopenedAt,negativeCsat:!!cycle.negativeCsat,messages:messages.results.map(m=>({evidenceId:'message:'+m.id,role:'contact',content:redactKnowledgeDraft(m.content,cycle.name)}))})
 }
 return c.json({cases,expectedEffect:proposal.expectedEffect||null,executionAvailable:false,privacyDefault:'Historical customer text stays in the support workspace. Automatic transfer into model replay evaluations is held pending an explicit privacy/retention ruling; this masked preview sends no provider request.'})
})
procedureRoutes.post(root+'/:key/versions',async c=>{
 const pid=c.req.param('projectId')!,key=c.req.param('key')!,b=await c.req.json(),id=crypto.randomUUID(),now=Date.now()
 if(!/^[a-z0-9-]{1,80}$/.test(key)||!validText(b.instructions,16000)||!validText(b.intent,200)||!validText(b.model,200))throw new HTTPException(400,{message:'Procedure key, intent, instructions and model are required'})
 const config=b.config
 if(!config||Object.keys(config).some(k=>!['tools','humanEscalation','maxCost','maxTokens'].includes(k))||!Array.isArray(config.tools)||config.tools.some((x:any)=>!procedureTools.includes(x))||new Set(config.tools).size!==config.tools.length||typeof config.humanEscalation!=='string'||!config.humanEscalation.trim()||!Number.isFinite(config.maxCost)||config.maxCost<=0||config.maxCost>1000||!Number.isInteger(config.maxTokens)||config.maxTokens<1||config.maxTokens>32000||JSON.stringify(config).length>16000)throw new HTTPException(400,{message:'Declare bounded evaluation cost/tokens, enabled read-only tools and human escalation'})
 const proposal=await validateProcedureProposal(c.env,pid,key,b.proposal)
 const guard=settingsGuard(c)
 const result=await c.env.DB.prepare(`INSERT INTO advice_procedure_versions SELECT ?,?,?,(SELECT coalesce(max(version),0)+1 FROM advice_procedure_versions WHERE project_id=? AND procedure_key=?),?,?,?,?,?,?,? WHERE ${guard.sql} RETURNING id,version`).bind(id,pid,key,pid,key,b.intent,b.instructions,b.model,JSON.stringify(config),JSON.stringify(proposal),c.get('actor').id,now,...guard.args).first()
 if(!result)throw new HTTPException(409,{message:'Procedure authority changed'})
 await auditStatement(c.env.DB,{projectId:pid,category:'data',action:'procedure.version.created',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'procedure_version',id}}).run()
 return c.json(result,201)
})
procedureRoutes.post(root+'/:key/releases',async c=>{
 const pid=c.req.param('projectId')!,key=c.req.param('key')!,b=await c.req.json(),id=crypto.randomUUID(),now=Date.now()
 if(!validText(b.versionId,200)||!validText(b.evaluationId,200)||!Number.isInteger(b.cohortLimit)||b.cohortLimit<1||b.cohortLimit>100)throw new HTTPException(400,{message:'Choose a bounded cohort of 1–100 conversations'})
 // Clients cannot supply checks or a pass flag. Only this exact version's
 // completed runner receipts, with every declared assertion passing, qualify.
 const guard=settingsGuard(c)
 const result=await c.env.DB.prepare(`INSERT INTO procedure_releases(id,project_id,procedure_key,version_id,evaluation_id,cohort_limit,state,approved_by,created_at,stopped_at) SELECT ?,v.project_id,v.procedure_key,v.id,r.id,?,'active',?, ?,NULL FROM advice_procedure_versions v JOIN training_runs r ON r.project_id=v.project_id AND json_extract(r.config,'$.procedureVersionId')=v.id WHERE v.id=? AND v.project_id=? AND v.procedure_key=? AND r.id=? AND (v.proposal_json='{}' OR (SELECT state FROM procedure_reviews WHERE version_id=v.id ORDER BY created_at DESC,rowid DESC LIMIT 1)='approved') AND r.status='completed' AND r.case_count>0 AND (SELECT count(*) FROM training_cases tc WHERE tc.run_id=r.id)=r.case_count AND NOT EXISTS(SELECT 1 FROM training_cases tc WHERE tc.run_id=r.id AND (tc.status<>'completed' OR coalesce(json_extract(tc.checks,'$.passed'),0)<>1)) AND NOT EXISTS(SELECT 1 FROM procedure_releases WHERE project_id=v.project_id AND procedure_key=v.procedure_key AND state='active') AND ${guard.sql}`).bind(id,b.cohortLimit,c.get('actor').id,now,b.versionId,pid,key,b.evaluationId,...guard.args).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'This exact version needs completed passing evaluations and no active release'})
 await auditStatement(c.env.DB,{projectId:pid,category:'approval',action:'procedure.release.approved',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'procedure_release',id}}).run()
 return c.json({id,versionId:b.versionId,state:'active',cohortLimit:b.cohortLimit},201)
})
procedureRoutes.post(root+'/:key/releases/:releaseId/cohort',async c=>{
 const pid=c.req.param('projectId')!,rid=c.req.param('releaseId')!,b=await c.req.json()
 if(!validText(b.conversationId,200))throw new HTTPException(400,{message:'Conversation required'})
 const guard=settingsGuard(c)
 const result=await c.env.DB.prepare(`INSERT INTO procedure_cohort SELECT c.id,c.project_id,r.id,? FROM conversations c JOIN procedure_releases r ON r.project_id=c.project_id JOIN advice_procedure_versions v ON v.id=r.version_id WHERE c.id=? AND c.project_id=? AND r.id=? AND r.procedure_key=? AND r.state='active' AND ${activeSourceProjectSql('c.project_id')} AND ${contactAvailableSql()} AND (SELECT count(*) FROM procedure_cohort WHERE release_id=r.id)<r.cohort_limit AND NOT EXISTS(SELECT 1 FROM procedure_cohort prior JOIN procedure_releases current ON current.id=prior.release_id WHERE prior.conversation_id=c.id AND current.state='active') AND ${guard.sql}`).bind(Date.now(),b.conversationId,pid,rid,c.req.param('key')!,...guard.args).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Release unavailable, cohort full or conversation already enrolled'})
 return c.json({enrolled:true})
})
procedureRoutes.post(root+'/:key/releases/:releaseId/stop',async c=>{
 const pid=c.req.param('projectId')!,rid=c.req.param('releaseId')!,now=Date.now()
 const guard=settingsGuard(c)
 const result=await c.env.DB.batch([c.env.DB.prepare(`UPDATE procedure_releases SET state='stopped',stopped_at=? WHERE id=? AND project_id=? AND procedure_key=? AND state='active' AND ${guard.sql}`).bind(now,rid,pid,c.req.param('key')!,...guard.args),
 c.env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND state IN ('queued','running') AND ${guard.sql} AND EXISTS(SELECT 1 FROM procedure_releases WHERE id=? AND project_id=? AND procedure_key=?) AND conversation_id IN (SELECT conversation_id FROM procedure_cohort WHERE release_id=? AND project_id=?)`).bind(new Date(now).toISOString(),pid,...guard.args,rid,pid,c.req.param('key')!,rid,pid)])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Active release not found'})
 return c.json({stopped:true,evidencePreserved:true})
})
procedureRoutes.post(root+'/:key/releases/:releaseId/revoke-tool',async c=>{
 const pid=c.req.param('projectId')!,rid=c.req.param('releaseId')!,b=await c.req.json(),now=Date.now()
 if(!procedureTools.includes(b.tool))throw new HTTPException(400,{message:'Unknown read-only tool'})
 const guard=settingsGuard(c)
 const result=await c.env.DB.batch([c.env.DB.prepare(`INSERT OR IGNORE INTO procedure_revocations SELECT id,?,?,? FROM procedure_releases WHERE id=? AND project_id=? AND procedure_key=? AND state='active' AND ${guard.sql}`).bind(b.tool,c.get('actor').id,now,rid,pid,c.req.param('key')!,...guard.args),
 c.env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND state IN ('queued','running') AND ${guard.sql} AND EXISTS(SELECT 1 FROM procedure_releases WHERE id=? AND project_id=? AND procedure_key=?) AND conversation_id IN (SELECT conversation_id FROM procedure_cohort WHERE release_id=? AND project_id=?)`).bind(new Date(now).toISOString(),pid,...guard.args,rid,pid,c.req.param('key')!,rid,pid)])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Active release or new revocation required'})
 return c.json({revoked:true})
})
procedureRoutes.get(root+'/:key/versions/:versionId/reviews',async c=>{
 const row=await c.env.DB.prepare('SELECT id FROM advice_procedure_versions WHERE id=? AND project_id=? AND procedure_key=?').bind(c.req.param('versionId')!,c.req.param('projectId')!,c.req.param('key')!).first()
 if(!row)throw new HTTPException(404)
 return c.json({reviews:(await c.env.DB.prepare('SELECT state,reason,reviewer_id,created_at FROM procedure_reviews WHERE version_id=? ORDER BY created_at,rowid').bind(row.id).all()).results})
})
procedureRoutes.post(root+'/:key/versions/:versionId/review',async c=>{
 const pid=c.req.param('projectId')!,id=c.req.param('versionId')!,b=await c.req.json(),guard=settingsGuard(c)
 if(!['approved','rejected'].includes(b.state)||!validText(b.reason,2000))throw new HTTPException(400,{message:'Approve or reject with a review reason'})
 const result=await c.env.DB.prepare(`INSERT INTO procedure_reviews SELECT ?,v.id,?,?,?,? FROM advice_procedure_versions v WHERE v.id=? AND v.project_id=? AND v.procedure_key=? AND ${guard.sql}`).bind(crypto.randomUUID(),b.state,b.reason,c.get('actor').id,Date.now(),id,pid,c.req.param('key')!,...guard.args).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Version or authority changed'})
 return c.json({reviewed:true,state:b.state})
})
procedureRoutes.post(root+'/:key/releases/:releaseId/check-regression',async c=>{
 const pid=c.req.param('projectId')!,key=c.req.param('key')!,rid=c.req.param('releaseId')!,guard=settingsGuard(c),now=Date.now()
 const release=await c.env.DB.prepare("SELECT version_id,created_at,state FROM procedure_releases WHERE id=? AND project_id=? AND procedure_key=?").bind(rid,pid,key).first<{version_id:string;created_at:number;state:string}>()
 if(!release)throw new HTTPException(404)
 const observed=await c.env.DB.prepare(`${procedureCycles} SELECT count(*) denominator,sum(reopenedAt IS NOT NULL) reopened FROM cases WHERE versionId=? AND resolvedAt>=?`).bind(pid,pid,key,release.version_id,release.created_at).first<{denominator:number;reopened:number}>()
 if(release.state==='stopped')return c.json({regression:!!observed?.reopened,stopped:true,denominator:observed?.denominator||0,reopened:observed?.reopened||0,evidencePreserved:true})
 if(!observed?.reopened)return c.json({regression:false,denominator:observed?.denominator||0,criterion:'Stop on any reopened attributed resolution cycle in this rollout.'})
 const result=await c.env.DB.batch([c.env.DB.prepare(`UPDATE procedure_releases SET state='stopped',stopped_at=? WHERE id=? AND project_id=? AND state='active' AND ${guard.sql}`).bind(now,rid,pid,...guard.args),c.env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND state IN ('queued','running') AND ${guard.sql} AND conversation_id IN (SELECT conversation_id FROM procedure_cohort WHERE release_id=?)`).bind(new Date(now).toISOString(),pid,...guard.args,rid)])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Release or authority changed'})
 return c.json({regression:true,stopped:true,denominator:observed.denominator,reopened:observed.reopened,evidencePreserved:true})
})
/** Bind evaluation input to an immutable procedure. Existing runner safeguards
 * provide budgets, raw usage, isolated no-action execution and no uncertain replay. */
export async function procedureEvaluation(env:Env,pid:string,b:any){
 if(!b.procedureVersionId)return b
 const v=await env.DB.prepare('SELECT * FROM advice_procedure_versions WHERE id=? AND project_id=?').bind(b.procedureVersionId,pid).first<any>()
 if(!v)throw new HTTPException(404,{message:'Procedure version not found'})
 const config=JSON.parse(v.config_json)
 if(b.max_cost>config.maxCost||b.max_tokens>config.maxTokens||!Array.isArray(b.models)||b.models.length!==1||b.models[0]!==v.model||b.variants&&JSON.stringify(b.variants)!=='["prototype"]')throw new HTTPException(400,{message:'Evaluation must use the procedure model and remain within its budgets'})
 if(!Array.isArray(b.cases)||!b.cases.length||b.cases.some((x:any)=>x.family!=='customer_reply'||!Array.isArray(x.expected?.must_include_all)||!x.expected.must_include_all.length))throw new HTTPException(400,{message:'Each advice evaluation must declare required answer outcomes'})
 return {...b,cases:b.cases.map((x:any)=>({...x,policies:[v.instructions,`Escalation: ${config.humanEscalation}`]}))}
}
/** Stopped cohorts fail closed until an operator explicitly chooses a different
 * approved release. No automatic fallback to unversioned advice after rollback. */
export async function selectedProcedure(env:Env,pid:string,cid:string,generationId?:string){
 const v=await env.DB.prepare('SELECT v.*,r.id release_id,r.state FROM procedure_cohort pc JOIN procedure_releases r ON r.id=pc.release_id AND r.project_id=pc.project_id JOIN advice_procedure_versions v ON v.id=r.version_id AND v.project_id=r.project_id WHERE pc.conversation_id=? AND pc.project_id=? ORDER BY pc.created_at DESC,r.created_at DESC,r.id DESC LIMIT 1').bind(cid,pid).first<any>()
 if(!v)return null
 if(v.state!=='active')throw new Error('PROCEDURE_STOPPED: a human must review this conversation')
 const config=JSON.parse(v.config_json),revoked=await env.DB.prepare('SELECT tool_name FROM procedure_revocations WHERE release_id=?').bind(v.release_id).all<{tool_name:string}>()
 if(generationId)await env.DB.prepare('INSERT OR IGNORE INTO procedure_generation VALUES(?,?,?)').bind(generationId,v.release_id,v.id).run()
 return {...v,tools:config.tools.filter((name:string)=>!revoked.results.some(x=>x.tool_name===name))}
}
