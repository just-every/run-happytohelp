import {requireTicketScope,ticketScopeSql} from '../access/ticket-scope'
import {conversationTrace} from './trace'
import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { requestGeneration } from './repository'
export const routes=new Hono<AppEnv>()
routes.post('/projects/:projectId/conversations/:conversationId/generations',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true),body=await c.req.json()
 await requireTicketScope(c.env,actor.id,projectId,c.req.param('conversationId'))
 try{return c.json(await requestGeneration(c.env,{projectId,conversationId:c.req.param('conversationId'),actor,expectedRevision:body.expectedRevision}),202)}catch(error){return c.json({error:String(error)},409)}
})
routes.get('/projects/:projectId/generations/:id',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true)
 const row=await c.env.DB.prepare(`SELECT id,state,source_revision,error,output_json FROM ai_generations g WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=g.conversation_id AND c.project_id=g.project_id AND ${ticketScopeSql('?')})`).bind(c.req.param('id'),projectId,actor.id).first()
 return row?c.json(row):c.json({error:'Not found'},404)
})
routes.post('/projects/:projectId/generations/:id/cancel',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true)
 const result=await c.env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE id=? AND project_id=? AND state IN ('queued','running') AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=ai_generations.conversation_id AND c.project_id=ai_generations.project_id AND ${ticketScopeSql('?')})`).bind(new Date().toISOString(),c.req.param('id'),projectId,actor.id).run()
 return c.json({cancelled:!!result.meta.changes})
})

routes.post('/projects/:projectId/conversations/:conversationId/suggestions',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true),body=await c.req.json()
 await requireTicketScope(c.env,actor.id,projectId,c.req.param('conversationId'))
 try{return c.json(await requestGeneration(c.env,{projectId,conversationId:c.req.param('conversationId'),actor,expectedRevision:body.expectedRevision,kind:'suggestions'}),202)}catch(error){return c.json({error:String(error)},409)}
})

routes.get('/projects/:projectId/conversations/:conversationId/trace',async c=>{
 const projectId=c.req.param('projectId'),actor=await requireProject(c,projectId,true)
 await requireTicketScope(c.env,actor.id,projectId,c.req.param('conversationId'))
 c.header('Cache-Control','private, no-store')
 const trace=await conversationTrace(c.env,projectId,c.req.param('conversationId'))
 return trace?c.json(trace):c.json({error:'Not found'},404)
})
