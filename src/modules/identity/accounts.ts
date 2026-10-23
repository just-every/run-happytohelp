import {acceptExistingInvitation,usableIdentityToken} from './invitation-acceptance'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv,Actor } from '../../platform/env'
import { hashToken,requireActor,requireProject } from '../../platform/auth'
import { requiredString,id } from '../../platform/db'
import { passwordHash,verifyPassword } from './credentials'
import { auditStatement,requestSource } from '../audit/record'
import { requireStepUp } from './two-factor/step-up'
import { provePassword } from './two-factor/password-proof'
import { sessionCookie } from './session'
import { accountAudit,runAll } from './two-factor/factors'
import { recentMailboxProof, sessionFactorStatement } from './two-factor/state'
import { signInFactor } from './two-factor/sign-in'
export const accounts=new Hono<AppEnv>()
// Once one invitation link for an email is used, the other links issued for it (copied or resent) are spent too.
const retireSiblings=(db:D1Database,projectId:string,email:string,usedHash:string,now:number,guard:string)=>db.prepare(`UPDATE identity_tokens SET consumed_at=? WHERE project_id=? AND kind='invite' AND consumed_at IS NULL AND token_hash<>? AND lower(email)=lower(?) AND ${guard}`).bind(now,projectId,usedHash,email,usedHash,now)
accounts.post('/login',async c=>{
 const b=await c.req.json(),email=requiredString(b.email,'email',320).toLowerCase(),now=Date.now(),key=await hashToken(`${email}:${c.req.header('CF-Connecting-IP')||'local'}`)
 await c.env.DB.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_start<? THEN 1 ELSE failures+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END').bind(key,now,now-900000,now-900000).run()
 const attempts=await c.env.DB.prepare('SELECT failures FROM login_attempts WHERE key=?').bind(key).first<{failures:number}>()
 const user=await c.env.DB.prepare('SELECT u.id,c.password_hash FROM users u JOIN credentials c ON c.user_id=u.id WHERE lower(u.email)=?').bind(email).first<{id:string;password_hash:string}>()
 const refused=async(reason:string)=>{if(user)await runAll(c.env.DB,await accountAudit(c.env.DB,user.id,{category:'auth',action:'sign_in.refused',outcome:'refused',actor:{type:'user',id:user.id},source:'dashboard',detail:{reason}}))}
 if(attempts!.failures>10){await refused('rate_limited');throw new HTTPException(429,{message:'Login temporarily limited'})}
 if(!user||!await verifyPassword(b.password,user.password_hash)){await refused('password_incorrect');throw new HTTPException(401,{message:'Invalid email or password'})}
 const memberships=await c.env.DB.prepare('SELECT project_id,role FROM memberships WHERE user_id=? ORDER BY project_id').bind(user.id).all<{project_id:string;role:Actor['role']}>()
 const membership=b.projectId?memberships.results.find(m=>m.project_id===b.projectId):memberships.results[0]
 if(!membership&&b.projectId)throw new HTTPException(403)
 const token=id()+id(),tokenHash=await hashToken(token),twoFactor=await signInFactor(c.env.DB,user.id,membership?.project_id||null,membership?.role||'operator')
 await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?,NULL)').bind(tokenHash,user.id,membership?.project_id||null,membership?.role||'operator',now+86400000),
  c.env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(key),
  // An account without a second factor has just proven its password: that is its recent step-up,
  // which setting up the factor a workspace requires asks for too.
  ...(twoFactor==='verify'?[]:[sessionFactorStatement(c.env.DB,tokenHash,user.id,'password',now)]),
  ...await accountAudit(c.env.DB,user.id,{category:'auth',action:twoFactor?'sign_in.password_accepted':'sign_in.succeeded',actor:{type:'user',id:user.id},source:'dashboard',detail:{method:'password',...(twoFactor?{twoFactor}:{})}}),
 ])
 c.header('Set-Cookie',sessionCookie(token,c.req.url))
 return c.json({token,actor:{id:user.id,projectId:membership?.project_id||null,role:membership?.role||'operator'},accountOnly:!membership,memberships:memberships.results,...(twoFactor?{twoFactor}:{})})
})
// The new workspace session carries the proof the current session already holds.
accounts.post('/switch-project',async c=>{const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403);const b=await c.req.json();const membership=await c.env.DB.prepare('SELECT role FROM memberships WHERE project_id=? AND user_id=?').bind(requiredString(b.projectId,'projectId'),actor.id).first<{role:string}>();if(!membership)throw new HTTPException(403);const token=id()+id(),tokenHash=await hashToken(token);await c.env.DB.batch([c.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?,NULL)').bind(tokenHash,actor.id,b.projectId,membership.role,Date.now()+86400000),c.env.DB.prepare('INSERT INTO session_factors(token_hash,user_id,method,verified_at) SELECT ?,user_id,method,verified_at FROM session_factors WHERE token_hash=?').bind(tokenHash,c.get('sessionHash'))]);await c.env.DB.prepare('INSERT INTO enterprise_sessions SELECT ?,principal_id,connection_version,authenticated_at FROM enterprise_sessions WHERE token_hash=?').bind(tokenHash,c.get('sessionHash')).run();c.header('Set-Cookie',sessionCookie(token,c.req.url));return c.json({token,actor:{id:actor.id,projectId:b.projectId,role:membership.role}})})
accounts.post('/password',async c=>{
 const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403)
 const b=await c.req.json(),credential=await c.env.DB.prepare('SELECT password_hash FROM credentials WHERE user_id=?').bind(actor.id).first<{password_hash:string}>()
 // A first password is a credential install: teammates moved in without one sign in by email link, which
 // proves them for 15 minutes. Otherwise a held session could set a permanent password and pass every step-up with it.
 if(credential&&!recentMailboxProof(actor.security!)){
  if(b.mailboxReset===true&&!actor.security?.hasFactor)await requireStepUp(c,actor,'account.password',{mailbox:true})
  else await provePassword(c,actor.id,b.currentPassword,credential.password_hash,{refusedAction:'password.change_refused',message:'Current password incorrect'})
 }else await requireStepUp(c,actor,'account.password')
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO credentials VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at').bind(actor.id,await passwordHash(b.password),Date.now()),c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE actor_id=?').bind(Date.now(),actor.id),...await accountAudit(c.env.DB,actor.id,{category:'auth',action:'password.changed',actor:{type:'user',id:actor.id},source:'dashboard'})])
 return c.json({changed:true,loginRequired:true})
})
/**
 * Where email cannot reach a teammate, an owner issues them a one-hour reset link. Setting someone
 * else's password is a credential install: it needs the owner's own recent second factor, and is audited.
 */
accounts.post('/password-reset',async c=>{
 const actor=await requireActor(c);if(actor.role!=='owner')throw new HTTPException(403)
 const b=await c.req.json(),userId=requiredString(b.userId,'userId')
 if(userId===actor.id)throw new HTTPException(409,{message:'Change your own password from your profile.'})
 await requireStepUp(c,actor,'member.password_reset',{factor:true})
 const user=await c.env.DB.prepare('SELECT u.id,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND u.id=?').bind(actor.projectId,userId).first<{id:string;email:string}>()
 if(!user)throw new HTTPException(404)
 const token=id()+id(),tokenHash=await hashToken(token),now=Date.now()
 await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO identity_tokens VALUES(?,?,?,?,'operator','reset',?,NULL)").bind(tokenHash,user.id,actor.projectId,user.email,now+3600000),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'auth',action:'member.password_reset_issued',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'member',id:user.id}},now),
 ])
 return c.json({token,expiresIn:3600},201)
})
accounts.post('/accept-token',async c=>{const b=await c.req.json(),tokenHash=await hashToken(requiredString(b.token,'token')),now=Date.now(),token=await c.env.DB.prepare('SELECT * FROM identity_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?').bind(tokenHash,now).first<any>();if(!token)throw new HTTPException(400,{message:'Token invalid or expired'});const existing=await c.env.DB.prepare('SELECT id FROM users WHERE lower(email)=?').bind(token.email).first<{id:string}>();if(token.kind==='invite'&&existing)throw new HTTPException(409,{message:'Existing users must accept invitations while signed in'});const userId=token.user_id||id(),hash=await passwordHash(b.password);const guard=usableIdentityToken;const statements=[];if(token.kind==='invite'){statements.push(c.env.DB.prepare(`INSERT INTO users SELECT ?,?,?,? WHERE ${guard}`).bind(userId,token.email,requiredString(b.name,'name',200),now,tokenHash,now),c.env.DB.prepare(`INSERT INTO memberships SELECT ?,?,? WHERE ${guard}`).bind(token.project_id,userId,token.role==='collaborator'?'operator':token.role,tokenHash,now),c.env.DB.prepare(`INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) SELECT ?,?,'collaborator',? WHERE ? AND ${guard}`).bind(token.project_id,userId,now,token.role==='collaborator'?1:0,tokenHash,now),retireSiblings(c.env.DB,token.project_id,token.email,tokenHash,now,guard))}statements.push(c.env.DB.prepare(`INSERT INTO credentials SELECT ?,?,? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at`).bind(userId,hash,now,tokenHash,now),c.env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE actor_id=? AND ${guard}`).bind(now,userId,tokenHash,now),c.env.DB.prepare(`UPDATE identity_tokens SET consumed_at=? WHERE token_hash=? AND ${guard}`).bind(now,tokenHash,tokenHash,now));const result=await c.env.DB.batch(statements);if(!result[result.length-1].meta.changes)throw new HTTPException(409,{message:'Token already used'});await runAll(c.env.DB,await accountAudit(c.env.DB,userId,{category:token.kind==='invite'?'access':'auth',action:token.kind==='invite'?'member.joined':'password.reset',actor:{type:'user',id:userId},source:'dashboard'}));return c.json({accepted:true,loginRequired:true})})
accounts.post('/accept-invitation',async c=>{const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403);const b=await c.req.json(),tokenHash=await hashToken(requiredString(b.token,'token'));return c.json(await acceptExistingInvitation(c.env,actor.id,c.get('sessionHash'),tokenHash))})
