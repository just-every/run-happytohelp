import {crmRoutes} from '../crm/routes'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {identityLinkRoutes} from './identity-links'
import {companyRoutes} from './company-routes'
import {companyFieldRoutes} from './field-routes'
export const customerRoutes=new Hono<AppEnv>().route('/',companyRoutes).route('/',companyFieldRoutes).route('/',identityLinkRoutes).route('/',crmRoutes)
export {customerErasureStatements,customerErasureCount} from './erasure'
export {companyTables} from './model'
