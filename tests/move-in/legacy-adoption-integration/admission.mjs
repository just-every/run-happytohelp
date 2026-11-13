import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request as httpRequest} from 'node:http'
import {startApp} from '../../journeys/kit/app.mjs'
import {packageFixture,sha} from './fixture.mjs'
import {streamedManifestStatus} from './streamed-manifest.mjs'
export async function legacyPackageAdmission(){
 const app=await startApp({captureQueue:true,cf:false,listen:true}),directory=await mkdtemp(join(tmpdir(),'legacy-intake-'))
 try{
  const owner=await app.seedWorkspace('legacy-intake'),foreign=await app.seedWorkspace('legacy-foreign'),p=await packageFixture(join(directory,'good'),owner.projectId)
  const base=(digest=p.manifestSha256,project=owner.projectId)=>`/api/move-in/projects/${project}/legacy-import/${digest}`
  const putManifest=async(bytes=p.bytes,{digest=sha(bytes),token=owner.tokens.owner,project=owner.projectId,headers={}}={})=>app.call(`${base(digest,project)}/manifest`,{method:'PUT',raw:true,body:bytes,token,headers:{'Content-Type':'application/json','X-Manifest-SHA256':digest,...headers}})
  const file=async(part,bytes,{token=owner.tokens.owner,query='',name=part.file,digest=p.manifestSha256}={})=>app.call(`${base(digest)}/files/${name}${query}`,{method:'PUT',raw:true,body:bytes,token,headers:{'Content-Type':'application/octet-stream'}})
  const counts=async()=>{const tables=['projects','users','memberships','contacts','conversations','messages','legacy_import_runs','legacy_import_rows','legacy_import_objects','legacy_import_state','legacy_import_holds','legacy_delta_leases','move_in_runs','conversation_outbox','email_deliveries','operator_notifications','native_integration_events','context_jobs','leads','workflow_events'];return Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await app.first(`SELECT count(*) n FROM ${t}`)).n])))}
  const before=await counts()
  assert.equal((await putManifest(p.bytes,{token:null})).status,401)
  assert.equal((await putManifest(p.bytes,{token:owner.tokens.operator})).status,403)
  assert.equal((await putManifest(p.bytes,{token:foreign.tokens.owner})).status,404)
  assert.equal((await putManifest(p.bytes,{headers:{'Origin':'https://foreign.example','Authorization':'',Cookie:'h2h_session='+owner.tokens.owner}})).status,403)
  assert.equal((await putManifest(p.bytes,{digest:'0'.repeat(64)})).data.code,'digest_mismatch')
  assert.equal((await putManifest(Buffer.concat([p.bytes,Buffer.from(' ')]),{digest:p.manifestSha256})).data.code,'digest_mismatch')
  for(const mutation of [m=>m.chunks[0].file='../unsafe.json',m=>m.chunks[0].file='manifest.json',m=>m.chunks[0].bytes=4194305,m=>m.objects[0].size=16777217,m=>m.chunks=Array(20001).fill(null),m=>m.source.rowCounts.contacts++,m=>m.objects[0].key='legacy/../outside',m=>m.source.attachments.push(m.source.attachments[0])]){
   const m=structuredClone(p.manifest);mutation(m);assert.equal((await putManifest(Buffer.from(JSON.stringify(m)))).status,400)
  }
  assert.equal((await putManifest(Buffer.alloc(2097153,32))).status,413)
  assert.equal(await streamedManifestStatus(app.url+`${base()}/manifest`,{Authorization:'Bearer '+owner.tokens.owner,'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256}),413)

  assert.equal((await putManifest(p.bytes,{headers:{'X-Legacy-Contract-Version':'3'}})).status,422)
  assert.equal((await putManifest()).status,201)
  assert.equal((await putManifest(p.bytes,{token:owner.tokens.admin})).data.data.alreadyPresent,true)
  assert.equal((await putManifest(p.bytes,{project:foreign.projectId,token:foreign.tokens.owner})).status,404)
  const stored=await (await app.files).get(`legacy-package/${p.manifestSha256}/manifest.json`);assert.deepEqual(Buffer.from(await stored.arrayBuffer()),p.bytes)
  const status=async(query='')=>(await app.ok(`${base()}/status${query}`,{token:owner.tokens.owner})).data
  let scan=await status('?limit=1');assert.equal(scan.page.checkedFiles,1);assert.ok(scan.nextCursor);assert.equal(scan.excluded.ai_usages,1)
  assert.equal((await app.call(`${base()}/status?excludeTables=&cursor=${encodeURIComponent(scan.nextCursor)}`,{token:owner.tokens.owner})).status,400)
  let missing=[],pages=0;do{missing.push(...scan.missing);pages++;scan=scan.nextCursor?await status('?limit=1&cursor='+encodeURIComponent(scan.nextCursor)):null}while(scan);assert.ok(pages>1)
  assert.equal(missing.some(part=>part.file===p.manifest.chunks.find(chunk=>chunk.table==='ai_usages').file),false)
  const first=p.manifest.chunks[0],firstBytes=await readFile(join(p.root,first.file))
  assert.equal((await file(first,firstBytes.subarray(1))).data.code,'size_mismatch')
  assert.equal((await file(first,Buffer.alloc(firstBytes.length,32))).data.code,'digest_mismatch')
  assert.equal((await file(first,firstBytes,{name:'unlisted.json'})).status,400)
  assert.equal((await file(first,firstBytes,{name:'unsafe%2Ffile.json'})).status,400)
  // Real TCP disconnect after a partial body: never publish accepted R2 bytes.
  await new Promise(resolve=>{
   const req=httpRequest(app.url+base()+`/files/${first.file}`,{method:'PUT',headers:{Authorization:'Bearer '+owner.tokens.owner,'Content-Type':'application/octet-stream','Content-Length':firstBytes.length}},res=>{res.resume();res.on('end',resolve)})
   req.on('error',()=>resolve());req.on('close',resolve)
   req.write(firstBytes.subarray(0,Math.max(1,firstBytes.length>>1)),()=>setTimeout(()=>req.destroy(),25))
  })
  assert.equal((await status()).missing.some(p=>p.file===first.file),true)
  assert.equal((await file(first,firstBytes)).status,201);assert.equal((await file(first,firstBytes,{token:owner.tokens.admin})).data.data.alreadyPresent,true)
  assert.equal((await file(first,Buffer.alloc(firstBytes.length,32))).data.code,'digest_mismatch')
  // Multi-file interruption: status after a persistent runtime restart skips the accepted file.
  await app.configure({});assert.equal((await status()).missing.some(p=>p.file===first.file),false)
  for(const part of (await status()).missing)assert.equal((await file(part,await readFile(join(p.root,part.file)))).status,201)
  assert.equal((await status()).missing.length,0)
  const usage=p.manifest.chunks.find(p=>p.table==='ai_usages'),usageBytes=await readFile(join(p.root,usage.file));assert.equal((await file(usage,usageBytes)).data.code,'excluded_file');assert.equal((await status('?excludeTables=')).missing.length,1);assert.equal((await file(usage,usageBytes,{query:'?excludeTables='})).status,201)
  const bad=await packageFixture(join(directory,'secret'),owner.projectId,{secret:true});assert.equal((await putManifest(bad.bytes)).status,201);const secretPart=bad.manifest.chunks.find(p=>p.table==='messages');assert.equal((await file(secretPart,await readFile(join(bad.root,secretPart.file)),{digest:bad.manifestSha256})).data.code,'source_policy_refused')
  const malformed=await packageFixture(join(directory,'invalid-public-key'),owner.projectId,{invalidKey:true});assert.equal((await putManifest(malformed.bytes)).status,201);const invalidPart=malformed.manifest.chunks.find(p=>p.table==='messages');assert.equal((await file(invalidPart,await readFile(join(malformed.root,invalidPart.file)),{digest:malformed.manifestSha256})).data.code,'source_policy_refused')
  // A custom admin with data.import removed cannot read or mutate this package.
  const now=Date.now();await app.db.prepare("INSERT INTO project_roles(id,project_id,name,base,permissions_json,created_at,updated_at) VALUES('synthetic-import-restricted',?,'Synthetic restricted admin','admin','[]',?,?)").bind(owner.projectId,now,now).run();await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'synthetic-import-restricted',?)").bind(owner.projectId,owner.users.admin,now).run()
  assert.equal((await app.call(`${base()}/status`,{token:owner.tokens.admin})).status,403);assert.equal((await file(first,firstBytes,{token:owner.tokens.admin})).status,403)
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(owner.projectId,owner.users.admin).run()
  const rowManifest=structuredClone(p.manifest),rowBytes=Buffer.from('[]');rowManifest.chunks[0]={...first,bytes:rowBytes.length,sha256:sha(rowBytes)};const rowDigest=sha(JSON.stringify(rowManifest));assert.equal((await putManifest(Buffer.from(JSON.stringify(rowManifest)))).status,201);assert.equal((await file(first,rowBytes,{digest:rowDigest})).data.code,'row_count_mismatch')
  assert.deepEqual(await counts(),before);assert.deepEqual(await app.takeJobs(),[])
  // Successful message intake above exercised the exact Node classifier's public
  // DKIM createPublicKey/Buffer branch in workerd, alongside credential refusal.
 }finally{await app.close();await rm(directory,{recursive:true,force:true})}
}
