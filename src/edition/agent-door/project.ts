import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {requireStepUp} from '../../modules/identity/two-factor/step-up'
import {linkedProject} from './people.ts'
/** Installation linking is a current native owner's action, never an agent tool. */
export const businessProject=new Hono<AppEnv>()
businessProject.use('*',async(c,next)=>{
 try{const actor=await requireActor(c);if(actor.role!=='owner'||!await c.env.DB.prepare('SELECT 1 FROM owner_setup WHERE claim_id=?').bind(actor.id).first())return c.json({code:'native_owner_required'},403);await next()}
 catch(error){if(!(error instanceof HTTPException))throw error;return c.json({code:'native_owner_required'},error.status)}
})
businessProject.get('/',async c=>c.json({linked:await linkedProject(c.env)}))
businessProject.post('/',async c=>{
 if(c.req.header('Origin')!==new URL(c.req.url).origin)return c.json({code:'origin_refused'},403)
 const actor=c.get('actor'),body=await c.req.json().catch(()=>null)
 if(!body||Object.keys(body).join(',')!=='projectId'||body.projectId!==actor.projectId)return c.json({code:'native_project_required'},400)
 const current=await linkedProject(c.env)
 if(current)return current.project_id===actor.projectId&&current.owner_user_id===actor.id?c.json({linked:current}):c.json({code:'native_project_already_linked'},409)
 try{await requireStepUp(c,actor,'business.project_link')}
 catch(error){if(!(error instanceof HTTPException))throw error;const response=error.getResponse(),body=await response.json().catch(()=>({}));const {error:_message,...fields}=body as Record<string,unknown>;return c.json({code:'native_proof_required',...fields},error.status)}
 const result=await c.env.DB.prepare(`INSERT INTO h2h_business_project(singleton,project_id,owner_user_id) SELECT 1,m.project_id,m.user_id FROM memberships m JOIN sessions s ON s.actor_id=m.user_id AND s.project_id=m.project_id AND s.role=m.role WHERE m.project_id=? AND m.user_id=? AND m.role='owner' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM bs_settings WHERE owner_id IS NOT NULL OR document IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=m.project_id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL) ON CONFLICT(singleton) DO NOTHING`).bind(actor.projectId,actor.id,c.get('sessionHash'),Date.now()).run()
 return result.meta.changes?c.json({linked:await linkedProject(c.env)}):c.json({code:'native_project_link_conflict'},409)
})
