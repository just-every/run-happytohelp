import assert from 'node:assert/strict'
import {totp} from '../two-factor.mjs'
import {fresh,root,password,factor,enrol,capabilityHeaders,session} from './kit.mjs'
export async function sharedRecoveryJourney(){
 const {app,owner}=await fresh()
 try{
  const second=await app.seedWorkspace('consent'),P=`/api/management/projects/${owner.projectId}`
  const invitation=await app.ok(P+'/agents',{body:{email:'teammate@example.test'},token:owner.token})
  const inviteToken=new URL(invitation.data.invitationUrl).searchParams.get('token')
  await app.ok('/api/identity/accept-token',{body:{token:inviteToken,name:'Taylor Support',password}})
  const target=await app.ok('/api/identity/login',{body:{email:'teammate@example.test',password}})
  // A historical second membership; both owners consent through native sessions.
  await app.sql("INSERT INTO memberships VALUES(?,?,'operator')",second.projectId,target.actor.id)
  await factor(app,target.token);await factor(app,owner.token);await factor(app,second.tokens.owner)
  const request=await app.ok(root+'/account/request',{body:{email:'teammate@example.test',password}}),headers=capabilityHeaders(request.capability)
  assert.equal((await app.call('/api/identity/session',{headers})).status,401)
  assert.equal((await app.call(root+'/enrol/totp',{body:{},headers})).status,409,'primary proof cannot replace the factor')
  assert.equal((await app.call(root+'/account/approve',{body:{requestId:request.requestId},token:second.tokens.admin})).status,403)
  const review=await app.ok(root+'/account/review?requestId='+request.requestId,{token:owner.token})
  assert.equal(review.target.email,'teammate@example.test');assert.equal(JSON.stringify(review).includes(second.projectId),false)
  assert.equal((await app.call(root+'/account/approve',{body:{requestId:request.requestId},token:owner.token})).status,200)
  assert.equal((await app.ok(root+'/status',{headers})).approved,1)
  assert.equal((await app.call(root+'/complete',{body:{},headers})).status,409)
  assert.equal((await app.call(root+'/account/approve',{body:{requestId:request.requestId},token:second.tokens.owner})).status,200)
  const memberships=await app.sql('SELECT project_id,role FROM memberships WHERE user_id=? ORDER BY project_id',target.actor.id)
  const {options,result}=await enrol(app,request);assert.equal(result.status,200)
  assert.deepEqual(await app.sql('SELECT project_id,role FROM memberships WHERE user_id=? ORDER BY project_id',target.actor.id),memberships)
  assert.equal((await app.call('/api/identity/session',{token:target.token})).status,401)
  assert.equal((await app.call('/api/identity/session',{token:session(result)})).status,200)
  // A revoked approving session invalidates a pending request without credential effects.
  const next=await app.ok(root+'/account/request',{body:{email:'teammate@example.test',password}})
  await app.ok(root+'/account/approve',{body:{requestId:next.requestId},token:owner.token})
  await app.ok(root+'/account/approve',{body:{requestId:next.requestId},token:second.tokens.owner})
  await app.ok('/api/identity/session',{method:'DELETE',token:second.tokens.owner})
  assert.equal((await app.call(root+'/enrol/totp',{body:{},headers:capabilityHeaders(next.capability)})).status,409)
  const still=await app.first('SELECT secret_ciphertext FROM user_factors WHERE user_id=?',target.actor.id);assert.ok(still.secret_ciphertext)
  // First-owner identity and installation administrators have no generic consent route.
  assert.equal((await app.call(root+'/account/request',{body:{email:'owner@example.test',password}})).status,409)
  assert.equal((await app.call(root+'/cancel',{body:{},headers:capabilityHeaders(next.capability)})).status,200)
  assert.equal((await app.ok(root+'/status',{headers:capabilityHeaders(next.capability)})).state,'cancelled')
  assert.equal(app.requests.length,0)
 }finally{await app.close()}
}
