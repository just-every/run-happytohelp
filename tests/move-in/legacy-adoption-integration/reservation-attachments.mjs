import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runnerRuntime} from './runtime.mjs'
import {packageFixture} from './fixture.mjs'

/** The same recovery door, with real copies before workspace creation. Each
 * installation is isolated so sign-out cannot revoke the parent journey. */
async function reservationAttachment(mode,order){
  const app=await runnerRuntime(),directory=await mkdtemp(join(tmpdir(),'legacy-reservation-'))
  try{
   const login={email:'synthetic-wire@example.test',password:'Synthetic wire password 42!'}
   const owner=(await app.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-wire-setup',...login,name:'Synthetic recovery owner',allowedOrigin:app.origin},status:201})).data
   const setup=owner.projectId,source='synthetic-attachment-recovery';let token=owner.token
   const stage=async revision=>{
    const packet=await packageFixture(join(directory,revision),source),sha=packet.manifestSha256,base=`/api/move-in/projects/${setup}/legacy-import/${sha}`
    await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:packet.bytes,headers:{'X-Manifest-SHA256':sha},status:201})
    const {missing}=(await app.call(base+'/status',{token,status:200})).data.data
    for(const part of missing)await app.call(base+'/files/'+part.file,{token,method:'PUT',raw:true,body:await readFile(join(packet.root,part.file)),headers:{'Content-Type':'application/octet-stream'},status:201})
    return {...packet,sha,base,body:{approvedManifestSha256:sha,sourceProjectId:source,policyVersion:2}}
   }
   const approve=p=>app.call(p.base+'/adoption/approve',{token,body:p.body,headers:{Origin:app.origin},status:202})
   const pending=[]
   const take=async()=>[...pending.splice(0),...await app.takeJobs()]
   const result=async p=>(await app.call(p.base+'/result',{token,status:200})).data.data
   const advance=async(p,done)=>{
    for(let n=0;n<250;n++){
     const r=await result(p);if(await done(r))return r
     assert.ok(['queued','running'].includes(r.run.state),JSON.stringify(r.run))
     await app.runJobs((await take()).filter(j=>j.type==='legacy-import.step'))
    }
    assert.fail(`${mode}/${order}: recovery worker did not reach its end state: ${JSON.stringify((await result(p)).run)}`)
   }
   const cron=async sha=>{
    await app.db.prepare('UPDATE legacy_package_custody SET next_cleanup_at=0 WHERE manifest_sha256=?').bind(sha).run()
    await app.scheduled();const jobs=await take();pending.push(...jobs.filter(j=>j.type!=='legacy-package.cleanup'));await app.runJobs(jobs.filter(j=>j.type==='legacy-package.cleanup'))
   }
   const drain=async sha=>{
    for(let n=0;n<12;n++){
     await cron(sha)
     if((await app.first('SELECT status FROM legacy_package_custody WHERE manifest_sha256=?',sha)).status==='purged')return
    }
    assert.fail('Old package cleanup did not finish')
   }
   const old=await stage('original');await approve(old)
   await app.call(old.base+'/start',{token,body:{approvedManifestSha256:old.sha},status:202})
   await advance(old,async r=>mode==='signout'?r.run.phase==='objects'&&Number(JSON.parse((await app.first('SELECT cursor_json FROM legacy_import_worker_runs WHERE manifest_sha256=?',old.sha)).cursor_json).ordinal??0)>0:r.run.phase==='rows')
   assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null)
   const files=await app.files,keys=old.manifest.objects.map(o=>o.key)
   assert.ok(await files.head(keys[0]),'the released run really copied attachment bytes')
   if(mode==='signout'){
    await app.call('/auth/signout',{token,method:'POST',headers:{Origin:app.origin}})
    token=(await app.call('/api/identity/login',{body:login,status:200})).data.token
    await app.runJobs((await take()).filter(j=>j.type==='legacy-import.step'))
    const paused=await result(old);assert.equal(paused.run.state,'paused');assert.equal(paused.run.errorCode,'import_authority_revoked')
   }else{
    await app.call(old.base+'/stop',{token,body:{},status:202})
    await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(old.sha).run()
   }
   if(mode==='orphan'){
    // Hold an actual R2 deletion in flight. Approval cannot hand its keys to
    // a new package until the cleanup quantum has finished deleting them.
    const contender=await stage('contender')
    await app.scheduled()
    const pending=app.runJobs((await take()).filter(j=>j.type==='legacy-package.cleanup'),{'x-legacy-barrier':'before_cleanup_delete'})
    try{
     await app.until(async()=>(await app.call('/_test/legacy/barrier')).data.barrier==='before_cleanup_delete',{message:'old canonical deletion in flight'})
     await app.call(contender.base+'/adoption/approve',{token,body:contender.body,headers:{Origin:app.origin},status:409})
     assert.ok(await app.first('SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=?',old.sha),'in-flight cleanup prevents ownership transfer')
    }finally{await app.call('/_test/legacy/barrier',{body:{}});await pending}
   }
   if(order==='before'&&mode!=='signout')await drain(old.sha)
   if(mode==='orphan'){
    for(const key of keys)assert.equal(await files.head(key),null,'an unheld canonical copy is cleaned')
    return {mode,cleaned:keys.length}
   }
   let fresh=await stage('fresh');await approve(fresh)
   const released=[old.sha]
   if(mode==='signout'&&order==='after'){
    // A replacement can itself be released before it ever starts copying.
    // Its inherited deletion coordinates still transfer to the next owner.
    await app.call(fresh.base+'/discard',{token,body:{},status:202});released.push(fresh.sha)
    fresh=await stage('second-replacement');await approve(fresh)
   }
   const transferred=await app.sql("SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND key IN (SELECT value FROM json_each(?))",fresh.sha,JSON.stringify(keys))
   assert.ok(transferred.length>0,'replacement owns the released canonical cleanup coordinates')
   assert.equal((await app.sql('SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND key IN (SELECT value FROM json_each(?))',old.sha,JSON.stringify(keys))).length,0)
   if(order==='before')await drain(old.sha)
   await app.call(fresh.base+'/start',{token,body:{approvedManifestSha256:fresh.sha},status:202})
   await advance(fresh,r=>r.run.phase==='rows')
   await cron(old.sha) // Old cleanup also cannot delete copies held by a live run.
   const complete=await advance(fresh,r=>r.run.state==='complete')
   assert.equal(complete.verification,'verified');assert.equal(complete.journalEqualsPackage,true)
   assert.equal(complete.attachments.complete,true);assert.equal(complete.attachments.identical,keys.length)
   const adopted=(await app.call('/api/identity/switch-project',{token,body:{projectId:source},status:200})).data.token
   const media=await app.sql('SELECT id,conversation_id,object_key FROM media WHERE project_id=? ORDER BY id',source)
   const bytes=async()=>{
    for(const m of media){
     const response=await app.request(`/api/conversations/${m.conversation_id}/media/${m.id}`,{token:adopted})
     assert.equal(response.status,200,`${mode}/${order}: adopted media survives old cleanup`)
     const object=fresh.manifest.objects.find(o=>o.key===m.object_key)
     assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(fresh.root,object.file)))
    }
   }
   await bytes()
   const journalRows=()=>app.sql("SELECT rows.* FROM legacy_import_rows rows JOIN legacy_import_runs runs ON runs.id=rows.run_id WHERE json_extract(runs.source_json,'$.package')=? ORDER BY rows.run_id,rows.source_table,rows.source_id",fresh.sha)
   const journal=await journalRows()
   assert.ok(journal.length>0,'the recovered package has a real imported journal')
   assert.equal(journal.length,Object.values(complete.tables).reduce((n,t)=>n+t.journalRows,0),'source journal and reconciled row counts agree')
   for(const sha of released){await drain(sha);await drain(sha)} // Include the purged tombstone's next re-sweep.
   await bytes()
   const after=await result(fresh)
   assert.equal(after.journalEqualsPackage,true);assert.deepEqual(after.attachments,complete.attachments);assert.deepEqual(after.tables,complete.tables)
   assert.deepEqual(await journalRows(),journal)
   let erased=false
   for(let n=0;n<20;n++){
    const r=await app.call(`/api/management/projects/${source}/contacts/synthetic-contact/erase`,{token:adopted,body:{confirmation:'ERASE'}})
    if(r.status===200){erased=true;break}
    assert.equal(r.status,409,JSON.stringify(r.data));await app.runJobs(await app.takeJobs())
   }
   assert.equal(erased,true)
   assert.equal(await files.head(keys[0]),null,'native erasure still removes the recovered canonical copy')
   const erasedMedia=media.find(m=>m.id==='synthetic-media')
   assert.equal((await app.request(`/api/conversations/${erasedMedia.conversation_id}/media/${erasedMedia.id}`,{token:adopted})).status,404)
   assert.equal(await (await files.get(keys[1])).text(),'Synthetic retained peer bytes','erasure retains the other contact attachment')
   return {mode,order,identical:keys.length,verified:true,erased:true}
  }finally{await app.close();await rm(directory,{recursive:true,force:true})}
}

export async function reservationAttachments(modes=['stop-expiry','signout','orphan']){
 const cases=modes.flatMap(mode=>(mode==='orphan'?['before']:['before','after']).map(order=>[mode,order])),facts=[]
 // Every case owns its installation. Finish cleanup before starting the next
 // so this flow has no competing Workers on slower or contended runners.
 for(const [mode,order] of cases)facts.push(await reservationAttachment(mode,order))
 console.log('RESERVATION_ATTACHMENTS '+JSON.stringify(facts))
 return facts
}
