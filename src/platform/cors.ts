import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'
import { hashToken } from './auth'
import {recordRejectedAddress,widgetAddressAllowed} from '../modules/widget/allowed-addresses'
import { rejectedResponse } from '../base/rejected-response'
/** Widget origins are project data. Never reflect arbitrary origins or grant cookies cross-site. */
export const projectCors:MiddlewareHandler<AppEnv>=async(c,next)=>{
 if(c.req.path==='/api/widget/contact-route' && ['GET','OPTIONS'].includes(c.req.method)){c.header('Access-Control-Allow-Origin','*');if(c.req.method==='OPTIONS')return c.body(null,204);return next()}
 const origin=c.req.header('Origin');if(!origin||origin===new URL(c.req.url).origin)return next()
 let projectId:string|undefined
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'')
 if(token){const session=await c.env.DB.prepare('SELECT project_id FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await hashToken(token),Date.now()).first<{project_id:string}>();projectId=session?.project_id}
 const previewAllowed=origin===c.env.PREVIEW_ORIGIN?await c.env.DB.prepare('SELECT 1 FROM preview_grants WHERE expires_at>? AND remaining_requests>0'+(projectId?' AND project_id=?':'')+' LIMIT 1').bind(Date.now(),...(projectId?[projectId]:[])).first():null
 let allowed=Boolean(previewAllowed)
 if(!allowed)allowed=projectId?await widgetAddressAllowed(c.env,projectId,origin):Boolean(await c.env.DB.prepare('SELECT id FROM projects WHERE allowed_origin=? LIMIT 1').bind(origin).first())
 if(!allowed&&!projectId)allowed=Boolean(await c.env.DB.prepare(`SELECT project_id FROM project_settings WHERE EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(settings_json,'$.widget_allowed_addresses'),'[]')) WHERE value=?) LIMIT 1`).bind(origin).first())
 if(!allowed){if(c.req.method==='GET'&&c.req.path==='/api/widget/settings'&&c.req.query('widgetKey'))await recordRejectedAddress(c.env,c.req.query('widgetKey')!,origin);return rejectedResponse(c.req.raw,c.json({error:'Origin not allowed'},403))}
 c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');c.header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');c.header('Access-Control-Allow-Headers','Authorization,Content-Type,X-Filename');c.header('Access-Control-Expose-Headers','Retry-After');c.header('Access-Control-Max-Age','600')
 if(c.req.method==='OPTIONS')return c.body(null,204)
 await next()
 if(c.res.status===101)return
 c.res.headers.set('Access-Control-Allow-Origin',origin);c.res.headers.append('Vary','Origin');c.res.headers.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');c.res.headers.set('Access-Control-Allow-Headers','Authorization,Content-Type,X-Filename');c.res.headers.set('Access-Control-Expose-Headers','Retry-After')
}
