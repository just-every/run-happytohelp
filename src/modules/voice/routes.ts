import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {settingsRoutes} from './settings'
import {hooks} from './hooks'
import {callRoutes} from './calls'
export const voiceRoutes=new Hono<AppEnv>()
voiceRoutes.route('/',settingsRoutes)
voiceRoutes.route('/',hooks)
voiceRoutes.route('/',callRoutes)
