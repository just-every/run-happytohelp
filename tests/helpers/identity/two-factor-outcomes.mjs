import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {totp,encryptionKey} from './two-factor.mjs'

/** Additional IDENTITY-003 outcomes, inside the existing two-factor journey.
 * All business state changes use native routes. Only time since the owner's proof
 * is aged in stored fixture state; only the mail provider network edge is faked.
 */
export async function twoFactorOutcomesJourney(){
 const mail=[],setupToken='synthetic-two-factor-outcomes-setup'
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge',EMAIL_FROM:'support@example.test'},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.resend.com')
  mail.push(await request.json());return Response.json({id:'synthetic-mail-'+mail.length})
 }})
 try{
  const call=(path,body,token,method)=>app.call(path,{body,token,method})
  const owner=(await app.call('/api/identity/bootstrap',{body:{email:'owner-outcomes@example.test',password:'owner-outcomes-correct-horse',name:'Factor outcomes',allowedOrigin:'https://widget.example',setupToken},status:201})).data
  const P=`/api/management/projects/${owner.projectId}`,I='/api/identity',ownerId=(await call(`${I}/session`,undefined,owner.token)).data.id
  const signIn=async(email,password)=>(await app.call(`${I}/login`,{body:{email,password},status:200})).data
  const invitation=await app.call(`${P}/agents`,{body:{email:'operator-outcomes@example.test'},token:owner.token,status:201})
  const inviteToken=new URL(invitation.data.data.invitationUrl).searchParams.get('token')
  assert.equal((await call(`${I}/accept-token`,{token:inviteToken,name:'Factor Operator',password:'operator-outcomes-correct-horse'})).status,200)
  let operator=await signIn('operator-outcomes@example.test','operator-outcomes-correct-horse')
  const operatorId=operator.actor.id,resetPath=`${P}/agents/${operatorId}/two-factor/reset`
  const resetNotices=()=>mail.filter(message=>message.subject.includes('two-factor sign-in'))
  const audit=async()=>{const response=await app.call(`${P}/audit?limit=200`,{token:owner.token,status:200});return response.data.data}
  const resetEvents=async()=>(await audit()).filter(event=>event.action==='two_factor.reset')

  // The actual factor-reset door requires the owner's own factor even after a
  // fresh password sign-in; a refused reset neither sends mail nor records success.
  const noFactor=await call(resetPath,{},owner.token)
  assert.equal(noFactor.status,403);assert.equal(noFactor.data.code,'two_factor_setup_required')
  assert.equal(resetNotices().length,0);assert.equal((await resetEvents()).length,0)

  const held=await signIn('owner-outcomes@example.test','owner-outcomes-correct-horse')
  const enrol=async token=>{
   const started=await app.call(`${I}/two-factor/totp`,{body:{},token,status:201})
   const response=await app.call(`${I}/two-factor/totp/confirm`,{body:{factorId:started.data.factorId,code:totp(started.data.secret)},token,status:201})
   const codes=response.data.recoveryCodes
   assert.equal(codes.length,10,'first enrollment returns exactly ten codes')
   assert.equal(new Set(codes).size,10,'all ten codes are distinct')
   assert.equal(response.headers.get('cache-control'),'no-store')
   const state=await app.call(`${I}/two-factor`,{token,status:200})
   assert.equal(state.data.factors.length,1);assert.equal(state.data.factors[0].kind,'totp')
   assert.equal(state.data.recoveryCodesRemaining,10);assert.equal(state.data.pending,null)
   assert.equal(state.data.stepUp,true)
   assert.equal(state.data.recoveryCodes,undefined,'a later read never reveals the codes again')
   assert.ok(!JSON.stringify(state.data).includes(started.data.secret),'confirmed factor read hides the shared secret')
   assert.equal((await call(`${I}/two-factor/totp/confirm`,{factorId:started.data.factorId,code:totp(started.data.secret)},token)).status,404,'confirmation cannot reveal the codes twice')
   return {codes,secret:started.data.secret}
  }
  const ownerFactor=await enrol(owner.token)
  assert.equal((await call(`${I}/session`,undefined,held.token)).status,401,'first factor enrollment ends other password-only sessions')

  const initialRoles=['owner','operator']
  assert.equal((await call(`${P}/security`,{two_factor_roles:initialRoles},owner.token,'PUT')).status,200)
  assert.equal((await call(`${I}/session`,undefined,operator.token)).status,401,'policy ends an existing password-only operator session')
  operator=await signIn('operator-outcomes@example.test','operator-outcomes-correct-horse')
  assert.equal(operator.twoFactor,'enrol')
  assert.equal((await call('/api/management/bootstrap',undefined,operator.token)).data.code,'two_factor_required')
  const operatorFactor=await enrol(operator.token)
  assert.equal((await call('/api/management/bootstrap',undefined,operator.token)).status,200)

  // Public reads show one recovery code spent, never its plaintext or a restored
  // count after a refused replay from a separate password sign-in.
  const recovered=await signIn('operator-outcomes@example.test','operator-outcomes-correct-horse')
  const proof=await call(`${I}/two-factor/verify`,{recoveryCode:operatorFactor.codes[0]},recovered.token)
  assert.equal(proof.status,200);assert.equal(proof.data.method,'recovery');assert.equal(proof.data.recoveryCodesRemaining,9)
  assert.equal((await call(`${I}/two-factor`,undefined,recovered.token)).data.recoveryCodesRemaining,9)
  const replay=await signIn('operator-outcomes@example.test','operator-outcomes-correct-horse')
  const spent=await call(`${I}/two-factor/verify`,{recoveryCode:operatorFactor.codes[0]},replay.token)
  assert.equal(spent.status,401);assert.equal(spent.data.code,'recovery_code_invalid')
  assert.equal((await call('/api/management/bootstrap',undefined,replay.token)).status,401)
  assert.equal((await call(`${I}/two-factor`,undefined,recovered.token)).data.recoveryCodesRemaining,9)

  const contact=(await app.call(`${P}/contacts`,{body:{name:'Erase after proof',email:'erase-outcomes@example.test'},token:owner.token,status:201})).data.data
  // Age this session's proof, not identity or business records. Password-only
  // re-entry must not refresh an account that already has a second factor.
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE token_hash=?').bind(20*60*1000,sha(owner.token)).run()
  const staleReset=await call(resetPath,{},owner.token)
  assert.equal(staleReset.status,403);assert.equal(staleReset.data.code,'step_up_required');assert.equal(staleReset.data.purpose,'two_factor.reset')
  assert.equal((await call(`${I}/step-up`,{password:'owner-outcomes-correct-horse'},owner.token)).status,401)
  assert.equal((await call(`${I}/two-factor`,undefined,operator.token)).data.factors.length,1,'refused reset retains the teammate factor')
  assert.equal(resetNotices().length,0);assert.equal((await resetEvents()).length,0)

  const roles=['owner','admin','operator','collaborator']
  const doors=[
   {path:`${P}/audit/export?format=json`,purpose:'audit.export',status:200},
   {path:`${P}/plugins`,body:{name:'Support context',url:'https://context.example/plugin'},purpose:'integration.install',status:201},
   {path:`${P}/connections/tokens`,body:{name:'Read support context',scopes:['conversations:read']},purpose:'integration.install',status:201},
   {path:`${P}/contacts/${contact.id}/erase`,body:{},purpose:'contact.erase',status:200},
   {path:`${P}/agents/${operatorId}`,body:{role:'admin'},method:'PUT',purpose:'member.role_change',status:200},
   {path:`${P}/security`,body:{two_factor_roles:roles},method:'PUT',purpose:'two_factor.policy',status:200},
  ]
  for(const door of doors){
   const response=await call(door.path,door.body,owner.token,door.method)
   assert.equal(response.status,403,door.path);assert.equal(response.data.code,'step_up_required',door.path)
   assert.equal(response.data.purpose,door.purpose);assert.deepEqual(response.data.methods,['totp','webauthn','recovery'])
  }
  assert.equal((await call(`${P}/plugins`,undefined,owner.token)).data.data.length,0)
  assert.equal((await call(`${P}/connections/tokens`,undefined,owner.token)).data.data.length,0)
  assert.equal((await call(`${P}/contacts/${contact.id}/erasure`,undefined,owner.token)).status,404)
  assert.equal((await call(`${P}/agents`,undefined,owner.token)).data.data.find(row=>row.id===operatorId).role,'operator')
  assert.deepEqual((await call(`${P}/security`,undefined,owner.token)).data.data.two_factor_roles,initialRoles)

  const fresh=await call(`${I}/step-up`,{recoveryCode:ownerFactor.codes[0]},owner.token)
  assert.equal(fresh.status,200);assert.equal(fresh.data.method,'recovery')
  const allowed=[]
  for(const door of doors){
   const response=await call(door.path,door.body,owner.token,door.method)
   assert.equal(response.status,door.status,`${door.path}: ${JSON.stringify(response.data)}`);allowed.push(response.data)
  }
  assert.equal(allowed[0].projectId,owner.projectId);assert.ok(Array.isArray(allowed[0].events))
  assert.equal((await call(`${P}/plugins`,undefined,owner.token)).data.data[0].url,'https://context.example/plugin')
  const credentials=(await call(`${P}/connections/tokens`,undefined,owner.token)).data.data
  assert.equal(credentials.length,1);assert.deepEqual(credentials[0].scopes,['conversations:read'])
  assert.equal((await call(`${P}/contacts/${contact.id}/erasure`,undefined,owner.token)).data.data.contact_id,contact.id)
  assert.equal((await call(`${P}/agents`,undefined,owner.token)).data.data.find(row=>row.id===operatorId).role,'admin')
  assert.deepEqual((await call(`${P}/security`,undefined,owner.token)).data.data.two_factor_roles,roles)

  // Fresh owner proof resets the teammate, sends one correctly addressed notice
  // at the existing mail edge, and exposes the accountable decision in Security log.
  const reset=await call(resetPath,{},owner.token)
  assert.equal(reset.status,200);assert.deepEqual(reset.data.data,{reset:true,factorsRemoved:1,notice:'sent'})
  const notices=resetNotices();assert.equal(notices.length,1)
  assert.deepEqual(notices[0].to,['operator-outcomes@example.test'])
  assert.equal(notices[0].subject,'Your two-factor sign-in for Factor outcomes was reset')
  assert.match(notices[0].text,/An owner of Factor outcomes/);assert.match(notices[0].text,/signed out everywhere/)
  assert.match(notices[0].text,/set up an authenticator app or passkey again/)
  for(const value of [ownerFactor.secret,operatorFactor.secret,...ownerFactor.codes,...operatorFactor.codes])assert.ok(!JSON.stringify(notices[0]).includes(value),'reset notice contains no factor secrets')
  const events=await resetEvents();assert.equal(events.length,1)
  assert.equal(events[0].outcome,'succeeded');assert.equal(events[0].actor_type,'user');assert.equal(events[0].actor_id,ownerId)
  assert.equal(events[0].target_type,'member');assert.equal(events[0].target_id,operatorId)
  assert.ok(events[0].at>0);assert.equal(events[0].source,'dashboard')
  assert.equal((await call(`${I}/session`,undefined,recovered.token)).status,401)
  const next=await signIn('operator-outcomes@example.test','operator-outcomes-correct-horse')
  assert.equal(next.twoFactor,'enrol');assert.equal((await call('/api/management/bootstrap',undefined,next.token)).status,401)
  assert.equal((await call(`${I}/two-factor`,undefined,next.token)).data.recoveryCodesRemaining,0)
 }finally{await app.close()}
}
