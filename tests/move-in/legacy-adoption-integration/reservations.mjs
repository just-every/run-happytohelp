import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {writeLegacyPackage} from '../../helpers/legacy-package.mjs'

/** Extend the mounted adoption journey: recovery uses ordinary upload, review,
 * approval, worker and discard doors. Only elapsed time is arranged in D1. */
export async function reservationRecovery({app,directory,setup,token,setupAdmin,foreign}){
 const inertTables=['credentials','sessions','local_grants','local_jobs'],inert=await Promise.all(inertTables.map(t=>app.sql(`SELECT * FROM ${t} ORDER BY rowid`)))
 const before=await app.sql('SELECT * FROM users ORDER BY id'),members=await app.sql('SELECT * FROM memberships ORDER BY project_id,user_id')
 const stage=async(source,revision)=>{
  const root=join(directory,revision),packet=await writeLegacyPackage(root,{format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision,exportedAt:'2026-11-12T00:00:00Z',projectId:source},tables:{projects:[{id:source,name:'Synthetic reservation recovery',website:'https://synthetic-recovery.example',created_at:1}]}})
  const sha=packet.manifestSha256,base=`/api/move-in/projects/${setup}/legacy-import/${sha}`,bytes=await readFile(join(root,'manifest.json'))
  await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':sha},status:201})
  const {missing}=(await app.call(base+'/status',{token,status:200})).data.data
  for(const part of missing)await app.call(base+'/files/'+part.file,{token,method:'PUT',raw:true,body:await readFile(join(root,part.file)),headers:{'Content-Type':'application/octet-stream'},status:201})
  return {sha,base,bytes,body:{approvedManifestSha256:sha,sourceProjectId:source,policyVersion:2}}
 }
 const approve=(p,options={})=>app.call(p.base+'/adoption/approve',{token,body:p.body,headers:{Origin:app.origin},...options})
 for(const mode of ['expired','discarded','failed']){
  const source='synthetic-reservation-'+mode,old=await stage(source,mode+'-original')
  await approve(old,{status:202})
  const fresh=await stage(source,mode+'-fresh')
  assert.equal((await app.call(fresh.base+'/adoption',{token,status:200})).data.data.canApprove,false)
  await approve(fresh,{status:409})
  if(mode==='expired')await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(old.sha).run()
  if(mode==='discarded')await app.call(old.base+'/discard',{token,body:{},status:202})
  if(mode==='failed'){
   // A native widget already owns the source-derived widget key. The export
   // itself uses only classified fields and must reach real preflight.
   const nativeWidget=await app.first('SELECT widget_key FROM projects WHERE id=?',foreign.projectId)
   await app.db.prepare('UPDATE projects SET widget_key=? WHERE id=?').bind(source,foreign.projectId).run()
   await app.call(old.base+'/start',{token,body:{approvedManifestSha256:old.sha},status:202})
   let paused
   for(let n=0;n<30;n++){
    paused=(await app.call(old.base+'/result',{token,status:200})).data.data
    if(paused.run.state==='paused')break
    await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'))
   }
   assert.equal(paused.run.state,'paused');assert.equal(paused.run.errorCode,'canonical_target_conflict')
   await app.db.prepare('UPDATE projects SET widget_key=? WHERE id=?').bind(nativeWidget.widget_key,foreign.projectId).run()
   assert.equal(await app.first('SELECT 1 FROM legacy_import_rows'),null,'preflight failure writes no journal')
  }
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null)
  assert.equal((await app.call(fresh.base+'/adoption',{token,status:200})).data.data.canApprove,true)
  await approve(fresh,{token:setupAdmin,status:403})
  await approve(fresh,{token:foreign.tokens.owner,status:403})
  await approve(fresh,{body:{...fresh.body,approvedManifestSha256:old.sha},status:409})
  // Two genuinely fresh exports contend for one released destination.
  const rival=await stage(source,mode+'-rival')
  const attempts=await Promise.all([approve(fresh),approve(rival)])
  assert.deepEqual(attempts.map(r=>r.status).sort(),[202,409],'exactly one fresh approval wins')
  const winner=attempts[0].status===202?fresh:rival,loser=winner===fresh?rival:fresh
  assert.equal((await app.call(loser.base+'/adoption',{token,status:200})).data.data.canApprove,false)
  await approve(loser,{status:409})
  assert.equal(await app.first('SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=?',old.sha),null)
  const closed=await app.first('SELECT status,generation,purge_reason FROM legacy_package_custody WHERE manifest_sha256=?',old.sha)
  assert.ok(['invalidated','purging','purged'].includes(closed.status));assert.ok(closed.generation>1)
  await approve(old,{status:409})
  await app.call(old.base+'/manifest',{token,method:'PUT',raw:true,body:old.bytes,headers:{'X-Manifest-SHA256':old.sha},status:409})
  if(mode==='failed')await app.call(old.base+'/resume',{token,body:{approvedManifestSha256:old.sha},status:409})
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null,'recovery approval creates no workspace')
  await app.call(winner.base+'/discard',{token,body:{},status:202})
 }
 // Even expired reservations cannot free a permanently erased source scope.
 const fencedSource='synthetic-reservation-erased',held=await stage(fencedSource,'erased-original');await approve(held,{status:202})
 await app.call(held.base+'/discard',{token,body:{},status:202})
 await app.db.prepare("INSERT INTO legacy_package_scope_fences(project_id,generation,reason,fenced_at) VALUES(?,1,'erasure',1)").bind(fencedSource).run()
 const next=await writeLegacyPackage(join(directory,'erased-fresh'),{format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'fresh',exportedAt:'2026-11-13T00:00:00Z',projectId:fencedSource},tables:{projects:[{id:fencedSource,name:'Synthetic fenced workspace',website:'https://synthetic.example',created_at:1}]}})
 await app.call(`/api/move-in/projects/${setup}/legacy-import/${next.manifestSha256}/manifest`,{token,method:'PUT',raw:true,body:await readFile(join(directory,'erased-fresh','manifest.json')),headers:{'X-Manifest-SHA256':next.manifestSha256},status:409})
 assert.ok(await app.first('SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=?',held.sha))
 assert.deepEqual(await app.sql('SELECT * FROM users ORDER BY id'),before)
 assert.deepEqual(await app.sql('SELECT * FROM memberships ORDER BY project_id,user_id'),members)
 for(const [i,table] of inertTables.entries())assert.deepEqual(await app.sql(`SELECT * FROM ${table} ORDER BY rowid`),inert[i],table+' unchanged by reservation recovery')
 console.log('RESERVATION_RECOVERY expired, discarded, failed: fresh approval wins once; stale SHA, actor, scope refusals; users/grants added=0')
 return {expired:true,discarded:true,failedBeforeCreation:true,concurrentWinners:1,nativeUsersAdded:0,membershipsAdded:0}
}

export async function createdReservationRefusal({app,directory,setup,token,source,originalSha}){
 const packet=await writeLegacyPackage(join(directory,'after-creation'),{format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'after-creation',exportedAt:'2026-11-13T00:00:00Z',projectId:source},tables:{projects:[{id:source,name:'Synthetic later export',website:'https://synthetic-later.example',created_at:1}]}})
 const sha=packet.manifestSha256,base=`/api/move-in/projects/${setup}/legacy-import/${sha}`
 await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:await readFile(join(directory,'after-creation','manifest.json')),headers:{'X-Manifest-SHA256':sha},status:201})
 const previous=await app.first('SELECT * FROM legacy_workspace_adoptions WHERE manifest_sha256=?',originalSha),custody=await app.first('SELECT expires_at FROM legacy_package_custody WHERE manifest_sha256=?',originalSha),settings=await app.first('SELECT settings_json FROM project_settings WHERE project_id=?',source)
 assert.equal(previous.state,'created')
 for(const deleted of [false,true]){
  if(deleted){await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.deleted_at',1) WHERE project_id=?").bind(source).run();await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(originalSha).run()}
  assert.equal((await app.call(base+'/adoption',{token,status:200})).data.data.canApprove,false)
  await app.call(base+'/adoption/approve',{token,body:{approvedManifestSha256:sha,sourceProjectId:source,policyVersion:2},headers:{Origin:app.origin},status:409})
  assert.deepEqual(await app.first('SELECT * FROM legacy_workspace_adoptions WHERE manifest_sha256=?',originalSha),previous,'created provenance survives expiry/deletion and cannot be stolen')
 }
 await app.db.prepare('UPDATE project_settings SET settings_json=? WHERE project_id=?').bind(settings.settings_json,source).run()
 await app.db.prepare('UPDATE legacy_package_custody SET expires_at=? WHERE manifest_sha256=?').bind(custody.expires_at,originalSha).run()
 await app.call(base+'/discard',{token,body:{},status:202})
}
