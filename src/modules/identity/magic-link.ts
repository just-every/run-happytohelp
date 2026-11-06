import {healImportDoor} from '../move-in/door/authority'
import {loginDestination} from '../../platform/dashboard-path.js'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv, Env } from '../../platform/env'
import { hashToken } from '../../platform/auth'
import { serverSecret } from '../../platform/db'
import { emailConfigured, sendEmail } from '../integrations/email'
import {emailMode,emailOffMessage} from '../integrations/email-provider'
import { sessionCookie } from './session'
import { signInFactor } from './two-factor/sign-in'
import { sessionFactorStatement } from './two-factor/state'
import { accountAudit, runAll } from './two-factor/factors'
import { clientAddress } from '../../platform/rate-limits'

export const magicLink = new Hono<AppEnv>()
const lifetime = 15 * 60 * 1000
const invalid = () => new HTTPException(400, { message: 'This sign-in link is invalid, expired or already used. Request a new link.' })

/** Email links trust the installation origin, never the incoming Host or a return URL. */
export function linkOrigin(env: Env) {
 try {
  const url = new URL(String(env.APP_ORIGIN || ''))
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null
  return url.origin
 } catch { return null }
}
function sameOrigin(request: Request) {
 if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) throw new HTTPException(403, { message: 'Cross-origin sign-in denied' })
}
export async function magicLinkLimit(db: D1Database, identity: string, maximum: number) {
 const now = Date.now(), key = await hashToken(`magic:${identity}`)
 const row = await db.prepare(`INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_start<=? THEN 1 ELSE failures+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING failures`).bind(key, now, now - 3600000, now - 3600000).first<{ failures: number }>()
 if (!row || row.failures > maximum) throw new HTTPException(429, { message: 'Too many sign-in requests. Please try again in an hour.', res: new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }) })
}
magicLink.post('/magic-link', async c => {
 sameOrigin(c.req.raw)
 c.header('Cache-Control', 'no-store')
 if(emailMode(c.env)==='local')throw new HTTPException(503,{message:'Local development signs in automatically through rer dev. Use your password instead.'})
 const origin = linkOrigin(c.env)
 if (!origin || !emailConfigured(c.env)) throw new HTTPException(503, { message: `${emailOffMessage} No sign-in link was sent: use your password, or ask whoever runs this installation for a sign-in link.` })
 const body = await c.req.json().catch(() => null)
 const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
 if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HTTPException(400, { message: 'Enter a valid email address.' })
 // Both keys are consumed for unknown accounts too. The atomic counters also bound concurrent requests.
 await magicLinkLimit(c.env.DB, `ip:${clientAddress(c.req)}`, 30)
 await magicLinkLimit(c.env.DB, `email:${email}`, 5)
 // Account lookup and email submission both run after the neutral response. Unknown
 // addresses do not expose database or provider latency through the request duration.
 c.executionCtx.waitUntil((async () => {
  const member = await c.env.DB.prepare(`SELECT u.id,u.email,m.project_id FROM users u LEFT JOIN memberships m ON m.user_id=u.id LEFT JOIN projects p ON p.id=m.project_id WHERE lower(u.email)=? AND (m.project_id IS NULL OR (p.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))) ORDER BY m.project_id LIMIT 1`).bind(email).first<{ id: string; email: string; project_id: string | null }>()
  if (!member) return
  const token = serverSecret(), hash = await hashToken(token)
  await c.env.DB.prepare('INSERT INTO magic_signins(token_hash,user_id,project_id,email,expires_at) VALUES(?,?,?,?,?)').bind(hash, member.id, member.project_id, member.email, Date.now() + lifetime).run()
  const url = new URL('/login/magic', origin)
  url.searchParams.set('returnTo',loginDestination(body.returnTo,origin))
  url.hash = new URLSearchParams({ token }).toString()
  try {
   await sendEmail(c.env, { to: member.email, subject: 'Sign in to HappyToHelp', text: `Open this link, then press Sign in within 15 minutes: ${url.href}\nIf you did not request this link, ignore this email.`, projectId: member.project_id || undefined, idempotencyKey: `magic-signin:${hash}` })
  } catch {
   // Preserve failed/uncertain email receipts. Never replay an ambiguous submission.
   await c.env.DB.prepare('UPDATE magic_signins SET consumed_at=? WHERE token_hash=?').bind(Date.now(), hash).run()
  }
 })())
 return c.json({ accepted: true, message: 'If this address belongs to a HappyToHelp account, check your inbox for a sign-in link. You can also use your password.' }, 202)
})
magicLink.post('/magic-link/consume', async c => {
 sameOrigin(c.req.raw)
 c.header('Cache-Control', 'no-store')
 const body = await c.req.json().catch(() => null)
 if (typeof body?.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw invalid()
 await magicLinkLimit(c.env.DB, `consume:${clientAddress(c.req)}`, 60)
 const hash = await hashToken(body.token), now = Date.now(), session = serverSecret(), sessionHash = await hashToken(session)
 // D1 batches commit atomically. Only the batch that inserts a session from an unspent token may consume it.
 // Membership, email and deletion are checked at admission, not at email issuance.
 const results = await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) SELECT ?,t.user_id,t.project_id,coalesce(m.role,'operator'),? FROM magic_signins t JOIN users u ON u.id=t.user_id AND u.email=t.email LEFT JOIN memberships m ON m.user_id=t.user_id AND m.project_id=t.project_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>? AND ((t.project_id IS NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=t.user_id)) OR (m.user_id IS NOT NULL AND p.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))) RETURNING actor_id`).bind(sessionHash, now + 86400000, hash, now),
  c.env.DB.prepare('UPDATE magic_signins SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?) RETURNING user_id').bind(now, hash, sessionHash),
 ])
 // D1's changes count includes authority-trigger writes. Admission is the
 // authenticated row returned by each atomic statement, never that aggregate.
 if (results[0].results.length !== 1 || results[1].results.length !== 1) throw invalid()
 c.header('Set-Cookie', sessionCookie(session, c.req.url))
 const admitted=await c.env.DB.prepare('SELECT actor_id,project_id,role FROM sessions WHERE token_hash=?').bind(sessionHash).first<{actor_id:string;project_id:string|null;role:string}>()
 // An email link is a primary sign-in only: an account with a second factor still proves it.
 const twoFactor=await signInFactor(c.env.DB,admitted!.actor_id,admitted!.project_id,admitted!.role)
 await runAll(c.env.DB,[...(twoFactor==='verify'?[]:[sessionFactorStatement(c.env.DB,sessionHash,admitted!.actor_id,'email_link')]),...await accountAudit(c.env.DB,admitted!.actor_id,{category:'auth',action:twoFactor?'sign_in.email_link_accepted':'sign_in.succeeded',actor:{type:'user',id:admitted!.actor_id},source:'dashboard',detail:{method:'email_link'}})])
 await healImportDoor(c.env,admitted!.actor_id)
 return c.json({ signedIn: true, destination: loginDestination(body.returnTo,new URL(c.req.url).origin,!admitted?.project_id), ...(twoFactor?{twoFactor}:{}) })
})
