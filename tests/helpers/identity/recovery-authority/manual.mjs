import assert from 'node:assert/strict'
import {totp} from '../two-factor.mjs'
import {root,capabilityHeaders,enrol,session} from './kit.mjs'
export async function manualRecovery(app,owner,recoveryKey,password){
 const request=await app.call(root,{body:{email:'owner@example.com',password,recoveryKey}})
 assert.equal(request.status,201);assert.equal(request.headers.has('set-cookie'),false)
 const recovery=request.data
 assert.equal((await app.first('SELECT count(*) n FROM user_factors WHERE user_id=? AND confirmed_at IS NOT NULL',owner.userId)).n>0,true,'authorization keeps existing factors')
 const {options,result}=await enrol(app,recovery)
 assert.equal(result.status,200);assert.ok(Array.isArray(result.data.recoveryCodes)&&result.data.recoveryCodes.length>0)
 assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,401)
 assert.equal((await app.call('/api/identity/session',{token:session(result)})).status,200)
 assert.equal((await app.call(root+'/complete',{body:{factorId:options.factorId,code:totp(options.secret)},headers:capabilityHeaders(recovery.capability)})).status,409)
 assert.equal((await app.call(root,{body:{email:'owner@example.com',password,recoveryKey}})).status,409,'spent static key stays spent')
 const security=await app.ok(`/api/management/projects/${owner.projectId}/audit/export?format=json`,{token:session(result)})
 assert.ok(security.events.some(event=>event.action==='recovery.refused'&&event.detail.reason==='key_already_used'),'the owner can read the spent-key refusal in the Security log')
}
