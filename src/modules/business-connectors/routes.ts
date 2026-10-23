import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {connections} from './connections'
import {contexts} from './context'
import {actions} from './actions'
export const businessRoutes=new Hono<AppEnv>()
businessRoutes.route('/',connections)
businessRoutes.route('/',contexts)
businessRoutes.route('/',actions)
