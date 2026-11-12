import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {runnerRuntime} from './runtime.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const literal=Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' ')
async function fixture(root,project){
 const contacts=Array.from({length:36},(_,i)=>({id:`synthetic-c-${i}`,project_id:project,name:'Synthetic',created_at:1,...(i===35?{deleted_at:2}:{})}))
 const conversations=Array.from({length:4},(_,i)=>({id:`synthetic-conv-${i}`,project_id:project,contact_id:contacts[i].id,created_at:1,updated_at:2}))
 const messages=Array.from({length:65},(_,i)=>({id:`synthetic-msg-${String(i).padStart(3,'0')}`,project_id:project,conversation_id:conversations[i%4].id,contact_id:contacts[i%4].id,content:i===0?literal:`Synthetic history ${i}`,local_id:'synthetic-delivery-'+Math.floor(i/8),created_at:100+Math.floor(i/2)}))
 const media=[0,1].map(i=>({id:`synthetic-media-${i}`,project_id:project,message_id:messages[i].id,filename:'synthetic-'+i,extension:'bin',size:64+i,object_key:`legacy/projects/${project}/media/synthetic-media-${i}`,content_type:'application/octet-stream',created_at:1}))
 const objects=media.map((row,i)=>{const bytes=Buffer.alloc(64+i,17+i);return {key:row.object_key,dataBase64:bytes.toString('base64'),sha256:hash(bytes)}})
 const bundle={format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'synthetic',exportedAt:'2026-01-01T00:00:00Z',projectId:project},tables:{contacts,conversations,messages,media,mediables:media.map((row,i)=>({id:'synthetic-link-'+i,media_id:row.id,mediable_type:'App\\Message',mediable_id:messages[i].id})),events:[{id:'synthetic-note',project_id:project,conversation_id:conversations[0].id,agent_id:'synthetic-owner',type:'INTERNAL_NOTE',payload:literal,created_at:1}],datasets:[{id:'synthetic-dataset',project_id:project,name:'Synthetic dataset',status:'ready',created_at:1}],dataset_files:[{id:'synthetic-document',dataset_id:'synthetic-dataset',title:'Synthetic guide',content:'A short synthetic knowledge document.',created_at:1}],ai_usages:[{id:'synthetic-usage',project_id:project,created_at:1,cost:'0'}]},objects}
 return {...await writeLegacyPackage(root,bundle,{rowsPerChunk:31}),literal,messageId:messages[0].id,conversationId:conversations[0].id,bundle}
}
export async function putPackage(runtime,root,manifest,sha,projectId){
 const files=await runtime.files,metadata={contractVersion:'1',projectId,manifestSha256:sha}
 await files.put(`legacy-package/${sha}/manifest.json`,await readFile(join(root,'manifest.json')),{sha256:sha,customMetadata:metadata})
 for(const [kind,list] of [['chunk',manifest.chunks],['context',manifest.context],['object',manifest.objects]])for(const part of list){if(kind==='chunk'&&part.table==='ai_usages')continue;await files.put(`legacy-package/${sha}/${kind==='chunk'?'chunks':kind==='context'?'context':'objects'}/${part.file}`,await readFile(join(root,part.file)),{sha256:part.sha256,customMetadata:{...metadata,kind,file:part.file}})}
}
export async function workerRunnerJourney({packageRoot,interrupt=true,measure=true}={}){
 const runtime=await runnerRuntime(),scratch=await mkdtemp(join(tmpdir(),'legacy-runner-package-')),measurements={},facts={upload:'NOT EXERCISED',kills:0,stopFenced:false,revocationPaused:false};let fixtureData
 try{
  if(packageRoot){const manifestBytes=await readFile(join(packageRoot,'manifest.json')),manifest=JSON.parse(manifestBytes),projectId=manifest.source.projectId;const part=manifest.chunks.find(part=>part.table==='projects'),projects=part?JSON.parse(await readFile(join(packageRoot,part.file))):[];fixtureData={manifest,manifestSha256:hash(manifestBytes)};await runtime.seed(projectId,projects[0])}
  else {await runtime.seed();fixtureData=await fixture(scratch,'p-legacy-runner')}
  const {manifest,manifestSha256:sha}=fixtureData,project=manifest.source.projectId,token='synthetic-owner-session',base=`/api/move-in/projects/${project}/legacy-import/${sha}`,runId=`legacy-package:${sha}`
  await putPackage(runtime,packageRoot??scratch,manifest,sha,project)
  const count=async(sql,...args)=>(await runtime.db.prepare(sql).bind(...args).first()).n
  if(!packageRoot){
   await runtime.db.batch([runtime.db.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('synthetic-foreign','Foreign','synthetic-foreign-widget','https://foreign.example',1)"),runtime.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES('synthetic-foreign-article','synthetic-foreign','synthetic-foreign','Foreign',?,'','published',1)").bind(literal)])
   await runtime.db.prepare("INSERT INTO contact_erasures(project_id,contact_id,erased_by,erased_at,last_erased_at) VALUES(?,'synthetic-c-34','synthetic-owner',1,1)").bind(project).run()
  }
  assert.equal((await runtime.call(base+'/start',{token:'synthetic-operator-session',body:{approvedManifestSha256:sha}})).status,403)
  assert.equal((await runtime.call(base+'/start',{body:{approvedManifestSha256:sha}})).status,401)
  await runtime.call(base+'/start',{token,body:{approvedManifestSha256:sha+'0'},status:409})
  await runtime.call(base+'/start',{token,body:{approvedManifestSha256:sha},status:202})
  let queue=await runtime.take(),invocations=0
  const readRun=()=>runtime.db.prepare('SELECT * FROM legacy_import_worker_runs WHERE id=?').bind(runId).first()
  const runStep=async(headers)=>{
   assert.ok(queue.length,'durable continuation has a wake');const jobs=queue.splice(0,1),before=await readRun()
   const profiled=measure&&(!measurements[before.phase]||measurements[before.phase].invocations<2)?await runtime.profile(()=>runtime.step(jobs,headers)): {value:await runtime.step(jobs,headers)}
   queue.push(...profiled.value.queue);const after=await readRun();invocations++
   if(profiled.measurement){const m=profiled.measurement,prior=measurements[before.phase]??{invocations:0,maxCpuMs:0,maxHeapBytes:0,maxStatements:0,rows:0,bytes:0};prior.invocations++;prior.maxCpuMs=Math.max(prior.maxCpuMs,m.sampledCpuMs);prior.maxHeapBytes=Math.max(prior.maxHeapBytes,m.maxHeapBytes);prior.maxStatements=Math.max(prior.maxStatements,profiled.value.metrics.statements);const old=JSON.parse(before.metrics_json),next=JSON.parse(after.metrics_json);prior.rows=Math.max(prior.rows,(next.rows??0)-(old.rows??0));prior.bytes=Math.max(prior.bytes,(next.bytes??0)-(old.bytes??0));measurements[before.phase]=prior}
   assert.notEqual(after.state,'paused',JSON.stringify({phase:after.phase,cursor:JSON.parse(after.cursor_json),error:after.error_code,failures:profiled.value.failures}));return after
  }
  const until=async(check)=>{for(let n=0;n<15000;n++){const run=await readRun();if(await check(run))return run;await runStep()}throw new Error('Runner did not settle')}
  await until(run=>run.phase==='objects')
  if(interrupt&&manifest.objects.length){
   const pending=runtime.step(queue.splice(0,1),{'x-legacy-barrier':'after_copy'}).catch(()=>null)
   for(let n=0;n<100;n++){if((await runtime.call('/_test/legacy/barrier')).data.barrier==='after_copy')break;await new Promise(resolve=>setTimeout(resolve,20));if(n===99)throw new Error('Object copy barrier not reached')}
   assert.ok(await (await runtime.files).head(manifest.objects[0].key));assert.equal(await count('SELECT count(*) n FROM legacy_import_objects WHERE run_id=?',runId),0)
   await runtime.crash();await pending;facts.kills++;queue=[]
   // Real process death, same store. Expire only this run's DB-clock claims to
   // avoid a minute of idle sleep, then recover by the real scheduled dispatcher.
   await runtime.db.batch([runtime.db.prepare('UPDATE legacy_import_worker_runs SET lease_until=0,next_at=0 WHERE id=?').bind(runId),runtime.db.prepare('UPDATE legacy_delta_leases SET expires_at=0 WHERE project_id=?').bind(project)])
   await runtime.call('/_test/scheduled',{body:{},status:200});queue.push(...(await runtime.take()).filter(job=>job.type==='legacy-import.step'))
  }
  await until(run=>run.phase==='rows')
  if(interrupt){
   // Stop while a source batch is waiting immediately before its real commit.
   const pending=runtime.step(queue.splice(0,1),{'x-legacy-barrier':'before_canonical'}).catch(()=>null)
   for(let n=0;n<100;n++){if((await runtime.call('/_test/legacy/barrier')).data.barrier==='before_canonical')break;await new Promise(resolve=>setTimeout(resolve,20));if(n===99)throw new Error('Before-commit barrier not reached')}
   const before=await count('SELECT count(*) n FROM legacy_import_rows')
   await runtime.call(base+'/stop',{token,body:{},status:202});await runtime.call('/_test/legacy/barrier',{body:{}});await pending
   assert.equal(await count('SELECT count(*) n FROM legacy_import_rows'),before);facts.stopFenced=true
   await runtime.call(base+'/resume',{token,body:{approvedManifestSha256:sha},status:202});queue=await runtime.take()
   const committed=runtime.step(queue.splice(0,1),{'x-legacy-barrier':'after_canonical'}).catch(()=>null)
   for(let n=0;n<100;n++){if((await runtime.call('/_test/legacy/barrier')).data.barrier==='after_canonical')break;await new Promise(resolve=>setTimeout(resolve,20));if(n===99)throw new Error('After-commit barrier not reached')}
   assert.ok(await count('SELECT count(*) n FROM legacy_import_rows')>before)
   await runtime.crash();await committed;facts.kills++;queue=[]
   await runtime.db.batch([runtime.db.prepare('UPDATE legacy_import_worker_runs SET lease_until=0,next_at=0 WHERE id=?').bind(runId),runtime.db.prepare('UPDATE legacy_delta_leases SET expires_at=0 WHERE project_id=?').bind(project)])
   await runtime.call('/_test/scheduled',{body:{},status:200});queue.push(...(await runtime.take()).filter(job=>job.type==='legacy-import.step'))
   // A revoked authority pauses, then an existing admin explicitly takes over.
   await runtime.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),hash(token)).run()
   const paused=await runtime.step(queue.splice(0,1));assert.deepEqual(paused.retried,[]);assert.equal((await readRun()).error_code,'import_authority_revoked');facts.revocationPaused=true
   await runtime.call(base+'/resume',{token:'synthetic-admin-session',body:{approvedManifestSha256:sha},status:202});queue=await runtime.take()
  }
  await until(run=>run.state==='complete')
  const readerToken=interrupt?'synthetic-admin-session':token
  const first=(await runtime.call(base+'/result',{token:readerToken,status:200})).data.data
  assert.equal(first.verification,'verified');assert.equal(first.journalEqualsPackage,true);assert.equal(first.attachments.complete,true);assert.equal(first.work.unchanged,true);assert.equal(first.lease.runHeld,false);assert.equal(first.lease.workspaceHeld,false)
  assert.equal(await count('SELECT count(*) n FROM legacy_delta_leases WHERE project_id=?',project),0)
  assert.equal(await count('SELECT count(*) n FROM legacy_import_context WHERE run_id=?',runId),0)
  if(fixtureData.messageId){const transcript=(await runtime.call(`/api/conversations/${fixtureData.conversationId}/messages`,{token:readerToken,status:200})).data;const message=transcript.messages.find(row=>row.id===fixtureData.messageId);assert.equal(message.content,literal);facts.literalBytes=Buffer.byteLength(message.content);facts.renderedUnavailable=message.content.includes('[Knowledge unavailable]')}
  const journal=await runtime.db.prepare('SELECT run_id,source_table,source_id,row_digest,status FROM legacy_import_rows ORDER BY run_id,source_table,source_id').all()
  await runtime.call(base+'/start',{token:readerToken,body:{approvedManifestSha256:sha,replay:true},status:202});queue=await runtime.take();await until(run=>run.state==='complete')
  const replay=(await runtime.call(base+'/result',{token:readerToken,status:200})).data.data
  assert.equal(replay.attempt.appliedRows,0);assert.equal(replay.attempt.replayedRows,first.attempt.appliedRows);assert.equal(replay.journalEqualsPackage,true);assert.deepEqual((await runtime.db.prepare('SELECT run_id,source_table,source_id,row_digest,status FROM legacy_import_rows ORDER BY run_id,source_table,source_id').all()).results,journal.results)
  assert.equal(runtime.outbound.length,0)
  const report={...facts,rows:first.attempt.appliedRows,replayApplied:replay.attempt.appliedRows,objects:first.attachments,workUnchanged:first.work.unchanged,invocations,measurements,diagnostics:first.diagnostics}
  console.log('LEGACY_WORKER_RESULT '+JSON.stringify(report));return report
 }finally{await runtime.close();await rm(scratch,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await workerRunnerJourney({packageRoot:process.argv[2]})
