import {Hono} from 'hono'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {connectionRoutes} from './connections'
import {actionRoutes} from './actions'
import {attachmentRoutes} from './context'
import {webhookRoutes} from './webhooks'
import {draftRoutes} from './drafts'
export function createEscalationRoutes(onMessage:(env:Env,message:Record<string,unknown>,actor:Actor)=>Promise<unknown>){const routes=new Hono<AppEnv>();routes.route('/',connectionRoutes);routes.route('/',actionRoutes);routes.route('/',attachmentRoutes);routes.route('/',webhookRoutes);routes.route('/',draftRoutes(onMessage));return routes}
