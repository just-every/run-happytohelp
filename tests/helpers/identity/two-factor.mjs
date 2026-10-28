import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// An authenticator app: RFC 6238 codes from the base32 key the setup screen shows.
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function key(secret){let bits=0,value=0;const out=[];for(const char of secret.replace(/\s/g,'')){value=(value<<5)|ALPHABET.indexOf(char);bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}}return Buffer.from(out)}
export function totp(secret,offsetSteps=0,now=Date.now()){
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)+offsetSteps))
 const mac=createHmac('sha1',key(secret)).update(counter).digest(),offset=mac[19]&15
 return String(((mac.readUInt32BE(offset)&0x7fffffff)%1_000_000)).padStart(6,'0')
}
export const encryptionKey=()=>randomBytes(32).toString('base64')

/**
 * IDENTITY-003 through the public doors: enrol TOTP with ten recovery codes, require
 * it by role, force enrolment at the next sign-in, refuse missing, wrong, replayed and
 * spent factors (rate-limited, also under parallel guesses, and audited), step up for exports and policy, reset a
 * teammate's factor and recover a locked-out owner with the installation key.
 */
export async function twoFactorJourney(){
 const setupToken='synthetic-two-factor-setup-token-0123456789abcdef'
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,INTEGRATION_ENCRYPTION_KEY:encryptionKey()}})
 try{
  const call=(path,body,token,method)=>app.call(path,{body,token,method})
  const owner=(await call('/api/identity/bootstrap',{password:'owner-correct-horse-battery',email:'owner@example.com',name:'Support',allowedOrigin:'https://widget.example',setupToken})).data
  const project=owner.projectId,events=async action=>(await app.sql('SELECT outcome,actor_id,detail_json FROM audit_events WHERE project_id=? AND action=? ORDER BY at',project,action))
  // A teammate joins with a password of their own.
  const invite={token:new URL((await call(`/api/management/projects/${project}/agents`,{email:'agent@example.com'},owner.token)).data.data.invitationUrl).searchParams.get('token')}
  assert.equal((await call('/api/identity/accept-token',{token:invite.token,name:'Agent',password:'agent-correct-horse-battery'})).status,200)
  const signIn=async(email,password)=>{const response=await call('/api/identity/login',{email,password});assert.equal(response.status,200);return response.data}
  let agent=await signIn('agent@example.com','agent-correct-horse-battery')
  assert.equal(agent.twoFactor,undefined,'no factor and no policy: one step')
  const ownerReset=await call('/api/identity/password-reset',{userId:agent.actor.id},owner.token)
  assert.equal(ownerReset.status,403);assert.equal(ownerReset.data.code,'two_factor_setup_required','issuing a teammate a password needs the owner\'s own second factor')

  // A held session without the password can neither add the first factor nor guess the password:
  // each re-entered password claims its attempt first, so a parallel burst gets at most five evaluated.
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE user_id=?').bind(20*60*1000,agent.actor.id).run()
  const firstFactor=await call('/api/identity/two-factor/totp',{},agent.token);assert.equal(firstFactor.status,403);assert.equal(firstFactor.data.code,'step_up_required')
  const passwordBurst=await Promise.all(Array.from({length:30},(_,i)=>call('/api/identity/step-up',{password:'wrong-password-'+i},agent.token))),passwordsEvaluated=passwordBurst.filter(r=>r.status===403).length
  assert.ok(passwordsEvaluated>0&&passwordsEvaluated<passwordBurst.length,'a parallel password burst is rate limited');assert.equal(passwordBurst.filter(r=>r.status===429).length,30-passwordsEvaluated)
  assert.equal((await call('/api/identity/step-up',{password:'agent-correct-horse-battery'},agent.token)).status,429,'the right password waits out the window')
  const changeLocked=await call('/api/identity/password',{currentPassword:'agent-correct-horse-battery',password:'agent-new-correct-horse-battery'},agent.token)
  assert.equal(changeLocked.status,429,'changing the password checks the same count')
  const unchanged=await signIn('agent@example.com','agent-correct-horse-battery');assert.equal((await call('/api/identity/session',undefined,unchanged.token,'DELETE')).status,200,'the password is unchanged')
  assert.deepEqual([...new Set((await events('step_up.refused')).map(row=>JSON.parse(row.detail_json).reason))].sort(),['password_incorrect','rate_limited'])
  assert.equal((await events('password.change_refused')).map(row=>JSON.parse(row.detail_json).reason).join(),'rate_limited')
  await app.db.prepare('UPDATE login_attempts SET window_start=window_start-?').bind(15*60*1000+1).run()
  assert.equal((await call('/api/identity/step-up',{password:'agent-correct-horse-battery'},agent.token)).status,200)
  assert.equal((await call('/api/identity/two-factor/totp',{},agent.token)).status,201,'stepped up, the first factor can be added')

  // The owner turns on an authenticator app: a wrong code is refused, the right one returns ten codes once.
  const started=await call('/api/identity/two-factor/totp',{},owner.token);assert.equal(started.status,201)
  assert.match(started.data.uri,/^otpauth:\/\/totp\/HappyToHelp:owner%40example\.com\?secret=[A-Z2-7]+&issuer=HappyToHelp/)
  const ownerSecret=started.data.secret
  assert.equal((await call('/api/identity/two-factor/totp/confirm',{factorId:started.data.factorId,code:'000000'},owner.token)).status,400)
  const enrolled=await call('/api/identity/two-factor/totp/confirm',{factorId:started.data.factorId,code:totp(ownerSecret)},owner.token)
  assert.equal(enrolled.status,201);assert.ok(enrolled.data.recoveryCodes.length>0);assert.equal(new Set(enrolled.data.recoveryCodes).size,enrolled.data.recoveryCodes.length)
  const stored=await app.first("SELECT secret_ciphertext FROM user_factors WHERE user_id=?",owner.userId)
  assert.ok(!stored.secret_ciphertext.includes(ownerSecret),'the TOTP key is stored encrypted')
  assert.equal((await app.first('SELECT count(*) n FROM recovery_codes WHERE user_id=? AND code_hash IN (?)',owner.userId,enrolled.data.recoveryCodes[0])).n,0,'codes are stored only as hashes')

  // Requiring two-factor for agents ends the agent's session that has no factor.
  const policy=await call(`/api/management/projects/${project}/security`,{two_factor_roles:['owner','operator']},owner.token,'PUT')
  assert.equal(policy.status,200);assert.equal(policy.data.data.sessionsEnded,1)
  assert.equal((await call('/api/identity/session',undefined,agent.token)).status,401,'the agent session without a factor ended')
  assert.equal((await events('two_factor.policy_changed')).length,1)

  // At the next sign-in the agent must enrol before reaching any data.
  agent=await signIn('agent@example.com','agent-correct-horse-battery');assert.equal(agent.twoFactor,'enrol')
  const blocked=await call('/api/management/bootstrap',undefined,agent.token);assert.equal(blocked.status,401);assert.equal(blocked.data.code,'two_factor_required')
  assert.equal((await call(`/api/dashboard/projects/${project}/conversations`,undefined,agent.token)).status,401)
  assert.equal((await call('/api/identity/session',undefined,agent.token)).data.twoFactor,'enrol')
  const agentSetup=(await call('/api/identity/two-factor/totp',{},agent.token)).data
  const agentCodes=(await call('/api/identity/two-factor/totp/confirm',{factorId:agentSetup.factorId,code:totp(agentSetup.secret)},agent.token)).data.recoveryCodes
  assert.equal((await call('/api/management/bootstrap',undefined,agent.token)).status,200,'enrolled, the agent reaches the workspace')

  // A sign-in without the factor reaches nothing; wrong, replayed and spent answers are refused and audited.
  let pending=await signIn('agent@example.com','agent-correct-horse-battery');assert.equal(pending.twoFactor,'verify')
  assert.equal((await call('/api/management/bootstrap',undefined,pending.token)).status,401)
  assert.equal((await call('/api/identity/two-factor/totp',{},pending.token)).status,401,'an unproven session cannot add a factor')
  const wrong=await call('/api/identity/two-factor/verify',{code:'111111'},pending.token);assert.equal(wrong.status,401);assert.equal(wrong.data.code,'code_invalid')
  const code=totp(agentSetup.secret,1)
  assert.equal((await call('/api/identity/two-factor/verify',{code},pending.token)).status,200)
  const second=await signIn('agent@example.com','agent-correct-horse-battery')
  assert.equal((await call('/api/identity/two-factor/verify',{code},second.token)).data.code,'code_invalid','the same code is used once per time step')
  assert.equal((await call('/api/identity/two-factor/verify',{recoveryCode:agentCodes[0]},second.token)).data.method,'recovery')
  const third=await signIn('agent@example.com','agent-correct-horse-battery')
  assert.equal((await call('/api/identity/two-factor/verify',{recoveryCode:agentCodes[0]},third.token)).data.code,'recovery_code_invalid','a used recovery code is refused')
  for(let i=0;i<4;i++)await call('/api/identity/two-factor/verify',{code:'222222'},third.token)
  const limited=await call('/api/identity/two-factor/verify',{code:totp(agentSetup.secret)},third.token);assert.equal(limited.status,429,'five wrong answers lock entry for the window')
  // Parallel guesses each claim their attempt before any is checked: from a fresh window a burst gets at most five evaluated.
  await app.db.prepare('UPDATE login_attempts SET window_start=window_start-?').bind(15*60*1000+1).run()
  const live=new Set([-1,0,1].map(step=>totp(agentSetup.secret,step))),guesses=Array.from({length:40},(_,i)=>String(300000+i)).filter(guess=>!live.has(guess)).slice(0,30)
  const burst=await Promise.all(guesses.map(guess=>call('/api/identity/two-factor/verify',{code:guess},third.token))),evaluated=burst.filter(r=>r.status===401).length
  assert.ok(evaluated>=1&&evaluated<=5,`a parallel burst is held to the limit (${evaluated} evaluated)`);assert.equal(burst.filter(r=>r.status===429).length,guesses.length-evaluated)
  assert.equal((await call('/api/identity/two-factor/verify',{code:totp(agentSetup.secret)},third.token)).status,429,'after the burst even the right code waits out the window')
  const refusals=(await events('two_factor.refused')).map(row=>JSON.parse(row.detail_json).reason)
  assert.deepEqual([...new Set(refusals)].sort(),['code_invalid','rate_limited','recovery_code_invalid'])

  // Exports need a recent step-up: an aged proof is refused and audited; the factor renews it.
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE user_id=?').bind(20*60*1000,owner.userId).run()
  const refused=await app.request(`/api/management/projects/${project}/audit/export?format=csv`,{token:owner.token})
  assert.equal(refused.status,403);assert.equal((await refused.json()).code,'step_up_required')
  assert.equal((await call('/api/identity/step-up',{password:'owner-correct-horse-battery'},owner.token)).status,401,'a password does not step up an account with a factor')
  const agedReset=await call('/api/identity/password-reset',{userId:agent.actor.id},owner.token);assert.equal(agedReset.status,403);assert.equal(agedReset.data.code,'step_up_required')
  assert.equal((await call('/api/identity/step-up',{code:totp(ownerSecret,1)},owner.token)).status,200)
  assert.equal((await call('/api/identity/password-reset',{userId:agent.actor.id},owner.token)).status,201,'with a recent factor the owner issues the reset link')
  assert.equal((await events('member.password_reset_issued')).length,1)
  const exported=await app.request(`/api/management/projects/${project}/audit/export?format=csv`,{token:owner.token});assert.equal(exported.status,200)
  const csv=await exported.text();assert.match(csv,/two_factor\.policy_changed/);assert.match(csv,/two_factor\.refused/);assert.match(csv,/step_up\.required/)
  assert.doesNotMatch(csv,new RegExp(ownerSecret),'no secret in the export');assert.equal((await events('audit.exported')).length,1)

  // The owner resets the agent's factor with their own recent factor: the agent is signed out and told.
  const reset=await call(`/api/management/projects/${project}/agents/${agent.actor.id}/two-factor/reset`,{},owner.token);assert.equal(reset.status,200)
  assert.equal(reset.data.data.factorsRemoved,1);assert.equal((await call('/api/identity/session',undefined,agent.token)).status,401)
  assert.equal((await app.first('SELECT count(*) n FROM recovery_codes WHERE user_id=?',agent.actor.id)).n,0)
  assert.equal((await signIn('agent@example.com','agent-correct-horse-battery')).twoFactor,'enrol','reset under the policy means enrolling again')
  assert.equal((await events('two_factor.reset')).length,1)

  // The owner loses the phone: email alone never recovers; the installation key set through rer does, once.
  const recover=body=>app.call('/api/identity/owner-recovery',{body})
  assert.equal((await recover({email:'owner@example.com',password:'owner-correct-horse-battery',recoveryKey:'x'.repeat(40)})).status,503,'no key configured')
  const recoveryKey=randomBytes(32).toString('hex');await app.configure({H2H_OWNER_RECOVERY_KEY:recoveryKey})
  assert.equal((await recover({email:'owner@example.com',password:'owner-correct-horse-battery',recoveryKey:'y'.repeat(64)})).status,403)
  assert.equal((await recover({email:'agent@example.com',password:'agent-correct-horse-battery',recoveryKey})).status,403,'only an owner recovers this way')
  const recovered=await recover({email:'owner@example.com',password:'owner-correct-horse-battery',recoveryKey});assert.equal(recovered.status,200)
  assert.equal((await call('/api/identity/session',undefined,owner.token)).status,401,'every earlier owner session ended')
  assert.equal((await app.first('SELECT count(*) n FROM user_factors WHERE user_id=?',owner.userId)).n,0)
  assert.equal((await recover({email:'owner@example.com',password:'owner-correct-horse-battery',recoveryKey})).status,403,'each key value works once')
  const ownerRecovery=await events('owner.recovered');assert.equal(ownerRecovery.length,1)
  assert.deepEqual((await events('owner.recovery_refused')).map(row=>JSON.parse(row.detail_json).reason),['key_incorrect','key_already_used'])
 }finally{await app.close()}
}
