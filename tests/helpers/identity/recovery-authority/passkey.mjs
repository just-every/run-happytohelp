import assert from 'node:assert/strict'
import {authenticator} from './authenticator.mjs'
import {fresh,bind,challenge,authorize,root,capabilityHeaders,session} from './kit.mjs'
export async function passkeyRecovery(){
 const {app,owner}=await fresh()
 try{
  await bind(app);const request=await challenge(app);await authorize(app,request)
  const headers=capabilityHeaders(request.capability),client=authenticator(app.origin)
  const options=await app.ok(root+'/enrol/passkey-options',{body:{},headers}),registration=client.registration(options.publicKey.challenge)
  assert.equal((await app.call(root+'/complete',{body:{credential:registration},headers})).status,403,'registration alone supplies no actual factor proof')
  const pending=await app.call(root+'/enrol/passkey-options',{body:{credential:registration},headers})
  assert.equal(pending.status,200);assert.equal(pending.headers.has('set-cookie'),false)
  assert.equal((await app.first('SELECT count(*) n FROM user_factors WHERE user_id=?',owner.userId)).n,0,'staging a public key installs no factor')
  assert.equal((await app.call('/api/identity/session',{headers})).status,401)
  assert.equal((await app.call(root+'/complete',{body:{credential:registration},headers})).status,403,'an unsigned attestation cannot impersonate the new key')
  const result=await app.call(root+'/complete',{body:{credential:client.assertion(pending.data.publicKey.challenge)},headers})
  assert.equal(result.status,200);assert.equal((await app.call('/api/identity/session',{token:session(result)})).status,200)
  assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,401)
 }finally{await app.close()}
}
