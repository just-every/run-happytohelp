import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {importActor} from '../routes'
import {cutoverSources} from './counts'
import {getStep,insertStep,listSteps,parseStep} from './steps'

/**
 * A company switches its work to this workspace source by source, in its own tools. These two doors list what was
 * switched and record each step with its undo and its check, so the workspace keeps the record. They read and write only
 * this workspace's own rows: no provider is called, nothing is queued and no mail is sent.
 */
export const cutoverRoutes=new Hono<AppEnv>()
const root='/projects/:projectId/cutover'

cutoverRoutes.get(root,async c=>{
 const actor=await importActor(c)
 c.header('Cache-Control','no-store')
 const steps=await listSteps(c.env,actor.project_id)
 return c.json({data:{sources:await cutoverSources(c.env,actor.project_id,steps)}})
})

cutoverRoutes.post(`${root}/steps`,async c=>{
 const actor=await importActor(c)
 c.header('Cache-Control','no-store')
 const step=parseStep(await c.req.json().catch(()=>{throw new HTTPException(400,{message:'Send a JSON object'})})),id=crypto.randomUUID(),at=Date.now()
 // The step and its security-log event are one write. The log keeps the source, the state and the check's result, never the text.
 await c.env.DB.batch([
  insertStep(c.env,actor.project_id,actor.actor_id,step,id,at),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'data',action:'cutover.step.recorded',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'cutover_step',id},detail:{source:step.source,state:step.state,check:step.check.result}},at),
 ])
 return c.json({data:await getStep(c.env,actor.project_id,id)},201)
})
