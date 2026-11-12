import assert from 'node:assert/strict'
import {totp} from '../two-factor.mjs'
import {fresh,bind,challenge,authorize,root,capabilityHeaders} from './kit.mjs'
export async function recoveryRaceAndLimits(){
 const {app,owner}=await fresh()
 try{
  await bind(app);const request=await challenge(app);await authorize(app,request)
  const options=await app.ok(root+'/enrol/totp',{body:{},headers:capabilityHeaders(request.capability)})
  const before=await app.sql('SELECT * FROM credentials WHERE user_id=?',owner.userId)
  const refused=await app.call(root+'/complete',{body:{factorId:options.factorId,code:totp(options.secret),password:'would-be-replacement-password'},headers:{...capabilityHeaders(request.capability),'x-test-before-statement':"UPDATE owner_setup SET claim_id='existing-installation' WHERE singleton=1",'x-test-statement':'INSERT INTO identity_recovery_assertions'}})
  assert.equal(refused.status,409)
  assert.deepEqual(await app.sql('SELECT * FROM credentials WHERE user_id=?',owner.userId),before)
  assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,200)
  assert.equal((await app.first('SELECT completion_id FROM identity_recovery_requests WHERE id=?',request.requestId)).completion_id,null)
  // Independent persisted buckets: changing IP cannot escape the account count.
  const burst=await Promise.all(Array.from({length:12},(_,i)=>app.call(root+'/account/request',{body:{email:'unknown@example.test',password:'incorrect-native-password'},headers:{'CF-Connecting-IP':`192.0.2.${i+1}`}})))
  assert.ok(burst.some(r=>r.status===403)&&burst.some(r=>r.status===429));assert.ok(burst.every(r=>[403,429].includes(r.status)))
  await app.configure({})
  assert.equal((await app.call(root+'/account/request',{body:{email:'unknown@example.test',password:'incorrect-native-password'},headers:{'CF-Connecting-IP':'192.0.2.200'}})).status,429)
  // Changing accounts cannot escape one client IP's aggregate admission count.
  const requests=await Promise.all(Array.from({length:34},(_,i)=>app.call(root+'/account/request',{body:{email:`unknown-${i}@example.test`,password:'incorrect-native-password'},headers:{'CF-Connecting-IP':'198.51.100.44'}})))
  assert.ok(requests.some(r=>r.status===403)&&requests.some(r=>r.status===429));assert.ok(requests.every(r=>[403,429].includes(r.status)))
  assert.ok(requests.filter(r=>r.status===429).every(r=>r.headers.get('retry-after')))
  assert.equal((await app.first('SELECT count(*) n FROM identity_recovery_requests')).n,1,'unknown accounts create no requests')
 }finally{await app.close()}
}
