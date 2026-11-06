import {healImportDoor} from '../move-in/door/authority'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { hashToken, requireActor } from '../../platform/auth'
import { id, requiredString, serverSecret } from '../../platform/db'
import { passwordHash } from './credentials'
import { sessionCookie } from './session'
import { localDevelopmentRequest } from '../../platform/local-host'
import { workspaceDefaults } from '../management/provisioning/index'
import { DEFAULT_WORKSPACE_COLOUR, deriveOwnerName, deriveWorkspaceName } from './workspace-defaults'
import { sendWelcomeEmail } from './welcome-email'

export const setup = new Hono<AppEnv>()
const available = 'NOT EXISTS(SELECT 1 FROM owner_setup) AND NOT EXISTS(SELECT 1 FROM users) AND NOT EXISTS(SELECT 1 FROM projects)'
export const configuredToken = (env: AppEnv['Bindings']) => typeof env.H2H_SETUP_TOKEN === 'string' && env.H2H_SETUP_TOKEN.trim() ? env.H2H_SETUP_TOKEN : ''
// Only loopback development may claim the first owner without a private setup token.
const tokenRequired = (env: AppEnv['Bindings'], url: string) => Boolean(env.RER_INSTALLATION_ID || configuredToken(env) || !localDevelopmentRequest(url, env.APP_ORIGIN))
/** True while nobody has claimed the installation: no owner record, user or project exists. */
export async function setupAvailable(db: D1Database) {
 const state = await db.prepare(`SELECT (${available}) AS available`).first<{available: number}>()
 return state?.available === 1
}
// Independent deployment readiness exposes no owner identity or credentials.
setup.get('/setup-status', async c => {
 const required = await setupAvailable(c.env.DB)
 c.header('Cache-Control', 'no-store')
 return c.json({setupRequired: required}, required ? 409 : 200)
})
setup.get('/setup', async c => {
 const open = await setupAvailable(c.env.DB)
 c.header('Cache-Control', 'no-store')
 // A visitor's own valid session is theirs to know; it lets a claimed installation send its signed-in owner onward.
 const signedIn = open ? false : await requireActor(c).then(() => true, () => false)
 return c.json({available: open, ...(tokenRequired(c.env, c.req.url) ? {tokenRequired: true} : {}), ...(signedIn ? {signedIn: true} : {})})
})
export function requireSetupOrigin(c: Context<AppEnv>) {
 const origin = c.req.header('Origin')
 if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
  throw new HTTPException(403, {message: 'Owner setup must be submitted from this site'})
 }
}
export async function requireSetupToken(c: Context<AppEnv>, suppliedToken: unknown) {
 const expectedToken = configuredToken(c.env)
 if (!expectedToken && tokenRequired(c.env, c.req.url)) {
  throw new HTTPException(503, {message: c.env.RER_INSTALLATION_ID ? 'Owner setup is awaiting its installation credential' : 'Owner setup on this deployment requires a private H2H_SETUP_TOKEN. Configure it, deploy again, then enter it here.'})
 }
 if (expectedToken) {
  if (typeof suppliedToken !== 'string' || suppliedToken.length > 1024) throw new HTTPException(403, {message: 'A valid owner setup token is required'})
  const expected = await hashToken(expectedToken), supplied = await hashToken(suppliedToken)
  let difference = 0
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  if (difference) throw new HTTPException(403, {message: 'A valid owner setup token is required'})
 }
}
setup.post('/bootstrap', async c => {
 requireSetupOrigin(c)
 let body: Record<string, unknown>
 try {
  body = await c.req.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
 } catch { throw new HTTPException(400, {message: 'Submit a JSON object with email, password and allowedOrigin'}) }
 await requireSetupToken(c, body.setupToken)
 return c.json(await createNativeOwner(c, body), 201)
})

/** Both installer entry points share the same atomic native account, workspace and session creation. */
export async function createNativeOwner(c: Context<AppEnv>, body: Record<string, unknown>, {emailClaim=false}:{emailClaim?:boolean}={}) {
 // Name, owner name and colour are optional: what is missing is derived, what is given is used as given. An explicit empty value is still refused.
 const primaryColor = body.primaryColor
 if (primaryColor !== undefined && (typeof primaryColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(primaryColor))) {
  throw new HTTPException(400, {message: 'Choose a six-digit brand colour'})
 }
 const email = requiredString(body.email, 'email', 320).trim().toLowerCase()
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HTTPException(400, {message: 'Enter a valid email address'})
 const selectedEmail = c.env.H2H_SETUP_OWNER_EMAIL || c.env.OWNER_EMAIL
 if (typeof selectedEmail === 'string' && selectedEmail.trim() && email !== selectedEmail.trim().toLowerCase()) {
  throw new HTTPException(403, {message: 'Use the owner email selected for this installation'})
 }
 let allowedOrigin: string
 try {
  const url = new URL(requiredString(body.allowedOrigin, 'allowedOrigin'))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
  allowedOrigin = url.origin
 } catch { throw new HTTPException(400, {message: 'Website URL must be a valid http:// or https:// URL'}) }
 const derivedName = body.name === undefined ? deriveWorkspaceName(allowedOrigin, email) : null
 const name = derivedName ?? requiredString(body.name, 'name', 200).trim()
 const ownerName = body.ownerName === undefined ? deriveOwnerName(email) : requiredString(body.ownerName, 'ownerName', 200).trim()
 const password = emailClaim ? null : await passwordHash(body.password as string)
 const projectId = id(), userId = id(), token = id() + id(), now = Date.now()
 const claim = 'SELECT 1 FROM owner_setup WHERE singleton=1 AND claim_id=?', guard = `EXISTS(${claim})`
 const defaults = workspaceDefaults(c.env, {projectId, name, website: allowedOrigin, ownerEmail: email}, {sql: claim, params: [userId]})
 const results = await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO owner_setup SELECT 1,? WHERE ${available} ON CONFLICT(singleton) DO NOTHING`).bind(userId),
  c.env.DB.prepare(`INSERT INTO projects(id,name,widget_key,allowed_origin,created_at,verification_secret) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(projectId,name,id(),allowedOrigin,now,serverSecret(),userId),
  // The `derived` marker records what setup chose for the owner, so a later reading of their site replaces only what they have not touched.
  c.env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT ?,?,? WHERE ${guard}`).bind(projectId,JSON.stringify({primary_color: (primaryColor ?? DEFAULT_WORKSPACE_COLOUR).toLowerCase(), derived: {name: derivedName, colour: primaryColor === undefined}}),now,userId),
  c.env.DB.prepare(`INSERT INTO users(id,email,name,created_at) SELECT ?,?,?,? WHERE ${guard}`).bind(userId,email,ownerName,now,userId),
  ...(password?[c.env.DB.prepare(`INSERT INTO credentials(user_id,password_hash,updated_at) SELECT ?,?,? WHERE ${guard}`).bind(userId,password,now,userId)]:[]),
  c.env.DB.prepare(`INSERT INTO memberships SELECT ?,?,'owner' WHERE ${guard}`).bind(projectId,userId,userId),
  c.env.DB.prepare(`INSERT INTO sessions SELECT ?,?,?,'owner',NULL,?,NULL WHERE ${guard}`).bind(await hashToken(token),userId,projectId,now+86400000,userId),
  // Only a password actually chosen by the owner supplies proof; an email claim still needs the mailbox.
  ...(password?[c.env.DB.prepare(`INSERT INTO session_factors(token_hash,user_id,method,verified_at) SELECT ?,?,'password',? WHERE ${guard}`).bind(await hashToken(token),userId,now,userId)]:[]),
  c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'access','owner.created','succeeded','user',?,'dashboard','member',?,'{}' WHERE ${guard}`).bind(crypto.randomUUID(),projectId,now,userId,userId,userId),
  ...defaults.statements,
 ])
 if (!results[0].meta.changes) throw new HTTPException(409, {message: 'Owner setup is already complete. Sign in with your existing account.'})
 c.header('Set-Cookie', sessionCookie(token,c.req.url))
 c.header('Cache-Control', 'no-store')
 await healImportDoor(c.env,userId)
 await defaults.after()
 return {projectId,userId,token,welcomeEmail:await sendWelcomeEmail(c.env,{projectId,workspaceName:name,ownerEmail:email})}
}
