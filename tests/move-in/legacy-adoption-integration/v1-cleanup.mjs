import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {runnerRuntime} from './runtime.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
/** Existing erasure registration: old v1 bytes are fixtures at the storage edge,
 * all closure, paging, restart, queue and final erasure use mounted product doors. */
export async function legacyV1CleanupJourney({coordinates=506}={}){
 const app=await runnerRuntime(),facts={coordinates,restarts:0,duplicateWakes:0,lostWakes:0,maxKeys:0}
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-wire-setup',email:'synthetic-wire@example.test',password:'Synthetic wire password 42!',allowedOrigin:app.origin},status:201})).data
  const project=owner.projectId,token=owner.token,parts=Math.min(9000,Math.floor(coordinates*0.6)),extra=coordinates-parts-1
  const chunks=Array.from({length:parts},(_,i)=>({table:'contacts',count:0,file:`old-${i}.json`,bytes:2,sha256:hash('[]')}))
  const manifest={format:'happytohelp-legacy-chunks-v1',source:{repository:'synthetic',revision:'synthetic-v1',exportedAt:'2026-01-01T00:00:00Z',projectId:project,rowCounts:{contacts:0},attachments:[]},chunks,context:[],objects:[],attachmentsComplete:true},bytes=Buffer.from(JSON.stringify(manifest)),sha=hash(bytes),prefix=`legacy-package/${sha}/`,files=await app.files
  assert.ok(bytes.length<=2097152)
  await files.put(prefix+'manifest.json',bytes,{sha256:sha,customMetadata:{contractVersion:'1',projectId:project,manifestSha256:sha}})
  // Known prefix listing must find extras as well as absent descriptor keys.
  for(let i=0;i<extra;i++)await files.put(prefix+`objects/orphan-${String(i).padStart(6,'0')}.bin`,'Synthetic old bytes')
  await app.db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES('synthetic-v1-contact',?,'Synthetic',1)").bind(project).run()
  const base=`/api/move-in/projects/${project}/legacy-import/${sha}`,erase=`/api/management/projects/${project}/contacts/synthetic-v1-contact/erase`
  // Begin through native contact erasure: inventory cannot overlook pre-start v1.
  const first=await app.call(erase,{token,body:{},status:409});assert.equal(first.data.code,'source_cleanup_pending')
  let state=await app.first('SELECT * FROM legacy_package_custody WHERE manifest_sha256=?',sha)
  assert.equal(state.cleanup_only,1);assert.equal(state.seeding_complete,0);assert.notEqual(state.status,'purged')
  assert.equal(await app.first("SELECT 1 FROM contact_erasures WHERE project_id=?",project),null)
  assert.ok(await files.head(prefix+'manifest.json'),'manifest retained while later pages still need descriptors')
  assert.equal((await app.call(base+'/start',{token,body:{approvedManifestSha256:sha}})).status,409)
  // Actual process replacement between seed pages, preserving D1/R2.
  await app.crash();facts.restarts++
  const profiled=await app.profile(()=>app.call(base+'/cleanup-v1',{token,body:{},status:202}));facts.seedMeasurement=profiled.measurement;const cleanup=profiled.value;assert.equal(cleanup.data.data.cleanupOnly,true)
  const wake={type:'legacy-package.cleanup',id:sha,generation:state.generation}
  await app.runJobs([wake,wake]);facts.duplicateWakes++
  await app.takeJobs();facts.lostWakes++
  await app.db.prepare('UPDATE legacy_package_custody SET next_cleanup_at=0 WHERE manifest_sha256=?').bind(sha).run()
  await app.scheduled();assert.ok((await app.takeJobs()).some(j=>j.type==='legacy-package.cleanup'),'cron recovers a lost seed wake')
  let pages=0,sawSeedComplete=false
  for(;pages<1000;pages++){
   state=await app.first('SELECT * FROM legacy_package_custody WHERE manifest_sha256=?',sha)
   if(state.status==='purged')break
   if(!state.seeding_complete){assert.ok(await (await app.files).head(prefix+'manifest.json'));assert.equal(await app.first('SELECT 1 FROM contact_erasures WHERE project_id=?',project),null)}else {sawSeedComplete=true;if(!facts.registeredCoordinates)facts.registeredCoordinates=(await app.first('SELECT count(*) n FROM legacy_package_keys WHERE manifest_sha256=?',sha)).n}
   const before=(await app.first('SELECT count(*) n FROM legacy_package_keys WHERE manifest_sha256=?',sha)).n
   await app.runJobs([wake])
   const after=(await app.first('SELECT count(*) n FROM legacy_package_keys WHERE manifest_sha256=?',sha)).n
   assert.ok(after-before<=100,'each seed page registers at most 100 exact coordinates')
   facts.maxKeys=Math.max(facts.maxKeys,after-before)
  }
  assert.equal(state.status,'purged');assert.ok(sawSeedComplete);assert.equal(state.seeding_complete,1)
  assert.equal((await app.first('SELECT count(*) n FROM legacy_package_keys WHERE manifest_sha256=?',sha)).n,0,'old filenames are not retained after cleanup-only purge')
  assert.equal(facts.registeredCoordinates,coordinates)
  assert.equal((await (await app.files).list({prefix})).objects.length,0)
  await app.call(erase,{token,body:{},status:200})
  assert.ok(await app.first('SELECT 1 FROM contact_erasures WHERE project_id=?',project))
  const invalid=(await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':sha}})).status
  assert.notEqual(invalid,201);assert.notEqual(invalid,200)
  assert.equal(await app.first('SELECT 1 FROM legacy_import_worker_runs WHERE manifest_sha256=?',sha),null,'cleanup-only never imports old bytes')
  assert.equal((await app.first('SELECT count(*) n FROM users')).n,1,'no legacy account backfill')
  // A pre-existing synthetic v1 result must never acquire historical-v2 claims.
  const priorManifest={...manifest,chunks:[],source:{...manifest.source,revision:'synthetic-v1-completed',rowCounts:{}}},priorBytes=Buffer.from(JSON.stringify(priorManifest)),priorSha=hash(priorBytes),priorBase=base.replace(sha,priorSha)
  await (await app.files).put(`legacy-package/${priorSha}/manifest.json`,priorBytes,{sha256:priorSha,customMetadata:{contractVersion:'1',projectId:project,manifestSha256:priorSha}})
  await app.db.prepare("INSERT INTO legacy_import_worker_runs(id,contract_version,manifest_sha256,project_id,source_project_id,actor_id,session_hash,mode,exclude_json,state,phase,created_at,updated_at,verified_at) VALUES(?,1,?,?,?,?,?,'full','[]','complete','done',1,1,1)").bind(`legacy-package:${priorSha}`,priorSha,project,project,owner.userId,hash(token)).run()
  const pending=await app.call(erase,{token,body:{},status:409});assert.equal(pending.data.code,'source_cleanup_pending')
  const priorWake={type:'legacy-package.cleanup',id:priorSha,generation:1}
  for(let n=0;n<8;n++){if((await app.first('SELECT status FROM legacy_package_custody WHERE manifest_sha256=?',priorSha)).status==='purged')break;await app.runJobs([priorWake])}
  const prior=(await app.call(priorBase+'/result',{token,status:200})).data.data
  assert.equal(prior.syntheticOnly,true);assert.equal(prior.cleanupOnly,true);assert.equal(prior.adoption,undefined);assert.equal(prior.run.contractVersion,1);assert.equal(prior.sourceCustody.sourcePurged,true)
  await app.call(erase,{token,body:{},status:200})
  assert.equal((await app.call(priorBase+'/resume',{token,body:{approvedManifestSha256:priorSha}})).data.code,'source_invalidated')
  Object.assign(facts,{pages,seedComplete:true,purged:true,erasureCompleted:true,noAdoption:true,manifestBytes:bytes.length,v1ResultRemainsSynthetic:true})
  if(process.env.H2H_EVIDENCE_DIR){await mkdir(process.env.H2H_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.H2H_EVIDENCE_DIR,`v1-cleanup-${coordinates}.json`),JSON.stringify(facts,null,2)+'\n')}
  return facts
 }finally{await app.close()}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await legacyV1CleanupJourney({coordinates:Number(process.argv[2]||506)})))
