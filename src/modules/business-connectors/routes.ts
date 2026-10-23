import {confirmations} from './confirmation'
import {Hono} from 'hono'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {connections} from './connections'
import {contexts} from './context'
import {actions} from './actions'
export function createBusinessRoutes(onMessage:(env:Env,message:Record<string,unknown>,actor:Actor)=>Promise<unknown>){
const businessRoutes=new Hono<AppEnv>()
businessRoutes.route('/',connections)
businessRoutes.route('/',contexts)
businessRoutes.route('/',actions)
businessRoutes.route('/',confirmations(onMessage))
return businessRoutes
}
