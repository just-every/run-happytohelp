import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'
import { hashToken } from './auth'
import { rejectedResponse } from '../base/rejected-response'
/** Widget origins are project data. Never reflect arbitrary origins or grant cookies cross-site. */
export const projectCors:MiddlewareHandler<AppEnv>=async(c,next)=>{
 // SAML POST binding uses signed assertions plus a browser-bound, single-use request.
 if(/^\/api\/identity\/sso\/[^/]+\/callback$/.test(c.req.path))return next()
 const origin=c.req.header('Origin');if(!origin||origin===new URL(c.req.url).origin)return next()
 let projectId:string|undefined
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'')
 if(token){const session=await c.env.DB.prepare('SELECT project_id FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await hashToken(token),Date.now()).first<{project_id:string}>();projectId=session?.project_id}
 const previewAllowed=origin===c.env.PREVIEW_ORIGIN?await c.env.DB.prepare('SELECT 1 FROM preview_grants WHERE expires_at>? AND remaining_requests>0'+(projectId?' AND project_id=?':'')+' LIMIT 1').bind(Date.now(),...(projectId?[projectId]:[])).first():null
 const allowed=previewAllowed||(projectId?await c.env.DB.prepare('SELECT id FROM projects WHERE id=? AND allowed_origin=?').bind(projectId,origin).first():await c.env.DB.prepare('SELECT id FROM projects WHERE allowed_origin=? LIMIT 1').bind(origin).first())
 if(!allowed)return rejectedResponse(c.req.raw,c.json({error:'Origin not allowed'},403))
 c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');c.header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');c.header('Access-Control-Allow-Headers','Authorization,Content-Type,X-Filename');c.header('Access-Control-Expose-Headers','Retry-After');c.header('Access-Control-Max-Age','600')
 if(c.req.method==='OPTIONS')return c.body(null,204)
 await next()
 if(c.res.status===101)return
 c.res.headers.set('Access-Control-Allow-Origin',origin);c.res.headers.append('Vary','Origin');c.res.headers.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');c.res.headers.set('Access-Control-Allow-Headers','Authorization,Content-Type,X-Filename');c.res.headers.set('Access-Control-Expose-Headers','Retry-After')
}
