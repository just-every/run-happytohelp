import assert from 'node:assert/strict'
import {webcrypto,randomUUID} from 'node:crypto'
import {doorFixture,packageFixture,sha} from './door-fixture.mjs'
/** Emitted Worker HTTP proof, also reused by the existing portable-restore
 * journey. This is the same full native door, with a synthetic local signer. */
export async function seedRuntimeLegacy(runtime,owner,keys,variables){
 const fixture=doorFixture(variables.OWNER_EMAIL,{large:false,mutate:tables=>{tables.conversations[0].resolved_at='2024-01-03T00:00:00.000Z'}}),prepared=packageFixture(fixture);let grants=0
 async function action(action,body,approval={}){const now=Math.floor(Date.now()/1000),signed=[{alg:'ES256',typ:'rer-import-grant+jwt',kid:'test'},{v:1,iss:variables.RER_OWNER_CLAIM_ISSUER,aud:variables.APP_ORIGIN,installationId:variables.RER_OWNER_CLAIM_INSTALLATION_ID,email:variables.OWNER_EMAIL,jti:randomUUID(),iat:now,exp:now+300,action,namespace:'happytohelp-legacy',maxBytes:2097152,maxChunks:32,maxRecords:100000,...approval}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.'),authorization=signed+'.'+Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,Buffer.from(signed))).toString('base64url');grants++
  const response=await fetch(runtime.origin+'/api/rer/import/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+authorization},body:JSON.stringify(body)}),data=await response.json();assert.equal(response.ok,true,JSON.stringify({action,status:response.status,data}));return data
 }
 async function upload(bytes,name){const uploadId=randomUUID(),totalChunks=Math.ceil(bytes.length/65536);for(let index=0;index<totalChunks;index++){const part=bytes.subarray(index*65536,(index+1)*65536);await action('uploads',{uploadId,name,bundleSha256:sha(bytes),totalBytes:bytes.length,totalChunks,index,chunkSha256:sha(part),base64:part.toString('base64')})}return uploadId}
 const uploadId=await upload(prepared.manifestBytes,'rer-package.json');for(const bytes of prepared.segments)await upload(bytes,'rer-segment')
 const plan=await action('plan',{uploadId});assert.equal(plan.counts.rejected,0)
 for(let i=0;i<100;i++){const result=await action('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},{fingerprint:plan.fingerprint,approvalRecordId:'synthetic-runtime-review',approvedAt:'2026-11-05T00:00:00.000Z'});if(result.job.state==='completed')break;assert.ok(i<99)}
 assert.equal((await action('reconcile',{planId:plan.planId})).ok,true)
 const state={fixture,plan,grants,action};await verifyRuntimeLegacy(runtime,owner,state);return state
}
export async function verifyRuntimeLegacy(runtime,owner,{fixture}){
 const path=runtime.origin+'/api/conversations/legacy-conversation/media/legacy-media',response=await fetch(path,{headers:{Authorization:'Bearer '+owner.token}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture.bytes);assert.equal((await fetch(path)).status,401)
 const messages=await fetch(runtime.origin+'/api/conversations/legacy-conversation/messages',{headers:{Authorization:'Bearer '+owner.token}});assert.equal(messages.status,200);assert.equal((await messages.json()).messages[0].content,'A retained historical message')
}
