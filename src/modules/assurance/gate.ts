import type {Context,Next} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
// Qualification currently has no activation door: all requested workspaces stay
// on hold until independent deployment acceptance is implemented and proved.
export async function assertWorkspaceOpen(env:AppEnv['Bindings'],projectId:string){
 if(!projectId)return
 const row=await env.DB.prepare('SELECT 1 FROM assurance_profiles WHERE project_id=?').bind(projectId).first()
 if(row)throw new HTTPException(403,{message:'Regulated workspace is on qualification hold. An administrator can review missing agreements and controls in Settings → Regulated deployment.'})
}
export async function qualificationGate(c:Context<AppEnv>,next:Next){
 const path=c.req.path
 // Remediation doors retain their own current session, role and step-up checks.
 if(path==='/api/management/bootstrap'&&!c.req.query('inbox')||/\/projects\/[^/]+\/audit(?:\/.*)?$/.test(path)||path.startsWith('/api/assurance/')||path.startsWith('/api/identity/')&&!path.startsWith('/api/identity/widget/')||/\/contacts\/[^/]+\/(erase|erasure)$/.test(path)||path.startsWith('/api/feedback/conversations/')&&path.endsWith('/opt-out'))return next()
 const explicit=path.match(/\/projects\/([^/]+)/)?.[1]||c.req.query('projectId')||c.req.query('project_id')
 if(explicit)await assertWorkspaceOpen(c.env,explicit)
 const conversation=path.match(/^\/api\/conversations\/([^/]+)/)?.[1]
 if(conversation){const row=await c.env.DB.prepare('SELECT project_id FROM conversations WHERE id=?').bind(conversation).first<{project_id:string}>();if(row)await assertWorkspaceOpen(c.env,row.project_id)}
 if(path.startsWith('/api/widget/')){const key=path.split('/')[3];const row=await c.env.DB.prepare('SELECT id FROM projects WHERE widget_key=? OR id=?').bind(key,key).first<{id:string}>();if(row)await assertWorkspaceOpen(c.env,row.id)}
 if(path==='/api/identity/widget/session'||path==='/api/conversations'){
  const body=await c.req.raw.clone().json().catch(()=>null) as any
  if(body?.projectId)await assertWorkspaceOpen(c.env,String(body.projectId))
  if(body?.widgetKey){const row=await c.env.DB.prepare('SELECT id FROM projects WHERE widget_key=?').bind(String(body.widgetKey)).first<{id:string}>();if(row)await assertWorkspaceOpen(c.env,row.id)}
 }
 await next()
}
/** Native/session and API-token doors call this after authentication, including
 * paths with resource ids instead of an explicit workspace in their URL. */
export const qualificationRemediation=(path:string)=>path==='/api/management/bootstrap'||/\/projects\/[^/]+\/audit(?:\/.*)?$/.test(path)||path.startsWith('/api/assurance/')||path.startsWith('/api/identity/')||/\/contacts\/[^/]+\/(erase|erasure)$/.test(path)||path.startsWith('/api/feedback/conversations/')&&path.endsWith('/opt-out')
