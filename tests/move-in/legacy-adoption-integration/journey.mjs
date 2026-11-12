import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runnerRuntime} from './runtime.mjs'
import {recordMeasurement} from '../../helpers/legacy-worker/profiler.mjs'
import {packageFixture,sha} from './fixture.mjs'

export async function adoptionIntegrationJourney({representative=true}={}){
 const app=await runnerRuntime(),directory=await mkdtemp(join(tmpdir(),'legacy-wire-'))
 app.ok=async(path,options={})=>{const r=await app.call(path,{...options,status:200});return r.data}
 const facts={states:[],uploads:0,maxStatements:0,measurements:{},kills:0}
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-wire-setup',email:'synthetic-wire@example.test',password:'Synthetic wire password 42!',name:'Support owner',allowedOrigin:app.origin},status:201})).data
  const setup=owner.projectId,token=owner.token,source='synthetic-wire-source',foreign=await app.seedWorkspace('wire-foreign')
  const p=await packageFixture(join(directory,'package'),source,{representative,large:representative,staff:[{id:owner.userId,name:'Historical owner',email:'synthetic-wire@example.test',created_at:1},{id:foreign.users.owner,name:'Historical foreign admin',email:'owner-wire-foreign@example.test',created_at:1}]}),base=`/api/move-in/projects/${setup}/legacy-import/${p.manifestSha256}`
  const manifest=(body=p.bytes,headers={})=>app.call(base+'/manifest',{method:'PUT',raw:true,body,token,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256,...headers}})
  assert.equal((await manifest(p.bytes,{'X-Legacy-Contract-Version':'1'})).status,422)
  assert.equal((await manifest(Buffer.concat([p.bytes,Buffer.from(' ')]))).status,422)
  assert.equal((await manifest()).status,201);assert.equal((await manifest()).data.data.alreadyPresent,true)
  assert.equal((await app.call(base+'/status',{token:foreign.tokens.owner})).status,404)
  const uploaded=(await app.ok(base+'/status',{token})).data
  assert.equal(uploaded.sourceProjectId,source);assert.ok(uploaded.missing.length)
  const before=await app.first('SELECT count(*) n FROM users'),native=await app.first('SELECT count(*) n FROM memberships'),work=await app.first('SELECT count(*) n FROM conversation_outbox')
  facts.shape={packageRows:Object.values(p.manifest.source.rowCounts).reduce((a,b)=>a+b,0),largestPartBytes:Math.max(...[...p.manifest.chunks,...p.manifest.context].map(p=>p.bytes)),largestObjectBytes:Math.max(...p.manifest.objects.map(o=>o.size)),descriptors:p.manifest.chunks.length+p.manifest.context.length+p.manifest.objects.length}
  const expiry=await app.first('SELECT expires_at FROM legacy_package_custody WHERE manifest_sha256=?',p.manifestSha256)
  await app.call(base+'/status',{token,status:200});assert.deepEqual(await app.first('SELECT expires_at FROM legacy_package_custody WHERE manifest_sha256=?',p.manifestSha256),expiry)
  for(const part of uploaded.missing){
   const bytes=await readFile(join(p.root,part.file)),path=base+'/files/'+part.file,headers={'Content-Type':'application/octet-stream'}
   assert.equal((await app.call(path,{token,method:'PUT',raw:true,body:Buffer.alloc(bytes.length,32),headers})).status,422)
   await app.call(path,{token,method:'PUT',raw:true,body:bytes,headers,status:201});facts.uploads++
  }
  assert.equal((await app.ok(base+'/status',{token})).data.missing.length,0)
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null)
  const review=(await app.ok(base+'/adoption',{token})).data;assert.equal(review.canApprove,true);assert.equal(review.custodyProjectId,setup);assert.equal(review.destinationProjectId,source)
  assert.equal((await app.call(base+'/adoption/approve',{token,body:{approvedManifestSha256:p.manifestSha256,sourceProjectId:source,policyVersion:2},headers:{Origin:'https://foreign.example'}})).status,403)
  const approval={approvedManifestSha256:p.manifestSha256,sourceProjectId:source,policyVersion:2}
  await app.call(base+'/adoption/approve',{token,body:approval,headers:{Origin:app.origin},status:202})
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null)
  await app.call(base+'/start',{token,body:{approvedManifestSha256:p.manifestSha256},status:202})
  for(let tick=0;tick<350;tick++){
   const result=(await app.ok(base+'/result',{token})).data
   facts.lastRun=result.run
   if(result.run.nextAt>Date.now()){await new Promise(resolve=>setTimeout(resolve,Math.min(1000,result.run.nextAt-Date.now())));continue}
   const state=result.run.state+':'+result.run.phase
   if(facts.states.at(-1)!==state)facts.states.push(state)
   if(result.run.state==='paused')throw new Error('Mounted v2 paused: '+JSON.stringify(result))
   if(result.run.state==='complete'){
    assert.equal(result.journalEqualsPackage,true);assert.equal(result.attachments.complete,true);assert.equal(result.work.unchanged,true);facts.result=result;break
   }
   const jobs=(await app.takeJobs()).filter(job=>job.type==='legacy-import.step')
   assert.ok(jobs.length,'durable run has a queued wake')
   if(facts.kills<2&&result.run.phase===(facts.kills===0?'objects':'rows')){
    const point=facts.kills===0?'after_copy':'after_canonical'
    let interrupted=false
    const inflight=app.runJobs(jobs,{'x-legacy-barrier':point}).catch(()=>{interrupted=true;return null})
    await app.until(async()=> (await app.call('/_test/legacy/barrier')).data.barrier===point,{message:point})
    if(point==='after_copy'){
     assert.ok(await app.first('SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=? AND key=?',p.manifestSha256,p.manifest.objects[0].key),'exact candidate registered before any copy')
     const nonce=await (await app.files).head(p.manifest.objects[0].key);assert.equal(nonce.customMetadata.canonicalReservation,`legacy-package:${p.manifestSha256}`)
    }else assert.ok(await app.first('SELECT 1 FROM projects WHERE id=?',source),'creation is committed before the checkpoint death')
    await app.crash();await inflight;assert.equal(interrupted,true,'owned worker death interrupts the actual request');facts.kills++
    await app.db.batch([app.db.prepare('UPDATE legacy_import_worker_runs SET lease_until=0,next_at=0 WHERE manifest_sha256=?').bind(p.manifestSha256),app.db.prepare('UPDATE legacy_delta_leases SET expires_at=0 WHERE project_id=?').bind(source)])
    await app.scheduled();continue
   }
   if(facts.kills===2&&!facts.stopFenced&&result.run.phase==='rows'){
    const c=await app.first('SELECT cursor_json FROM legacy_import_worker_runs WHERE manifest_sha256=?',p.manifestSha256)
    if(Number(JSON.parse(c.cursor_json).ordinal??0)>0){
     const pending=app.runJobs(jobs,{'x-legacy-barrier':'before_canonical'})
     await app.until(async()=> (await app.call('/_test/legacy/barrier')).data.barrier==='before_canonical',{message:'v2 stop boundary'})
     const before=await app.first('SELECT count(*) n FROM legacy_import_rows')
     await app.call(base+'/stop',{token,body:{},status:202});await app.call('/_test/legacy/barrier',{body:{}});await pending
     assert.deepEqual(await app.first('SELECT count(*) n FROM legacy_import_rows'),before)
     await app.call(base+'/resume',{token,body:{approvedManifestSha256:p.manifestSha256},status:202});facts.stopFenced=true;continue
    }
   }
   const before=await app.first('SELECT metrics_json FROM legacy_import_worker_runs WHERE manifest_sha256=?',p.manifestSha256),profiled=await app.profile(()=>app.runJobs(jobs)),after=await app.first('SELECT metrics_json FROM legacy_import_worker_runs WHERE manifest_sha256=?',p.manifestSha256),response=profiled.value
   facts.maxStatements=Math.max(facts.maxStatements,response.metrics.statements)
   recordMeasurement(facts.measurements,result.run.phase,JSON.parse(before.metrics_json),JSON.parse(after.metrics_json),profiled.measurement,response.metrics.statements)
   assert.deepEqual(response.retried,[])
   if(tick===349)throw new Error('Mounted run did not complete: '+JSON.stringify(result.run))
  }
  assert.equal(facts.kills,2);assert.equal(facts.stopFenced,true)
  assert.deepEqual(await app.first('SELECT count(*) n FROM users'),before)
  assert.equal((await app.first('SELECT count(*) n FROM memberships')).n,native.n+1)
  assert.deepEqual(await app.first('SELECT count(*) n FROM conversation_outbox'),work)
  assert.equal((await app.call(`/api/management/projects/${source}/contacts/synthetic-contact`,{token})).status,200)
  const adopted=(await app.call('/api/identity/switch-project',{token,body:{projectId:source},status:200})).data
  const transcript=(await app.call('/api/dashboard/conversations/synthetic-conversation/buckets/synthetic-conversation',{token:adopted.token,status:200})).data.data
  assert.equal(transcript.messages.find(m=>m.id==='synthetic-message').agent.name,'Historical owner')
  assert.equal((await app.first("SELECT count(*) n FROM legacy_actor_origins WHERE project_id=?",source)).n>0,true)
  assert.equal((await app.first("SELECT count(*) n FROM legacy_import_rows WHERE source_table IN ('users','project_users') AND status='archived_only'")).n,4)
  assert.equal((await app.call(`/api/imported-files/${encodeURIComponent('legacy-package/'+p.manifestSha256+'/manifest.json')}`,{token})).status,404)
  await app.call(base+'/start',{token,body:{approvedManifestSha256:p.manifestSha256,replay:true},status:202})
  for(let tick=0;tick<350;tick++){
   const r=(await app.ok(base+'/result',{token})).data
   if(r.run.state==='paused')throw new Error('Replay paused: '+JSON.stringify(r))
   if(r.run.state==='complete'){assert.equal(r.attempt.appliedRows,0);facts.replay=r.attempt;break}
   await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'))
  }
  const erase=`/api/management/projects/${source}/contacts/synthetic-contact/erase`
  for(let n=0;n<20;n++){
   const r=await app.call(erase,{token,body:{confirmation:'ERASE'}})
   if(r.status===200){facts.erased=true;break}
   assert.equal(r.status,409,JSON.stringify(r.data));await app.drainJobs()
  }
  assert.equal(facts.erased,true)
  assert.equal((await app.first("SELECT count(*) n FROM legacy_import_runs WHERE source_json LIKE '%synthetic-private-package-metadata%'")).n,0,'arbitrary manifest metadata is not retained in package provenance')
  assert.equal(await (await app.files).head(`legacy-package/${p.manifestSha256}/manifest.json`),null)
  await app.call(`/api/management/projects/${source}/contacts/synthetic-peer-contact`,{token,status:200})
  const peer=await (await app.files).get(p.manifest.objects.find(o=>String(o.mediaId)==='synthetic-peer-media').key);assert.equal(await peer.text(),'Synthetic retained peer bytes','indivisible source purge keeps canonical peer media')
  const invalid=(await app.ok(base+'/result',{token})).data;assert.deepEqual(invalid.attachments,facts.result.attachments,'erasure keeps non-content historical checksum counts');assert.equal(invalid.sourceCustody.invalidated,true);assert.equal(invalid.run.canResume,false)
  assert.equal((await manifest()).status,409)
  facts.counts={nativeUsersBefore:before.n,nativeUsersAfter:(await app.first('SELECT count(*) n FROM users')).n,sourceRows:facts.result.attempt.appliedRows,membershipsAdded:1}
  if(process.env.H2H_EVIDENCE_DIR){await mkdir(process.env.H2H_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.H2H_EVIDENCE_DIR,'mounted-adoption.json'),JSON.stringify(facts,null,2)+'\n')}
  return facts
 }catch(error){if(process.env.H2H_EVIDENCE_DIR)await writeFile(join(process.env.H2H_EVIDENCE_DIR,'mounted-adoption-failure.json'),JSON.stringify({name:error.name,states:facts.states,lastRun:facts.lastRun,kills:facts.kills},null,2)+'\n');throw error}finally{await app.close();await rm(directory,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await adoptionIntegrationJourney()))
