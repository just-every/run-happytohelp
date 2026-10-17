import {workflowEnvironment} from './clock'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {workflowSlaRoutes} from './routes-sla'
import {workflowRuleRoutes} from './routes-rules'
import {workflowRoutingRoutes} from './routes-routing'
import {workflowScheduleRoutes} from './routes-schedules'
import {workflowClockRoutes} from './routes-clock'
export const workflowRoutes=new Hono<AppEnv>()
for(const path of ['/projects/:projectId/workflow-*','/projects/:projectId/sla-*','/projects/:projectId/routing-operators','/projects/:projectId/conversations/:conversationId/workflows','/projects/:projectId/conversations/:conversationId/sla','/projects/:projectId/conversations/:conversationId/routing'])workflowRoutes.use(path,async(c,next)=>{c.env=await workflowEnvironment(c.env);await next()})
workflowRoutes.route('/',workflowSlaRoutes).route('/',workflowRuleRoutes).route('/',workflowRoutingRoutes).route('/',workflowScheduleRoutes).route('/',workflowClockRoutes)
