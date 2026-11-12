import {Hono} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {passwordHash} from '../credentials'
import {sessionCookie} from '../session'
import {accountAudit,openTotpSecret,sealTotpSecret} from '../two-factor/factors'
import {issueRecoveryCodes} from '../two-factor/recovery-codes'
import {matchingStep,newTotpSecret,otpauthUri} from '../two-factor/totp'
import {passkeyOptions,proveReplacementPasskey} from './passkeys'
import {sessionFactorStatement} from '../two-factor/state'
import {browserOrigin,guarded,json,random,refuse} from './common'
import {audit,ipLimit,limit,requireLive} from './store'
export const enrolmentRecovery=new Hono<AppEnv>()
enrolmentRecovery.post('/enrol/totp',async c=>{
 browserOrigin(c);await ipLimit(c);const {row,predicate}=await requireLive(c,true),secret=newTotpSecret(),id=random()
 await guarded(c.env.DB,predicate,[c.env.DB.prepare('UPDATE identity_recovery_requests SET pending_id=?,pending_secret=?,pending_passkey=NULL,passkey_challenge=NULL WHERE id=?').bind(id,await sealTotpSecret(c.env,row.user_id,secret),row.id)])
 const user=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(row.user_id).first<{email:string}>()
 return c.json({factorId:id,secret,uri:otpauthUri(secret,user!.email)},201)
})
enrolmentRecovery.post('/enrol/passkey-options',async c=>{
 browserOrigin(c);await ipLimit(c);const {row,predicate}=await requireLive(c,true),body=await json(c)
 if(body.credential)await limit(c,`answer:${row.user_id}`,5)
 return c.json(await passkeyOptions(c,row,predicate,body))
})
enrolmentRecovery.post('/complete',async c=>{
 browserOrigin(c);await ipLimit(c)
 const {row,predicate}=await requireLive(c,true);await limit(c,`answer:${row.user_id}`,5)
 const body=await json(c),db=c.env.DB,now=Date.now(),factorId=random()
 let factor:D1PreparedStatement,method:'totp'|'webauthn',pendingPredicate:string,pendingArgs:unknown[]
 if(body.credential){
  const credential=await proveReplacementPasskey(c,row,body.credential)
  method='webauthn';pendingPredicate="r.pending_passkey=? AND r.passkey_challenge=? AND r.passkey_expires>unixepoch('subsec')*1000";pendingArgs=[row.pending_passkey,row.passkey_challenge]
  factor=db.prepare("INSERT INTO user_factors(id,user_id,kind,label,credential_id,public_key,algorithm,sign_count,created_at,confirmed_at,last_used_at) VALUES(?,?,'webauthn','Recovery passkey',?,?,?,?,?,?,?)").bind(factorId,row.user_id,credential.credentialId,credential.publicKey,credential.algorithm,credential.signCount,now,now,now)
 }else{
  if(!row.pending_secret||body.factorId!==row.pending_id)refuse()
  const secret=await openTotpSecret(c.env,row.user_id,row.pending_secret).catch(()=>null),step=secret?await matchingStep(secret,body.code,null):null
  if(step===null){await audit(c.env,'refused','replacement_invalid',row);refuse()}
  method='totp';pendingPredicate='r.pending_id=? AND r.pending_secret=?';pendingArgs=[row.pending_id,row.pending_secret]
  factor=db.prepare("INSERT INTO user_factors(id,user_id,kind,label,secret_ciphertext,last_step,created_at,confirmed_at,last_used_at) VALUES(?,?,'totp','Recovery authenticator',?,?,?,?,?)").bind(factorId,row.user_id,row.pending_secret,step,now,now,now)
 }
 const existing=await db.prepare('SELECT 1 FROM credentials WHERE user_id=?').bind(row.user_id).first()
 if(!existing&&!body.password)refuse(400,'password_required')
 const password=body.password?await passwordHash(body.password):null,session=random(),sessionHash=await hashToken(session),completion=random(),codes=await issueRecoveryCodes(db,row.user_id,now)
 const full={sql:`(${predicate.sql}) AND EXISTS(SELECT 1 FROM identity_recovery_requests r WHERE r.id=? AND ${pendingPredicate})`,args:[...predicate.args,row.id,...pendingArgs]}
 await guarded(db,full,[
  db.prepare("UPDATE identity_recovery_requests SET state='completed',completion_id=?,pending_secret=NULL,pending_passkey=NULL,passkey_challenge=NULL WHERE id=?").bind(completion,row.id),
  ...(row.mode==='manual'?[db.prepare('INSERT INTO owner_recoveries VALUES(?,?,?)').bind(row.key_hash,row.user_id,now)]:[]),
  db.prepare('DELETE FROM user_factors WHERE user_id=?').bind(row.user_id),
  ...codes.statements,
  db.prepare('UPDATE sessions SET revoked_at=? WHERE actor_id=? AND revoked_at IS NULL').bind(now,row.user_id),
  db.prepare('DELETE FROM session_factors WHERE user_id=?').bind(row.user_id),
  db.prepare('UPDATE magic_signins SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').bind(now,row.user_id),
  db.prepare('UPDATE identity_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').bind(now,row.user_id),
  db.prepare('DELETE FROM webauthn_challenges WHERE user_id=?').bind(row.user_id),
  ...(password?[db.prepare('INSERT INTO credentials VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at').bind(row.user_id,password,now)]:[]),
  factor,
  db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) SELECT ?,?,m.project_id,m.role,? FROM memberships m WHERE m.project_id=? AND m.user_id=?").bind(sessionHash,row.user_id,now+86400000,row.project_id,row.user_id),
  sessionFactorStatement(db,sessionHash,row.user_id,method,now),
  db.prepare("UPDATE identity_recovery_requests SET state='cancelled',pending_secret=NULL,pending_passkey=NULL,passkey_challenge=NULL WHERE user_id=? AND id<>? AND state IN ('pending','authorized')").bind(row.user_id,row.id),
  db.prepare('INSERT INTO identity_recovery_events VALUES(?,?,?,?,?,?)').bind(random(),row.id,row.user_id,'completed','accepted',now),
  ...await accountAudit(db,row.user_id,{category:'auth',action:'recovery.completed',actor:{type:'user',id:row.user_id},source:'api',target:{type:'recovery',id:row.id},detail:{method,membershipsPreserved:true}}),
 ])
 c.header('Set-Cookie',sessionCookie(session,c.req.url))
 return c.json({completed:true,recoveryCodes:codes.codes,destination:'/users/profile'})
})
