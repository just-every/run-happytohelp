/// <reference types="vite/client" />
import {portalPages} from './portal-pages'
import {requestFormPages} from './request-pages'
import { Hono } from 'hono'
import type { AppEnv, Env } from '../../platform/env'
import { notFoundResponse, rejectedResponse } from '../../base/rejected-response'
import { helpCenterRoutes, reserved, resolvePublicProject } from './help-center'
import { missingHelpCenterPage } from './not-found'
export { publicHelpHostResponse } from './help-host'

export async function isPublicSitePath(path: string, env: Env) {
 if (path.startsWith('/portal/') || path.startsWith('/help/') || path.startsWith('/api/public-site/')) return true
 const parts = path.split('/').filter(Boolean)
 if (!parts.length || parts.length > 2 || reserved.has(parts[0])) return false
 let key: string
 try { key = decodeURIComponent(parts[0]) } catch { return false }
 return !!await resolvePublicProject(env, key, true)
}

export const publicSiteRoutes = new Hono<AppEnv>()
publicSiteRoutes.route('/',requestFormPages)
publicSiteRoutes.route('/',portalPages)
publicSiteRoutes.route('/', helpCenterRoutes)

// A Help Center address no route serves (for example /help/a/b/c) still gets the Help Center frame; API paths keep the plain 404.
publicSiteRoutes.notFound(c => c.req.path.startsWith('/api/')
 ? notFoundResponse(c.req.raw)
 : rejectedResponse(c.req.raw, c.html(missingHelpCenterPage(), 404)))
