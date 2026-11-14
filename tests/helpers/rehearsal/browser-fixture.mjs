import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {packageFixture} from '../../move-in/legacy-adoption-integration/fixture.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
import {SUBDOMAIN,CLIENT_ID} from '../../move-in/zendesk-pull-fixture.mjs'
export function publicClient(runtime){
 const call=async(path,{token,body,raw=false,method=body===undefined?'GET':'POST',headers={},status=200}={})=>{
  const r=await fetch(runtime.origin+path,{method,redirect:'manual',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)}),text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}
  assert.equal(r.status,status,JSON.stringify({path,status:r.status,data}));return data
 }
 const wait=async(path,token,done)=>{const end=Date.now()+120000;for(;;){const r=(await call(path,{token})).data;assert.notEqual(r.run?.state,'paused',JSON.stringify(r));assert.ok(!r.error,JSON.stringify(r));if(done(r))return r;if(Date.now()>end)assert.fail('Public queued operation did not finish: '+path);await new Promise(resolve=>setTimeout(resolve,200))}}
 return {call,wait}
}
export async function uploadPackage(api,base,p,token,day){
 await api.call(base+'/manifest',{token,method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256,...(day?{'X-Rehearsal-Day':day}:{})},status:201})
 const inventory=(await api.call(base+'/status',{token})).data
 for(const part of inventory.missing)await api.call(base+'/files/'+part.file,{token,method:'PUT',raw:true,body:await readFile(join(p.root,part.file)),headers:{'Content-Type':'application/octet-stream'},status:201})
}
export async function acceptedBrowserHistory(runtime,api,directory,owner){
 const source='synthetic-browser-rehearsal',p=await packageFixture(join(directory,'origin'),source,{staff:[{id:'synthetic-former-agent',name:'Maya · former billing support',email:'synthetic-maya@example.test'}]})
 const legacy=`/api/move-in/projects/${owner.projectId}/legacy-import/${p.manifestSha256}`
 await uploadPackage(api,legacy,p,owner.token)
 await api.call(legacy+'/adoption/approve',{token:owner.token,body:{approvedManifestSha256:p.manifestSha256,sourceProjectId:source,policyVersion:2},headers:{Origin:runtime.origin},status:202})
 await api.call(legacy+'/start',{token:owner.token,body:{approvedManifestSha256:p.manifestSha256},status:202});await api.wait(legacy+'/result',owner.token,r=>r.run.state==='complete')
 const native=`/api/move-in/projects/${owner.projectId}/zendesk`,auth=await api.call(native+'/connect',{token:owner.token,body:{subdomain:SUBDOMAIN,clientId:CLIENT_ID}}),url=new URL(auth.url)
 await api.call('/api/move-in/zendesk/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-browser-code-1'}),{token:owner.token,status:302})
 const pull=(await api.call(native+'/pulls',{token:owner.token,body:{},status:201})).data,ready=await api.wait(native+'/pulls/'+pull.id,owner.token,r=>r.state==='ready')
 await api.call(native+'/pulls/'+pull.id+'/approve',{token:owner.token,body:{fingerprint:ready.fingerprint},status:202});await api.wait(native+'/pulls/'+pull.id,owner.token,r=>r.state==='applied')
 return {origin:p,source,pull:pull.id}
}
export async function browserDelta(directory,origin){
 const b=structuredClone(origin.bundle),cutoff='2026-11-13T12:00:00.000000Z';b.source={...b.source,sourceCutoff:cutoff,snapshotClock:cutoff,watermark:'2026-11-13T11:55:00.000000Z'}
 b.tables.contacts[0].name='Legacy name changed after review'
 b.tables.messages.push({id:'synthetic-browser-daily-message',project_id:b.source.projectId,conversation_id:'synthetic-conversation',contact_id:'synthetic-contact',content:'Could you explain the revised invoice and keep the plan unchanged?',created_at:'2026-11-13T10:00:00Z'})
 const p=await writeLegacyPackage(join(directory,'daily'),b,{rowsPerChunk:10,delta:{since:origin.manifest.source.watermark,tables:{projects:b.tables.projects,contacts:b.tables.contacts,conversations:b.tables.conversations,messages:b.tables.messages}}})
 return {...p,root:join(directory,'daily'),bytes:await readFile(join(directory,'daily','manifest.json'))}
}
