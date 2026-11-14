import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {packageFixture} from '../../move-in/legacy-adoption-integration/fixture.mjs'

export async function finishLegacy(app,base,token){
 for(let tick=0;tick<400;tick++){
  const r=await app.call(base+'/result',{token,status:200}),value=r.data.data
  assert.notEqual(value.run.state,'paused',JSON.stringify(value))
  if(value.run.state==='complete'){assert.equal(value.journalEqualsPackage,true);assert.equal(value.attachments.complete,true);assert.equal(value.work.unchanged,true);return value}
  const jobs=await app.takeJobs();assert.ok(jobs.length,'unfinished copy has a queued continuation')
  const outcome=await app.runJobs(jobs);assert.deepEqual(outcome.failures,[],'the actual storage/worker boundary must complete without hidden failures')
 }
 assert.fail('bounded legacy copy did not finish')
}
export async function uploadLegacy(app,base,p,token,{day}={}){
 const headers={'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256,...(day?{'X-Rehearsal-Day':day}:{})}
 const manifest=await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:p.bytes,headers})
 assert.ok([200,201].includes(manifest.status),JSON.stringify(manifest))
 const inventory=(await app.call(base+'/status',{token,status:200})).data.data
 for(const file of inventory.missing)await app.call(base+'/files/'+file.file,{token,method:'PUT',raw:true,body:await readFile(join(p.root,file.file)),headers:{'Content-Type':'application/octet-stream'},status:201})
 assert.equal((await app.call(base+'/status',{token,status:200})).data.data.missing.length,0)
}
export async function prepareAcceptedAdoption(app,directory){
 const owner=(await app.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-wire-setup',email:'synthetic-wire@example.test',password:'Synthetic wire password 42!',name:'Support owner',allowedOrigin:app.origin},status:201})).data
 const setup=owner.projectId,source='synthetic-rehearsal-source',origin=await packageFixture(join(directory,'initial-adoption'),source,{staff:[{id:owner.userId,name:'Historical native owner',email:'synthetic-wire@example.test'}]})
 const base=`/api/move-in/projects/${setup}/legacy-import/${origin.manifestSha256}`
 await uploadLegacy(app,base,origin,owner.token)
 await app.call(base+'/adoption/approve',{token:owner.token,body:{approvedManifestSha256:origin.manifestSha256,sourceProjectId:source,policyVersion:2},headers:{Origin:app.origin},status:202})
 await app.call(base+'/start',{token:owner.token,body:{approvedManifestSha256:origin.manifestSha256},status:202})
 await finishLegacy(app,base,owner.token)
 return {owner,setup,source,origin}
}
/** Enrolled synthetic factor and recent proof are fixture identity state; all
 * installation anchoring, adoption and consent admission use the native doors. */
export async function createNativeRehearsal(app,{owner,setup,origin,zendeskProjectId,zendeskPullId}){
 const at=Date.now(),hash=createHash('sha256').update(owner.token).digest('hex')
 await app.db.batch([
  app.db.prepare("INSERT INTO user_factors(id,user_id,kind,label,credential_id,public_key,created_at,confirmed_at) VALUES(?,?,'webauthn','Synthetic test factor',?,'synthetic-public-factor',?,?)").bind('synthetic-rehearsal-factor-'+owner.userId,owner.userId,'synthetic-rehearsal-key-'+owner.userId,at,at),
  app.db.prepare("UPDATE session_factors SET method='webauthn',verified_at=? WHERE token_hash=? AND user_id=?").bind(at,hash,owner.userId)])
 const route=`/api/move-in/projects/${setup}/rehearsals`,input={originManifestSha256:origin.manifestSha256,zendeskProjectId,zendeskPullId,copierId:'synthetic-rehearsal-copier',expiresAt:at+86400000}
 const foreign=await app.call(route,{token:owner.token,body:input,headers:{Origin:'https://foreign.example'}})
 assert.equal(foreign.status,403)
 const response=await app.call(route,{token:owner.token,body:input,headers:{Origin:app.origin},status:201})
 const grant=response.data.data
 assert.ok(grant.credential?.startsWith('hhr_'));assert.ok(grant.grant.id)
 assert.equal(JSON.stringify((await app.call(route,{token:owner.token,status:200})).data).includes(grant.credential),false,'credential appears once')
 return {...grant,root:`/api/move-in/projects/${setup}/rehearsals/${grant.grant.id}`}
}
