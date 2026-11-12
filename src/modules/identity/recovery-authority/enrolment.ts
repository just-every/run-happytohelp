import {Hono} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {passwordHash} from '../credentials'
import {sessionCookie} from '../session'
import {accountAudit,installationOrigin,openTotpSecret,sealTotpSecret} from '../two-factor/factors'
import {issueRecoveryCodes} from '../two-factor/recovery-codes'
import {matchingStep,newTotpSecret,otpauthUri} from '../two-factor/totp'
import {b64url,verifyRegistration,WebAuthnError} from '../two-factor/webauthn'
import {sessionFactorStatement} from '../two-factor/state'
import {browserOrigin,guarded,json,random,refuse} from './common'
import {audit,ipLimit,limit,requireLive} from './store'
export const enrolmentRecovery=new Hono<AppEnv>()
enrolmentRecovery.post('/enrol/totp',async c=>{
 browserOrigin(c);const {row,predicate}=await requireLive(c,true),secret=newTotpSecret(),id=random()
 await guarded(c.env.DB,predicate,[c.env.DB.prepare('UPDATE identity_recovery_requests SET pending_id=?,pending_secret=?,passkey_challenge=NULL WHERE id=?').bind(id,await sealTotpSecret(c.env,row.user_id,secret),row.id)])
 const user=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(row.user_id).first<{email:string}>()
 return c.json({factorId:id,secret,uri:otpauthUri(secret,user!.email)},201)
})
enrolmentRecovery.post('/enrol/passkey-options',async c=>{
 browserOrigin(c);const {row,predicate}=await requireLive(c,true),challenge=random(),rp=installationOrigin(c.env,c.req.url)
 const user=await c.env.DB.prepare('SELECT email,name FROM users WHERE id=?').bind(row.user_id).first<{email:string;name:string}>()
 await guarded(c.env.DB,predicate,[c.env.DB.prepare('UPDATE identity_recovery_requests SET passkey_challenge=?,passkey_expires=?,pending_secret=NULL,pending_id=NULL WHERE id=?').bind(challenge,Date.now()+120000,row.id)])
 return c.json({publicKey:{challenge,rp:{id:rp.id,name:'HappyToHelp'},user:{id:b64url(new TextEncoder().encode(row.user_id)),name:user!.email,displayName:user!.name},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],timeout:120000,attestation:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'},excludeCredentials:[]}})
})
enrolmentRecovery.post('/complete',async c=>{
 browserOrigin(c);await ipLimit(c)
 const {row,predicate}=await requireLive(c,true);await limit(c,`answer:${row.user_id}`,5)
 const body=await json(c),db=c.env.DB,now=Date.now(),factorId=random()
 let factor:D1PreparedStatement,method:'totp'|'webauthn',pendingPredicate:string,pendingArgs:unknown[]
 if(body.credential){
  if(!row.passkey_challenge||!row.passkey_expires||row.passkey_expires<=now)refuse()
  const rp=installationOrigin(c.env,c.req.url)
  let credential
  try{credential=await verifyRegistration(body.credential,{challenge:row.passkey_challenge,origin:rp.origin,rpId:rp.id})}catch(error){if(error instanceof WebAuthnError){await audit(c.env,'refused','replacement_invalid',row);refuse()}throw error}
  // Recovery requires UV, beyond the common registration primitive's presence check.
  // authData's flags live in the attestation, validated again below by the UV helper.
  const {registrationVerified}=await import('./passkey-proof')
  await registrationVerified(body.credential)
  if(await db.prepare('SELECT 1 FROM user_factors WHERE credential_id=?').bind(credential.credentialId).first())refuse()
  method='webauthn';pendingPredicate='r.passkey_challenge=? AND r.passkey_expires>unixepoch(\'subsec\')*1000';pendingArgs=[row.passkey_challenge]
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
  db.prepare("UPDATE identity_recovery_requests SET state='completed',completion_id=?,pending_secret=NULL,passkey_challenge=NULL WHERE id=?").bind(completion,row.id),
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
  db.prepare("UPDATE identity_recovery_requests SET state='cancelled',pending_secret=NULL,passkey_challenge=NULL WHERE user_id=? AND id<>? AND state IN ('pending','authorized')").bind(row.user_id,row.id),
  db.prepare('INSERT INTO identity_recovery_events VALUES(?,?,?,?,?,?)').bind(random(),row.id,row.user_id,'completed','accepted',now),
  ...await accountAudit(db,row.user_id,{category:'auth',action:'recovery.completed',actor:{type:'user',id:row.user_id},source:'api',target:{type:'recovery',id:row.id},detail:{method,membershipsPreserved:true}}),
 ])
 c.header('Set-Cookie',sessionCookie(session,c.req.url))
 return c.json({completed:true,recoveryCodes:codes.codes,destination:'/users/profile'})
})
