import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {commit,csvScope} from './authority'
import {previewInput} from './parse'
import {planRows} from './plan'
import {mutationStatements} from './mutate'
import {previewStatements,readRun,readSnapshot,result} from './store'
import type {ImportRun} from './types'

export const csvCustomerRoutes=new Hono<AppEnv>()
const base='/projects/:projectId/customer-imports'

csvCustomerRoutes.post(`${base}/preview`,async c=>{
 const actor=await csvScope(c),input=previewInput(await c.req.json()),now=Date.now()
 const run:ImportRun={id:crypto.randomUUID(),project_id:actor.projectId,kind:input.kind,status:'preview',epoch:0,revision:0,ready:0,actor_id:actor.id,created_at:now,applied_at:null,undone_at:null}
 // Register the run before reading: native writes can now invalidate this preview
 // without changing any unrelated workspace state when no CSV run exists.
 await commit(c,actor,null,[c.env.DB.prepare('INSERT INTO csv_customer_imports(id,project_id,kind,status,epoch,revision,ready,actor_id,created_at) VALUES(?,?,?,?,0,0,0,?,?)').bind(run.id,run.project_id,run.kind,run.status,run.actor_id,run.created_at)])
 try{
  const snapshot=await readSnapshot(c.env,actor.projectId,run.id)
  run.epoch=snapshot.epoch
  const rows=planRows(input,snapshot,now),counts=result(run,rows).counts
  await commit(c,actor,snapshot.epoch,[...previewStatements(c.env,run,rows),auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'customer_csv.previewed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'customer_import',id:run.id},detail:{kind:run.kind,...counts}},now)],{runId:run.id,status:'preview'})
  return c.json(result(run,rows),201)
 }catch(error){
  await c.env.DB.prepare('DELETE FROM csv_customer_imports WHERE id=? AND project_id=? AND ready=0').bind(run.id,actor.projectId).run()
  throw error
 }
})
csvCustomerRoutes.get(`${base}/:runId`,async c=>{
 const actor=await csvScope(c),{run,rows}=await readRun(c.env,actor.projectId,c.req.param('runId'))
 return c.json(result(run,rows))
})
for(const action of ['apply','undo'] as const)csvCustomerRoutes.post(`${base}/:runId/${action}`,async c=>{
 const actor=await csvScope(c)
 await requireStepUp(c,actor,`customer_csv.${action}`)
 const {run,rows}=await readRun(c.env,actor.projectId,c.req.param('runId')),undo=action==='undo',target=undo?'undone':'applied'
 if(run.status===target)return c.json(result(run,rows))
 if(run.status!==(undo?'applied':'preview'))throw new HTTPException(409,{message:'This import cannot be applied or undone in its current state'})
 const now=Date.now(),counts=result(run,rows).counts
 await commit(c,actor,run.epoch,[
  // The journal records the committed company timestamp as well as field values.
  ...(!undo&&run.kind==='companies'?[c.env.DB.prepare("UPDATE csv_customer_import_rows SET after_json=json_set(after_json,'$.updated_at',?) WHERE run_id=? AND project_id=? AND action='update'").bind(now,run.id,actor.projectId)]:[]),
  ...mutationStatements(c.env,run,undo,now),
  c.env.DB.prepare(`UPDATE csv_customer_imports SET status=?,${undo?'undone_at':'applied_at'}=?,epoch=revision WHERE project_id=? AND id=?`).bind(target,now,actor.projectId,run.id),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:`customer_csv.${undo?'undone':'applied'}`,actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'customer_import',id:run.id},detail:{kind:run.kind,...counts}},now),
 ],{runId:run.id,status:run.status,stepUp:true})
 const current=await readRun(c.env,actor.projectId,run.id)
 return c.json(result(current.run,current.rows))
})
