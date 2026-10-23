import { Hono } from 'hono'
import type { AppEnv, Env } from '../../platform/env'
import { renderHelpCenter, reserved } from './help-center'

/** Deployment configuration only: no suffix inference, workspace domain setting or forwarded header lookup. */
function configuredProject(request: Request, env: Env): string | null {
 if (typeof env.PUBLIC_HELP_HOSTS !== 'string' || !env.PUBLIC_HELP_HOSTS.trim()) return null
 let hosts: unknown
 try { hosts = JSON.parse(env.PUBLIC_HELP_HOSTS) } catch { return null }
 if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return null
 const hostname = new URL(request.url).hostname
 // An installation's ordinary public homepage and Run entry always retain their own routing.
 if (typeof env.APP_ORIGIN === 'string') {
  try { if (new URL(env.APP_ORIGIN).hostname === hostname) return null } catch { return null }
 }
 if (!Object.hasOwn(hosts, hostname)) return null
 const project = (hosts as Record<string, unknown>)[hostname]
 return typeof project === 'string' && project.trim() === project && project.length > 0 && project.length <= 200 ? project : null
}

// These unprefixed native document routes must keep their application authority even on a help host.
const applicationPaths = new Set(['auth','admin','users','register','verify-email','accept-invitation','forgot-password','reset-password','two-factor','owner-recovery','delegation','preview','activation','articles','datasets','categories','ais','agents','macros','plugins','edit','email-settings','api-settings','webhook-settings','slack-settings','support-channels','delivery-log','github-settings','widget-settings','local-agent','training-runs','reports','move-in','insights'])

const hostRoutes = new Hono<AppEnv>()
hostRoutes.get('/', c => renderHelpCenter(c, configuredProject(c.req.raw, c.env)!, ''))
hostRoutes.get('/:article', c => renderHelpCenter(c, configuredProject(c.req.raw, c.env)!, '', c.req.param('article')))

/** Call after static assets, before application routing. Null leaves the ordinary application route in charge. */
export async function publicHelpHostResponse(request: Request, env: Env): Promise<Response | null> {
 if (!['GET', 'HEAD'].includes(request.method) || !configuredProject(request, env)) return null
 const path = new URL(request.url).pathname
 if (path !== '/') {
  if (!/^\/[^/]+$/.test(path)) return null
  let article: string
  try { article = decodeURIComponent(path.slice(1)) } catch { return null }
  if (article.includes('/') || article.includes('\\') || (article !== 'search' && (reserved.has(article) || applicationPaths.has(article)))) return null
 }
 return hostRoutes.fetch(request, env)
}
