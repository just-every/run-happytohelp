/// <reference types="vite/client" />
import {renderPublicKnowledgeHtml} from '../knowledge/public-html'
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
publicSiteRoutes.use('*',async(c,next)=>{
 await next()
 if(!c.res.headers.get('Content-Type')?.includes('text/html'))return
 const parts=c.req.path.split('/').filter(Boolean),key=['help','portal'].includes(parts[0])?parts[1]:parts[0]
 if(!key)return
 const project=await resolvePublicProject(c.env,decodeURIComponent(key))
 if(!project)return
 const body=await renderPublicKnowledgeHtml(c.env,project.id,c.req.raw,await c.res.text()),headers=new Headers(c.res.headers);headers.delete('Content-Length');c.res=new Response(body,{status:c.res.status,headers})
})
publicSiteRoutes.route('/',requestFormPages)
publicSiteRoutes.route('/',portalPages)
publicSiteRoutes.route('/', helpCenterRoutes)

// A Help Center address no route serves (for example /help/a/b/c) still gets the Help Center frame; API paths keep the plain 404.
publicSiteRoutes.notFound(c => c.req.path.startsWith('/api/')
 ? notFoundResponse(c.req.raw)
 : rejectedResponse(c.req.raw, c.html(missingHelpCenterPage(), 404)))
