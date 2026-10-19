import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {dashboardAccess} from '../management/dashboard'
import {getTicket} from './model'
import {mutateTicket} from './mutate'
import {problemRoutes} from './problem-routes'
import {problemSearchRoutes} from './problem-search'
import {ticketSettingsRoutes} from './routes-settings'
export const ticketRoutes=new Hono<AppEnv>()
ticketRoutes.route('/',ticketSettingsRoutes).route('/',problemRoutes).route('/',problemSearchRoutes)
const path='/projects/:projectId/conversations/:conversationId/ticket'
ticketRoutes.get(path,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await getTicket(c.env,actor,conversation.id)})})
ticketRoutes.patch(path,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await mutateTicket(c.env,actor,conversation.id,await c.req.json(),{sessionHash:c.get('sessionHash'),source:'dashboard'})})})
