import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {totp} from '../two-factor.mjs'
import {passkeyRecovery} from './passkey.mjs'
import {startApp} from '../../../journeys/kit/app.mjs'
import {fresh,bind,challenge,authorize,enrol,root,custody,envelope,key,bindings,capabilityHeaders,factor,session,password,random,assertNoSession} from './kit.mjs'
export async function managedRecoveryJourney(){
 const {app,owner}=await fresh()
 try{
  const old=await factor(app,owner.token),snap=async()=>app.sql('SELECT id,secret_ciphertext,confirmed_at FROM user_factors WHERE user_id=?',owner.userId)
  const original=await snap()
  assert.equal((await app.call(root+'/challenge',{body:{nonce:random()}})).status,409,'must acknowledge custody first')
  const ack=await bind(app),decoded=JSON.parse(Buffer.from(ack.payload,'base64url'));assert.equal(decoded.anchor,'bound')
  // Unknown/duplicate fields, canonical encoding, actual MAC and exact scope.
  const request=await challenge(app),payload=JSON.parse(Buffer.from(request.challenge.payload,'base64url'))
  for(const override of [{owner_id:'other'},{installation_id:'11111111-1111-4111-8111-111111111111'},{app_origin:'https://other.example'},{type:'app-challenge'},{exp:Math.floor(Date.now()/1000)-1}])assert.equal((await authorize(app,request,override)).status,403)
  const unsigned=envelope({...payload,type:'platform-authorization',iss:bindings.RER_MANAGEMENT_ORIGIN,aud:bindings.APP_ORIGIN+root+'/authorize',platform_proof_id:random()});unsigned.signature=random()
  assert.equal((await app.call(root+'/authorize',{body:unsigned})).status,403)
  assert.equal((await app.call(root+'/authorize',{body:JSON.stringify({...unsigned,extra:true}),raw:true})).status,403)
  const duplicate='{"alg":"HS256","alg":"HS256","payload":"'+unsigned.payload+'","signature":"'+unsigned.signature+'"}'
  assert.equal((await app.call(root+'/authorize',{body:duplicate,raw:true})).status,400)
  assert.equal((await app.call(root+'/authorize',{body:' '.repeat(8193),raw:true})).status,400)
  assert.deepEqual(await snap(),original);await assertNoSession(app,request)
  assert.equal((await app.call(root+'/enrol/totp',{body:{},headers:capabilityHeaders(request.capability)})).status,409)
  const authorized=await authorize(app,request);assert.equal(authorized.status,200);assert.equal(authorized.headers.has('set-cookie'),false)
  assert.equal((await authorize(app,request)).status,403);await assertNoSession(app,request)
  // Outstanding bearer links across all account workspaces are retired.
  const second=await app.seedWorkspace('other');await app.sql("INSERT INTO memberships VALUES(?,?,'operator')",second.projectId,owner.userId)
  // Membership change invalidates this request. A fresh handoff follows the unchanged anchor.
  assert.equal((await app.call(root+'/enrol/totp',{body:{},headers:capabilityHeaders(request.capability)})).status,409)
  const current=await challenge(app);assert.equal((await authorize(app,current)).status,200)
  const tokens=['a'.repeat(64),'b'.repeat(64)]
  await app.sql("INSERT INTO magic_signins(token_hash,user_id,project_id,email,expires_at) VALUES(?,?,?,'owner@example.test',?)",tokens[0],owner.userId,second.projectId,Date.now()+3600000)
  await app.sql("INSERT INTO identity_tokens VALUES(?,?,NULL,'owner@example.test','owner','reset',?,NULL)",tokens[1],owner.userId,Date.now()+3600000)
  const newPassword='new-owner-password-independent',options=await app.ok(root+'/enrol/totp',{body:{},headers:capabilityHeaders(current.capability)})
  const body={factorId:options.factorId,code:totp(options.secret),password:newPassword}
  const results=await Promise.all([1,2].map(()=>app.call(root+'/complete',{body,headers:capabilityHeaders(current.capability)})))
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const completed=results.find(r=>r.status===200)
  assert.equal(completed.data.recoveryCodes.length,10)
  const exportedAudit=await app.ok(`/api/management/projects/${owner.projectId}/audit/export?format=json`,{token:session(completed)})
  const recoveryEvents=exportedAudit.events.filter(event=>event.action.startsWith('recovery.'))
  assert.ok(recoveryEvents.some(event=>event.action==='recovery.completed'))
  const auditText=JSON.stringify(recoveryEvents)
  for(const secret of [key,password,newPassword,current.capability,options.secret,...completed.data.recoveryCodes])assert.equal(auditText.includes(secret),false,'security log exports no recovery material')
  assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,401)
  assert.equal((await app.call('/api/identity/session',{token:session(completed)})).status,200)
  assert.equal((await app.first('SELECT count(*) n FROM memberships WHERE user_id=?',owner.userId)).n,2)
  assert.equal((await app.first('SELECT count(*) n FROM magic_signins WHERE user_id=? AND consumed_at IS NULL',owner.userId)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM identity_tokens WHERE user_id=? AND consumed_at IS NULL',owner.userId)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM user_factors WHERE id=?',old.factorId)).n,0)
  const login=await app.call('/api/identity/login',{body:{email:'owner@example.test',password:newPassword}});assert.equal(login.status,200);assert.equal(login.data.twoFactor,'verify')
  const loginToken=session(login)||login.data.token
  assert.equal((await app.call('/api/identity/two-factor/verify',{body:{code:totp(options.secret,1)},token:loginToken})).status,200)
  assert.equal((await app.call('/api/identity/session',{token:loginToken})).data.twoFactor,undefined)
  assert.equal(app.requests.filter(request=>request.method==='POST').length,0,'OFF recovery never contacts mail')
 }finally{await app.close()}
 await passwordlessRecovery()
 await passkeyRecovery()
}
async function passwordlessRecovery(){
 const app=await startApp({bindings:{...bindings,OWNER_EMAIL:'passwordless@example.test'}})
 try{
  const claimed=await app.call('/auth/bootstrap',{body:{token:bindings.H2H_SETUP_TOKEN}});assert.equal(claimed.status,303)
  const token=session(claimed),actor=await app.ok('/api/identity/session',{token})
  assert.equal((await app.first('SELECT count(*) n FROM credentials WHERE user_id=?',actor.id)).n,0)
  await bind(app);const request=await challenge(app);assert.equal((await authorize(app,request)).status,200)
  const options=await app.ok(root+'/enrol/totp',{body:{},headers:capabilityHeaders(request.capability)})
  const proof={factorId:options.factorId,code:totp(options.secret)}
  assert.equal((await app.call(root+'/complete',{body:proof,headers:capabilityHeaders(request.capability)})).status,400)
  assert.equal((await app.call(root+'/complete',{body:{...proof,password},headers:capabilityHeaders(request.capability)})).status,200)
  const login=await app.ok('/api/identity/login',{body:{email:'passwordless@example.test',password}})
  assert.equal(login.twoFactor,'verify')
  assert.equal((await app.call('/api/identity/two-factor/verify',{body:{code:totp(options.secret,1)},token:login.token})).status,200)
  assert.equal(app.requests.filter(request=>request.method==='POST').length,0)
 }finally{await app.close()}
}
export async function custodyRecoveryJourney(){
 const {app,owner}=await fresh()
 try{
  await bind(app);const pending=await challenge(app);await authorize(app,pending)
  const revoke=custody('revoke');const ack=await app.ok(root+'/custody',{body:revoke});assert.equal(JSON.parse(Buffer.from(ack.payload,'base64url')).watermark,2)
  assert.equal((await app.call(root+'/custody',{body:revoke})).status,409)
  assert.equal((await app.call(root+'/complete',{body:{},headers:capabilityHeaders(pending.capability)})).status,409)
  assert.equal((await authorize(app,pending)).status,403)
  const rotated=randomBytes(32).toString('hex'),nextCustody=op=>envelope(JSON.parse(Buffer.from(custody(op,2).payload,'base64url')),rotated)
  await app.configure({H2H_OWNER_RECOVERY_GENERATION:'2',H2H_OWNER_RECOVERY_KEY:rotated})
  assert.equal((await app.call(root+'/custody',{body:nextCustody('bind')})).status,200)
  await app.configure({H2H_OWNER_RECOVERY_GENERATION:'1'})
  assert.equal((await app.call(root+'/custody',{body:custody()})).status,409)
  await app.sql("UPDATE owner_setup SET claim_id='existing-installation' WHERE singleton=1")
  await app.configure({H2H_OWNER_RECOVERY_GENERATION:'2'})
  const sentinel=await app.ok(root+'/custody',{body:nextCustody('status')});assert.equal(JSON.parse(Buffer.from(sentinel.payload,'base64url')).anchor,'sentinel')
  assert.equal((await app.call(root,{body:{email:'owner@example.test',password,recoveryKey:key}})).data.code,'installation_owner_binding_required')
  await app.sql('UPDATE owner_setup SET claim_id=? WHERE singleton=1',owner.userId)
  await app.sql('UPDATE h2h_business_project SET owner_user_id=? WHERE singleton=1',(await app.seedWorkspace('conflict')).users.owner)
  assert.equal((await app.call(root,{body:{email:'owner@example.test',password,recoveryKey:key}})).data.code,'installation_owner_binding_required')
  assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,200,'refusals changed no session')
 }finally{await app.close()}
}
