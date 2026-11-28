import { Hono } from 'hono'
import type { AppEnv, Env } from '../../platform/env'
import { renderHelpCenter, resolvePublicProject } from './help-center'
import {reserved} from './path'
import { answerOverloads } from '../../platform/d1-overload'
import { readEffects } from '../../platform/read-effects'
import { configuredHelpProject as configuredProject } from './help-host-config'

// These unprefixed native document routes must keep their application authority even on a help host.
const applicationPaths = new Set(['auth','admin','users','register','verify-email','accept-invitation','forgot-password','reset-password','two-factor','owner-recovery','delegation','preview','activation','articles','datasets','categories','ais','agents','macros','plugins','edit','email-settings','api-settings','webhook-settings','hubspot-settings','slack-settings','support-channels','delivery-log','github-settings','widget-settings','local-agent','training-runs','reports','move-in','insights'])

const hostRoutes = new Hono<AppEnv>()
hostRoutes.use('*', readEffects)
hostRoutes.get('/', c => renderHelpCenter(c, configuredProject(c.req.raw, c.env)!, ''))
hostRoutes.get('/:article', c => renderHelpCenter(c, configuredProject(c.req.raw, c.env)!, '', c.req.param('article')))
answerOverloads(hostRoutes)

/** Call after static assets, before application routing. Null leaves the ordinary application route in charge. */
export async function publicHelpHostResponse(request: Request, env: Env): Promise<Response | null> {
 if (!['GET', 'HEAD'].includes(request.method) || !configuredProject(request, env)) return null
 const mapped=configuredProject(request,env)!,project=await resolvePublicProject(env,mapped)
 if(project){const chosen=await env.DB.prepare('SELECT published_host FROM knowledge_experience WHERE project_id=?').bind(project.id).first<{published_host:string|null}>();if(chosen?.published_host!==null&&chosen?.published_host!==undefined&&chosen.published_host!==new URL(request.url).hostname)return new Response('Help Center not published at this address',{status:404,headers:{'Cache-Control':'private, no-store'}})}
 const path = new URL(request.url).pathname
 if (path !== '/') {
  if (!/^\/[^/]+$/.test(path)) return null
  let article: string
  try { article = decodeURIComponent(path.slice(1)) } catch { return null }
  if (article.includes('/') || article.includes('\\') || (article !== 'search' && (reserved.has(article) || applicationPaths.has(article)))) return null
 }
 return hostRoutes.fetch(request, env)
}
