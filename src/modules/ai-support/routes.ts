import {conversationTrace} from './trace'
import {obligationRoutes} from './obligations'
import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { requestGeneration } from './repository'
export const routes=new Hono<AppEnv>()
routes.post('/projects/:projectId/conversations/:conversationId/generations',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true),body=await c.req.json()
 try{return c.json(await requestGeneration(c.env,{projectId,conversationId:c.req.param('conversationId'),actor,expectedRevision:body.expectedRevision}),202)}catch(error){return c.json({error:String(error)},409)}
})
routes.get('/projects/:projectId/generations/:id',async c=>{
 const projectId=c.req.param('projectId');await requireProject(c,projectId,true)
 const row=await c.env.DB.prepare('SELECT id,state,source_revision,error,output_json FROM ai_generations WHERE id=? AND project_id=?').bind(c.req.param('id'),projectId).first()
 return row?c.json(row):c.json({error:'Not found'},404)
})
routes.post('/projects/:projectId/generations/:id/cancel',async c=>{
 const projectId=c.req.param('projectId');await requireProject(c,projectId,true)
 const result=await c.env.DB.prepare("UPDATE ai_generations SET state='cancelled',updated_at=? WHERE id=? AND project_id=? AND state IN ('queued','running')").bind(new Date().toISOString(),c.req.param('id'),projectId).run()
 return c.json({cancelled:!!result.meta.changes})
})

routes.post('/projects/:projectId/conversations/:conversationId/suggestions',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true),body=await c.req.json()
 try{return c.json(await requestGeneration(c.env,{projectId,conversationId:c.req.param('conversationId'),actor,expectedRevision:body.expectedRevision,kind:'suggestions'}),202)}catch(error){return c.json({error:String(error)},409)}
})

routes.get('/projects/:projectId/conversations/:conversationId/trace',async c=>{
 const projectId=c.req.param('projectId');await requireProject(c,projectId,true)
 c.header('Cache-Control','private, no-store')
 const trace=await conversationTrace(c.env,projectId,c.req.param('conversationId'))
 return trace?c.json(trace):c.json({error:'Not found'},404)
})
routes.route('/',obligationRoutes)
