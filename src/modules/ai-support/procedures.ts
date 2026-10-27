import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import {auditStatement,requestSource} from '../audit/record'
import {objectBody} from '../training-runs/validation'
import {finishTrainingPlanning} from '../training-runs/recovery'

// A sandbox can narrow read-only tools; it never grants production authority.
export const procedureTools=['search_knowledge','read_knowledge_source']
export const procedureCases=['allowed','denied','timeout','injection']
const root='/projects/:projectId/procedures'
const text=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max
const refuse=(message:string,status:400|403|404|409=400):never=>{throw new HTTPException(status,{message})}
export const procedureRoutes=new Hono<AppEnv>()
procedureRoutes.use(root+'*',async(c,next)=>{
 const pid=c.req.param('projectId')!,actor=await requireProject(c,pid,true),access=await memberAccess(c.env.DB,pid,actor.id)
 if(!access||!['owner','admin'].includes(access.base)||!access.permissions.has('settings.manage'))refuse('Procedure settings require an owner or admin',403)
 c.header('Cache-Control','private, no-store');await next()
})
procedureRoutes.get(root,async c=>{
 const versions=await c.env.DB.prepare('SELECT * FROM procedure_versions WHERE project_id=? ORDER BY procedure_key,version DESC').bind(c.req.param('projectId')!).all<any>()
 return c.json({versions:versions.results.map(v=>({...v,definition:JSON.parse(v.definition)})),productionExecutionAvailable:false})
})
procedureRoutes.post(root+'/:key/versions',async c=>{
 const pid=c.req.param('projectId')!,key=c.req.param('key')!,b=await objectBody(c.req)
 if(!/^[a-z0-9-]{1,80}$/.test(key)||!text(b.instructions,16000)||!text(b.intent,200)||!text(b.model,200)||!text(b.humanEscalation,2000))refuse('Declare a key, intent, instructions, model and human escalation')
 if(!Array.isArray(b.tools)||b.tools.length===0||b.tools.some((t:unknown)=>typeof t!=='string'||!procedureTools.includes(t))||new Set(b.tools).size!==b.tools.length)refuse('Choose existing read-only tools only')
 if(!Number.isFinite(b.maxCost)||b.maxCost<=0||b.maxCost>1000||!Number.isInteger(b.maxTokens)||b.maxTokens<1||b.maxTokens>32000)refuse('Declare bounded simulation cost and output tokens')
 if(!Array.isArray(b.cases)||b.cases.length!==4||procedureCases.some(kind=>b.cases.filter((x:any)=>x?.kind===kind).length!==1))refuse('Declare one synthetic case for each required path')
 const cases=b.cases.map((x:any)=>{
  if(!text(x.prompt,4000)||!text(x.expected,1000)||!text(x.forbidden,1000))refuse('Each synthetic case needs a prompt, expected phrase and forbidden phrase')
  return {id:x.kind,kind:x.kind,prompt:x.prompt,expected:x.expected,forbidden:x.forbidden}
 })
 // Reconstruct the definition: historical IDs, private context and client pass flags are never admitted.
 if(Object.keys(b).some(k=>!['intent','instructions','model','humanEscalation','tools','maxCost','maxTokens','cases','syntheticConfirmation'].includes(k))||b.syntheticConfirmation!=='synthetic-only')refuse('Confirm synthetic-only input; historical context is not accepted')
 const definition={intent:b.intent,instructions:b.instructions,model:b.model,humanEscalation:b.humanEscalation,tools:b.tools,maxCost:b.maxCost,maxTokens:b.maxTokens,cases},id=crypto.randomUUID()
 const created=await c.env.DB.prepare('INSERT INTO procedure_versions(id,project_id,procedure_key,version,definition,created_by,created_at) VALUES(?,?,?,(SELECT coalesce(max(version),0)+1 FROM procedure_versions WHERE project_id=? AND procedure_key=?),?,?,?) RETURNING id,version').bind(id,pid,key,pid,key,JSON.stringify(definition),c.get('actor').id,Date.now()).first()
 await auditStatement(c.env.DB,{projectId:pid,category:'data',action:'procedure.version.created',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'procedure_version',id}}).run()
 return c.json(created,201)
})
procedureRoutes.post(root+'/:key/versions/:versionId/simulations',async c=>{
 const pid=c.req.param('projectId')!,v=await c.env.DB.prepare('SELECT * FROM procedure_versions WHERE id=? AND project_id=? AND procedure_key=?').bind(c.req.param('versionId')!,pid,c.req.param('key')!).first<any>()
 if(!v)refuse('Version not found',404)
 const d=JSON.parse(v.definition),id=crypto.randomUUID(),plan=d.cases.map((x:any)=>({id:crypto.randomUUID(),model:d.model,variant:'prototype',definition:{id:x.id,family:'procedure',procedureVersionId:v.id,procedure:d,scenario:x.kind,messages:[{role:'contact',content:x.prompt}],expected:{min_responses:1,max_responses:1,must_include_any:[x.expected],must_not_include:[x.forbidden]}}}))
 const config={models:[d.model],variants:['prototype'],procedureVersionId:v.id,plan}
 await c.env.DB.prepare("INSERT INTO training_runs(id,project_id,operator_id,request_id,kind,status,config,case_count,max_cost,max_tokens,created_at) VALUES(?,?,?,?,'simulation','planning',?,4,?,?,?)").bind(id,pid,c.get('actor').id,id,JSON.stringify(config),d.maxCost,d.maxTokens,Date.now()).run()
 await finishTrainingPlanning(c.env,{id,config});await c.env.JOBS.send({type:'training',id,projectId:pid})
 return c.json({id,procedureVersionId:v.id,status:'queued'},201)
})
procedureRoutes.get(root+'/:key/versions/:versionId/simulations',async c=>{
 const runs=await c.env.DB.prepare("SELECT id,status,case_count,created_at,json_extract(config,'$.procedureVersionId') AS procedureVersionId FROM training_runs WHERE project_id=? AND json_extract(config,'$.procedureVersionId')=? AND EXISTS(SELECT 1 FROM procedure_versions WHERE id=? AND project_id=? AND procedure_key=?) ORDER BY created_at DESC").bind(c.req.param('projectId')!,c.req.param('versionId')!,c.req.param('versionId')!,c.req.param('projectId')!,c.req.param('key')!).all()
 return c.json({runs:runs.results})
})
procedureRoutes.post(root+'/:key/versions/:versionId/release',async c=>{
 const pid=c.req.param('projectId')!,b=await objectBody(c.req),versionId=c.req.param('versionId')!
 const qualified=await c.env.DB.prepare(`SELECT v.id FROM procedure_versions v JOIN training_runs r ON r.project_id=v.project_id AND json_extract(r.config,'$.procedureVersionId')=v.id WHERE v.id=? AND v.project_id=? AND v.procedure_key=? AND r.id=? AND r.status='completed' AND r.case_count=4 AND (SELECT count(*) FROM training_cases WHERE run_id=r.id)=4 AND NOT EXISTS(SELECT 1 FROM training_cases WHERE run_id=r.id AND (status<>'completed' OR coalesce(json_extract(checks,'$.passed'),0)<>1))`).bind(versionId,pid,c.req.param('key')!,typeof b.evaluationId==='string'?b.evaluationId:'').first()
 if(!qualified)refuse('Release refused: this exact version needs all four required cases completed and passing',409)
 const artifacts=await c.env.DB.prepare('SELECT output_key FROM training_cases WHERE run_id=?').bind(b.evaluationId).all<{output_key:string}>()
 if((await Promise.all(artifacts.results.map(row=>row.output_key?c.env.FILES.head(row.output_key):null))).some(value=>!value))refuse('Release refused: a required simulation artifact is missing',409)
 // Qualification is retained, but production rollout remains unavailable.
 await auditStatement(c.env.DB,{projectId:pid,category:'approval',action:'procedure.simulation.qualified',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'procedure_version',id:versionId},detail:{evaluationId:b.evaluationId}}).run()
 return c.json({qualified:true,versionId,evaluationId:b.evaluationId,productionExecutionAvailable:false})
})
