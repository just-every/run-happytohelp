import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {companyRoutes} from './company-routes'
import {companyFieldRoutes} from './field-routes'
export const customerRoutes=new Hono<AppEnv>().route('/',companyRoutes).route('/',companyFieldRoutes)
export {customerErasureStatements,customerErasureCount} from './erasure'
export {companyTables} from './model'
