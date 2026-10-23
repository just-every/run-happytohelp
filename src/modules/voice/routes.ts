import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {settingsRoutes} from './settings'
import {hooks} from './hooks'
import {privacyRoutes} from './privacy'
import {callRoutes} from './calls'
export const voiceRoutes=new Hono<AppEnv>()
voiceRoutes.route('/',settingsRoutes)
voiceRoutes.route('/',hooks)
voiceRoutes.route('/',callRoutes)
voiceRoutes.route('/',privacyRoutes)
