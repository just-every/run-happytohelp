import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority,invalid,object} from '../tickets/model'
import {workflowNow} from './clock'
import {runWorkflows} from './runtime'
export const workflowClockRoutes=new Hono<AppEnv>()
workflowClockRoutes.get('/projects/:projectId/workflow-clock',async c=>{if(c.env.H2H_LOCAL!=='true')throw new HTTPException(404);await scope(c,true);return c.json({data:{now:workflowNow(c.env),local:true}})})
workflowClockRoutes.post('/projects/:projectId/workflow-clock',async c=>{
 if(c.env.H2H_LOCAL!=='true')throw new HTTPException(404)
 const actor=await scope(c,true) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'settings.manage'),body=object(await c.req.json()),now=typeof body.now==='number'?body.now:Date.parse(body.now)
 if(!Number.isSafeInteger(now)||now<0)invalid('Enter an epoch millisecond time or an ISO date with timezone')
 const result=await c.env.DB.prepare(`INSERT INTO workflow_clock(project_id,now,updated_at) SELECT ?,?,? WHERE EXISTS(${guard.sql}) ON CONFLICT(project_id) DO UPDATE SET now=excluded.now,updated_at=excluded.updated_at`).bind(actor.projectId,now,Date.now(),...guard.params).run()
 if(!result.meta.changes)throw new HTTPException(409)
 await runWorkflows({...c.env,H2H_WORKFLOW_NOW:String(now)})
 return c.json({data:{now,local:true}})
})
