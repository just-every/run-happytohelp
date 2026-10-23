import {devAdmitted} from '@runeditrun/rer/modules/operator-auth/dev-admission'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Actor, AppEnv } from './env'
import { pendingFactor, policyRoles, type FactorMethod } from '../modules/identity/two-factor/state'
import { answeringRoute, enforceRole } from '../modules/access/gate'
import {jsonResponse} from './json-response'
export async function hashToken(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('') }
// The only doors a session with an unproven or missing second factor may use.
const factorDoors:Record<'verify'|'enrol',string[]>={
 verify:['POST /auth/signout','GET /api/identity/session','DELETE /api/identity/session','GET /api/identity/two-factor','POST /api/identity/two-factor/verify','POST /api/identity/two-factor/assertion-options'],
 enrol:['POST /auth/signout','GET /api/identity/session','DELETE /api/identity/session','GET /api/identity/two-factor','POST /api/identity/step-up','POST /api/identity/step-up/email','POST /api/identity/two-factor/totp','POST /api/identity/two-factor/totp/confirm','POST /api/identity/two-factor/webauthn/options','POST /api/identity/two-factor/webauthn'],
}
export async function requireActor(c: Context<AppEnv>): Promise<Actor> {
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'') || (c.req.path.endsWith('/socket') ? c.req.query('token') : undefined) || c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
 if(!c.req.header('Authorization') && !['GET','HEAD','OPTIONS'].includes(c.req.method) && c.req.header('Origin') && c.req.header('Origin')!==new URL(c.req.url).origin)throw new HTTPException(403,{message:'Cross-origin cookie request denied'})
 if(!token) throw new HTTPException(401,{message:'Authentication required'})
 // Dev bearer tokens remain native sessions, but require this checkout's gate on every request.
 // Production and preview never register a gate, so copied dev cookies cannot admit there.
 if(token.startsWith('dev_')&&!await devAdmitted(c.req.raw))throw new HTTPException(401,{message:'Local development entry required'})
 // Base workspace credentials authorize only the scoped API, never a native
 // actor. Conceal native resources without looking up token validity or scope.
 if(/^int_[a-f0-9]{64}$/.test(token))throw new HTTPException(404,{message:'Not found'})
 const sessionHash=await hashToken(token)
 const row=await c.env.DB.prepare(`SELECT s.actor_id id,COALESCE(s.project_id,'') projectId,s.role,s.contact_id contactId,sf.verified_at factorAt,sf.method factorMethod,
  EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=s.actor_id AND f.confirmed_at IS NOT NULL) hasFactor,
  (SELECT json_extract(ps.settings_json,'$.two_factor_roles') FROM project_settings ps WHERE ps.project_id=s.project_id) twoFactorRoles,
  (SELECT CASE WHEN mr.role_key='collaborator' OR pr.base='collaborator' THEN 'collaborator' END FROM member_roles mr LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=mr.project_id WHERE mr.project_id=s.project_id AND mr.user_id=s.actor_id) policyRole,
  EXISTS(SELECT 1 FROM member_roles WHERE user_id=s.actor_id) narrowed
  FROM sessions s LEFT JOIN session_factors sf ON sf.token_hash=s.token_hash WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=s.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND (s.project_id IS NULL AND s.role='operator' AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.actor_id) OR s.role='contact' AND EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=s.contact_id AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1) OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=s.project_id AND m.user_id=s.actor_id AND m.role=s.role))`).bind(sessionHash,Date.now()).first<Actor&{factorAt:number|null;factorMethod:FactorMethod|null;hasFactor:number;twoFactorRoles:string|null;policyRole:string|null;narrowed:number}>()
 if(!row) throw new HTTPException(401,{message:'Session invalid or expired'})
 const {factorAt,factorMethod,hasFactor,twoFactorRoles,policyRole,narrowed,...actor}=row
 if(actor.role!=='contact'){
  actor.security={factorAt,factorMethod,hasFactor:Boolean(hasFactor),required:policyRoles(twoFactorRoles).includes(policyRole||actor.role),installation:token.startsWith('dev_')}
  const pending=pendingFactor(actor.security),route=answeringRoute(c)
  if(pending&&!(route&&factorDoors[pending].includes(`${route.method} ${route.path}`)))
   throw new HTTPException(401,{res:jsonResponse({error:pending==='verify'?'Enter the code from your authenticator, a passkey or a recovery code to finish signing in.':'This workspace requires two-factor sign-in. Set it up to continue.',code:'two_factor_required',twoFactor:pending},401)})
 }
 c.set('sessionHash',sessionHash)
 c.set('actor',actor)
 // Only someone holding a collaborator or custom role somewhere is narrowed further than the handlers' own checks.
 if(narrowed&&actor.role!=='contact'&&!c.get('roleChecked')){c.set('roleChecked',true);await enforceRole(c,actor)}
 return actor
}
export async function requireProject(c: Context<AppEnv>,projectId: string,operator=false) {const actor=await requireActor(c);if(actor.projectId!==projectId || (operator && actor.role==='contact'))throw new HTTPException(403,{message:'Project access denied'});return actor}
