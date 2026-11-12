import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
/** Real D1/R2, generic B APIs mounted in a harness and the existing product contact erase door. */
export async function legacyCustodyJourney(){
 const app=await startApp({entry:'tests/helpers/legacy-custody/worker.ts',captureQueue:true,cf:false});let files=await app.files
 try{
  const w=await app.seedWorkspace('custody'),foreign=await app.seedWorkspace('foreign'),token=w.tokens.owner
  const path=`/_custody/projects/${w.projectId}`,erase=`/api/management/projects/${w.projectId}/contacts/ct/erase`
  await app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('ct',?,'Synthetic customer','synthetic-hh-1@example.test',1),('peer',?,'Peer','synthetic-hh-2@example.test',1)").bind(w.projectId,w.projectId).run()
  const json=value=>JSON.stringify(value),manifest=(source=w.projectId,extra={})=>json({source:{projectId:source},...extra})
  const upload=(body,options={})=>app.call(path+'/manifest',{method:'PUT',token,body,raw:true,...options,headers:{'x-manifest-sha256':sha(body),'Content-Type':'application/json',...options.headers}})
  const part=(id,body,options={})=>app.call(`${path}/${id}/chunk/rows-000001.json`,{method:'PUT',token,body,raw:true,...options,headers:{'x-sha256':sha(body),...(options.headers??{})}})
  const eraseContact=(headers={})=>app.call(erase,{token,body:{},headers})
  const barrier=async()=>{await app.until(async()=> (await app.call('/_custody/barrier')).data.reached,{message:'R2 boundary'});return (await app.call('/_custody/barrier')).data.reached}
  const release=()=>app.call('/_custody/barrier',{body:{}})
  const m=manifest(),id=sha(m),key=`legacy-package/${id}/chunks/rows-000001.json`
  assert.equal((await upload(m,{token:w.tokens.operator})).status,403)
  assert.equal((await upload(m,{token:foreign.tokens.owner})).status,403)
  assert.equal((await upload(m,{token:undefined})).status,401)
  assert.equal((await upload(m)).status,201)
  await app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('synthetic-peer-conversation',?,'peer',1,1)").bind(w.projectId).run()
  await files.put('legacy/projects/synthetic-peer/media/shared','peer canonical bytes')
  await app.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,created_at) VALUES('synthetic-peer-media',?,'synthetic-peer-conversation','peer','legacy/projects/synthetic-peer/media/shared','peer.txt','text/plain',20,1)").bind(w.projectId).run()
  assert.equal((await upload(m)).data.alreadyPresent,true)
  const metadata=await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',id)
  await app.call(`${path}/${id}`,{token,status:200})
  assert.deepEqual(await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',id),metadata,'polling never renews custody')
  assert.equal((await app.call(`${path}/${id}/chunk/private-person.json`,{token,method:'PUT',body:'[]',raw:true,headers:{'x-sha256':sha('[]')}})).status,422)
  assert.equal((await part(id,'[]',{headers:{'x-sha256':'0'.repeat(64)}})).status,422)
  const old=part(id,'[{"synthetic":"private history"}]',{headers:{'x-custody-barrier':'after_reserve'}})
  assert.equal(await barrier(),'after_reserve')
  const ready=()=>app.call(`${path}/${id}/ready/chunk/rows-000001.json`,{token,headers:{'x-sha256':sha('[{"synthetic":"private history"}]'),'x-bytes':String(Buffer.byteLength('[{"synthetic":"private history"}]'))}})
  assert.equal((await ready()).data.ready,false,'a nonce is never accepted source')
  // A fresh nonce takeover changes ETag; the old upload cannot share the new writer's reservation.
  assert.equal((await part(id,'[{"synthetic":"private history"}]')).status,409)
  assert.equal((await part(id,'[{"synthetic":"private history"}]',{headers:{'x-takeover':'1'}})).status,200)
  await release();assert.equal((await old).status,409)
  assert.equal(await (await files.get(key)).text(),'[{"synthetic":"private history"}]')
  assert.equal((await ready()).data.ready,true)
  for(const nativeToken of [undefined,token])assert.equal((await app.call(`/api/imported-files/${w.projectId}/${encodeURIComponent(key)}`,{token:nativeToken})).status,404,'a real retained staging body has no ordinary file entitlement')
  assert.equal((await part(id,'[{"synthetic":"private history"}]')).data.alreadyPresent,true)
  // All source families and parts metadata, including delta plans and identity ownership, are purged pagewise.
  await app.db.prepare("INSERT INTO legacy_import_worker_runs(id,manifest_sha256,project_id,source_project_id,actor_id,session_hash,mode,exclude_json,state,phase,created_at,updated_at,metrics_json) VALUES(?,?,?,?,?,'synthetic-session','full','[]','paused','context',1,1,?)").bind('legacy-package:'+id,id,w.projectId,w.projectId,w.users.owner,json({sourceError:'synthetic customer private text'})).run()
  const run='legacy-package:'+id
  for(let i=0;i<251;i++)await app.db.prepare("INSERT INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest) VALUES(?,'delta_plan','contacts',?,'{\"private\":\"synthetic\"}','synthetic-digest')").bind(run,'synthetic-'+i).run()
  await app.db.batch([
   app.db.prepare("INSERT INTO legacy_import_context_messages(run_id,id,conversation_id,row_json) VALUES(?,'synthetic-message','synthetic-conversation','{\"private\":true}')").bind(run),
   app.db.prepare("INSERT INTO legacy_import_context_media(run_id,media_id,link_id,mediable_type,mediable_id,object_key,legacy_key,row_json) VALUES(?,'synthetic-media','','message','synthetic-message','synthetic-key','synthetic-key','{}')").bind(run),
   app.db.prepare("INSERT INTO legacy_import_context_identities(run_id,project_id,identity,contact_id) VALUES(?,?,?,'ct')").bind(run,w.projectId,'synthetic-email'),
   app.db.prepare("INSERT INTO legacy_import_worker_parts(run_id,file,kind,sha256) VALUES(?,'rows-000001.json','chunk',?)").bind(run,sha('[]')),
  ])
  const bad=await eraseContact({'x-custody-fault':'delete'})
  assert.equal(bad.status,409);assert.equal(bad.data.code,'source_cleanup_pending');assert.equal(bad.headers.get('retry-after'),'1')
  assert.equal(await app.first('SELECT 1 FROM contact_erasures WHERE contact_id=\'ct\''),null)
  assert.ok(await app.first('SELECT 1 FROM contact_erasure_leases WHERE contact_id=\'ct\''))
  assert.equal((await upload(manifest(w.projectId,{fresh:true}))).status,409,'another SHA cannot stage after a fence')
  const pending=await app.call(`/api/management/projects/${w.projectId}/contacts/ct/erasure`,{token,status:200});assert.equal(pending.data.data.sourceCustody.cleanupPending,true)
  const failedPage=await eraseContact({'x-test-fault':'db-once','x-test-statement':'DELETE FROM legacy_import_context'});assert.equal(failedPage.status,409);assert.equal(failedPage.data.code,'source_cleanup_pending')
  assert.equal((await app.first('SELECT count(*) n FROM legacy_import_context WHERE run_id=?',run)).n,251,'failed D1 page never advances its cursor')
  const first=await eraseContact();assert.equal(first.status,409,'one quantum cannot erase 251+ scratch rows')
  assert.equal((await app.first('SELECT count(*) n FROM legacy_import_context WHERE run_id=?',run)).n,1)
  const second=await eraseContact();assert.equal(second.status,200,JSON.stringify(second.data))
  assert.equal((await app.first("SELECT name FROM contacts WHERE id='ct'")).name,null)
  assert.equal((await app.first("SELECT name FROM contacts WHERE id='peer'")).name,'Peer')
  assert.equal(await files.head(key),null);assert.equal(await files.head(`legacy-package/${id}/manifest.json`),null)
  for(const table of ['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities','legacy_import_worker_parts'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE run_id=?`,run)).n,0,table)
  const result=await app.first('SELECT status,purge_reason FROM legacy_package_custody WHERE manifest_sha256=?',id);assert.deepEqual(result,{status:'purged',purge_reason:'erasure'})
  assert.equal((await app.first('SELECT metrics_json FROM legacy_import_worker_runs WHERE id=?',run)).metrics_json,'{}')
  assert.equal((await upload(m)).status,409,'terminal SHA does not reopen')
  assert.equal(await (await files.get('legacy/projects/synthetic-peer/media/shared')).text(),'peer canonical bytes')
  // Both a source scope and an adopted destination close custody held in a different setup workspace.
  for(const scopeKind of ['source','destination']){
   const setup=await app.seedWorkspace('setup-'+scopeKind),target=await app.seedWorkspace('target-'+scopeKind)
   await app.db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,'Synthetic',1)").bind('ct-'+scopeKind,target.projectId).run()
   const raw=manifest(scopeKind==='source'?target.projectId:setup.projectId,scopeKind==='destination'?{destinationProjectId:target.projectId}:{}),shaId=sha(raw)
   const staged=await app.call(`/_custody/projects/${setup.projectId}/manifest`,{token:setup.tokens.owner,method:'PUT',body:raw,raw:true,headers:{'x-manifest-sha256':shaId}})
   assert.equal(staged.status,201)
   assert.equal((await app.call(`/api/management/projects/${target.projectId}/contacts/ct-${scopeKind}/erase`,{token:target.tokens.owner,body:{}})).status,200)
   assert.equal(await files.head(`legacy-package/${shaId}/manifest.json`),null,scopeKind+' index discovers custody')
  }
  const expiredScope=await app.seedWorkspace('expired-lease'),clean=await app.seedWorkspace('lifecycle')
  await app.db.prepare("INSERT INTO contact_erasure_leases(project_id,contact_id,token,expires_at) VALUES(?,'synthetic-erased','synthetic-old-lease',0)").bind(expiredScope.projectId).run()
  const forbidden=manifest(expiredScope.projectId),forbiddenId=sha(forbidden)
  assert.equal((await app.call(`/_custody/projects/${clean.projectId}/manifest`,{token:clean.tokens.owner,method:'PUT',body:forbidden,raw:true,headers:{'x-manifest-sha256':forbiddenId}})).status,409,'even an expired unfinished erasure blocks a fresh SHA')
  assert.equal(await files.head(`legacy-package/${forbiddenId}/manifest.json`),null)
  const raw=manifest(clean.projectId),ttlId=sha(raw),ttlPath=`/_custody/projects/${clean.projectId}/${ttlId}`
  assert.equal((await app.call(`/_custody/projects/${clean.projectId}/manifest`,{token:clean.tokens.owner,method:'PUT',body:raw,raw:true,headers:{'x-manifest-sha256':ttlId}})).status,201)
  const initial=await app.first('SELECT created_at,expires_at,absolute_expires_at FROM legacy_package_custody WHERE manifest_sha256=?',ttlId)
  assert.ok(initial.expires_at>initial.created_at&&initial.absolute_expires_at>initial.expires_at)
  await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'stopped'},status:200})
  await app.db.prepare('UPDATE legacy_package_custody SET expires_at=? WHERE manifest_sha256=?').bind(Date.now()+60000,ttlId).run()
  const stopped=await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',ttlId)
  await app.call(ttlPath,{token:clean.tokens.owner,status:200})
  await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'stopped'},status:200})
  await app.call(`/_custody/projects/${clean.projectId}/manifest`,{token:clean.tokens.owner,method:'PUT',body:raw,raw:true,headers:{'x-manifest-sha256':ttlId},status:201})
  assert.deepEqual(await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',ttlId),stopped)
  await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'resume'},status:200})
  await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'complete'},status:200})
  await app.db.prepare('UPDATE legacy_package_custody SET expires_at=? WHERE manifest_sha256=?').bind(Date.now()+60000,ttlId).run()
  const completed=await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',ttlId)
  await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'complete'},status:200})
  await app.call(`/_custody/projects/${clean.projectId}/manifest`,{token:clean.tokens.owner,method:'PUT',body:raw,raw:true,headers:{'x-manifest-sha256':ttlId},status:201})
  assert.deepEqual(await app.first('SELECT expires_at,last_explicit_activity_at FROM legacy_package_custody WHERE manifest_sha256=?',ttlId),completed,'repeated PUT/complete never extend the final replay window')
  await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(ttlId).run()
  assert.equal((await app.call(ttlPath+'/lifecycle',{token:clean.tokens.owner,body:{state:'resume'}})).status,409)
  // Failed/lost sends retain due state, and a replacement Worker resumes cleanup without a user session.
  let jobs=[]
  for(let attempt=0;attempt<8&&!jobs.some(job=>job.id===ttlId);attempt++)jobs.push(...(await app.call('/_custody/discover',{body:{},status:200})).data.queue)
  const wake=jobs.find(job=>job.id===ttlId);assert.ok(wake)
  await app.configure({H2H_TEST_CAPTURE_QUEUE:'1'});files=await app.files
  const cleaned=await app.call('/_custody/cleanup',{body:{sha:wake.id,generation:wake.generation},status:200});assert.equal(cleaned.data.pending,false)
  const duplicate=await app.call('/_custody/cleanup',{body:{sha:wake.id,generation:wake.generation},status:200});assert.equal(duplicate.data.pending,false)
  assert.equal(await files.head(`legacy-package/${ttlId}/manifest.json`),null)
  assert.equal((await app.first('SELECT purge_reason FROM legacy_package_custody WHERE manifest_sha256=?',ttlId)).purge_reason,'expired')
  // A deleted workspace still closes its source and schedules cleanup before any native activity guard.
  const deleted=await app.seedWorkspace('deleted'),deletedBody=manifest(deleted.projectId),deletedId=sha(deletedBody)
  await app.call(`/_custody/projects/${deleted.projectId}/manifest`,{token:deleted.tokens.owner,method:'PUT',body:deletedBody,raw:true,headers:{'x-manifest-sha256':deletedId},status:201})
  assert.equal((await app.call(`/api/management/projects/${deleted.projectId}`,{token:deleted.tokens.owner,method:'DELETE'})).status,200)
  const tombstone=await app.first('SELECT generation,status FROM legacy_package_custody WHERE manifest_sha256=?',deletedId);assert.equal(tombstone.status,'invalidated')
  await app.call('/_custody/cleanup',{body:{sha:deletedId,generation:tombstone.generation},status:200})
  assert.equal(await (await app.files).head(`legacy-package/${deletedId}/manifest.json`),null)
  // No staging entitlement exists on ordinary media/file routes.
  assert.equal((await app.call(`/api/imported-files/${w.projectId}/${encodeURIComponent(key)}`,{token})).status,404)
  assert.equal((await app.call(`/api/imported-files/${w.projectId}/${encodeURIComponent(key)}`)).status,404)
 }finally{await app.close()}
}

/** Upload/erasure ordering with storage barriers; no mocked R2 success. */
export async function legacyCustodyOverlapJourney(){
 const app=await startApp({entry:'tests/helpers/legacy-custody/worker.ts',captureQueue:true,cf:false});let files=await app.files
 try{
  for(const point of ['before_reserve','after_reserve','before_body','after_body']){
   const w=await app.seedWorkspace('overlap-'+point),token=w.tokens.owner,path=`/_custody/projects/${w.projectId}`
   await app.db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,'Synthetic',1)").bind('ct-'+point,w.projectId).run()
   const body=JSON.stringify({source:{projectId:w.projectId}}),id=sha(body)
   const pending=app.call(path+'/manifest',{token,method:'PUT',body,raw:true,headers:{'x-manifest-sha256':id,'x-custody-barrier':point}})
   await app.until(async()=> (await app.call('/_custody/barrier')).data.reached===point,{message:point})
   assert.equal((await app.call(`/api/management/projects/${w.projectId}/contacts/ct-${point}/erase`,{token,body:{}})).status,200)
   await app.call('/_custody/barrier',{body:{}})
   assert.equal((await pending).status,409)
   const key=`legacy-package/${id}/manifest.json`,held=await files.get(key)
   if(held){assert.equal(held.customMetadata.custodyBody,'reservation');assert.notEqual(await held.text(),body)}
   const record=await app.first('SELECT generation FROM legacy_package_custody WHERE manifest_sha256=?',id)
   await app.call('/_custody/cleanup',{body:{sha:id,generation:record.generation},status:200})
   assert.equal(await files.head(key),null,'late nonce swept without accepting source')
  }
  const w=await app.seedWorkspace('bounded-keys'),token=w.tokens.owner,body=JSON.stringify({source:{projectId:w.projectId}}),id=sha(body),base=`/_custody/projects/${w.projectId}`
  await app.db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES('ct-bounded',?,'Synthetic',1)").bind(w.projectId).run()
  await app.call(base+'/manifest',{token,method:'PUT',body,raw:true,headers:{'x-manifest-sha256':id},status:201})
  for(let ordinal=0;ordinal<101;ordinal++)await app.call(`${base}/${id}/chunk/rows-${String(ordinal).padStart(6,'0')}.json`,{token,method:'PUT',body:'[]',raw:true,headers:{'x-sha256':sha('[]')},status:200})
  const erasePath=`/api/management/projects/${w.projectId}/contacts/ct-bounded/erase`
  assert.equal((await app.call(erasePath,{token,body:{}})).status,409)
  assert.equal((await files.list({prefix:`legacy-package/${id}/`})).objects.length,2,'one erasure step deleted only 100 of 102 source keys')
  assert.equal((await app.call(erasePath,{token,body:{}})).status,200)
  assert.equal((await files.list({prefix:`legacy-package/${id}/`})).objects.length,0)
 }finally{await app.close()}
}
