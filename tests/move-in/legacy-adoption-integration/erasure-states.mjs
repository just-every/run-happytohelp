import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startApp} from '../../journeys/kit/app.mjs'
import {packageFixture} from './fixture.mjs'
/** One behaviour across actual custody states, through native and package doors. */
export async function mountedErasureStates(){
 const directory=await mkdtemp(join(tmpdir(),'mounted-erasure-')),facts=[]
 try{for(const state of ['manifest','partial','context','objects','objects_before_body','objects_after_body','rows','stopped','revoked','expired','absolute','complete','deleted']){
  const app=await startApp({entry:'tests/helpers/legacy-custody/worker.ts',captureQueue:true,cf:false,bindings:{H2H_SETUP_TOKEN:'synthetic-state-setup',OWNER_EMAIL:'synthetic-state@example.test'}})
  try{
   const owner={email:'synthetic-state@example.test',password:'Synthetic state password 42!'},setup=(await app.call('/api/identity/bootstrap',{body:{...owner,setupToken:'synthetic-state-setup',allowedOrigin:app.origin},status:201})).data
   let token=setup.token,inflight=null
   const project=setup.projectId,source='synthetic-state-'+state,p=await packageFixture(join(directory,state),source),base=`/api/move-in/projects/${project}/legacy-import/${p.manifestSha256}`
   const native=(await app.call(`/api/identity/projects/${project}`,{token,status:200})).data
   const contact=(await app.call('/api/identity/widget/session',{body:{widgetKey:native.widget_key,name:'Synthetic erased visitor',email:'synthetic-erased@example.test'},headers:{Origin:app.origin},status:201})).data
   const put=()=>app.call(base+'/manifest',{token,method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256}})
   assert.equal((await put()).status,201)
   if(state!=='manifest'){
    const missing=(await app.ok(base+'/status',{token})).data.missing
    for(const part of state==='partial'||state==='deleted'?missing.slice(0,1):missing)await app.call(base+'/files/'+part.file,{token,method:'PUT',raw:true,body:await readFile(join(p.root,part.file)),headers:{'Content-Type':'application/octet-stream'},status:201})
   }
   if(!['manifest','partial','deleted'].includes(state)){
    await app.call(base+'/adoption/approve',{token,body:{approvedManifestSha256:p.manifestSha256,sourceProjectId:source,policyVersion:2},headers:{Origin:app.origin},status:202})
    await app.call(base+'/start',{token,body:{approvedManifestSha256:p.manifestSha256},status:202})
    const target=['stopped','revoked','expired','absolute'].includes(state)?'context':state==='complete'?'done':state.startsWith('objects_')?'objects':state
    for(let n=0;n<350;n++){
     const run=(await app.ok(base+'/result',{token})).data.run
     assert.notEqual(run.state,'paused',run.errorCode)
     if(run.phase===target)break
     await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'))
     if(n===349)assert.fail('phase not reached: '+target)
    }
    if(state.startsWith('objects_')){const point=state==='objects_before_body'?'before_body':'after_body';inflight=app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'),{'x-custody-barrier':point});await app.until(async()=> (await app.call('/_custody/barrier')).data.reached===point,{message:'canonical '+point});assert.ok(await (await app.files).head(p.manifest.objects[0].key))}
    if(state==='objects'){await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'));assert.ok(await (await app.files).head(p.manifest.objects[0].key))}
    if(state==='rows'){for(let n=0;n<30&&!await app.first("SELECT 1 FROM contacts WHERE project_id=? AND id='synthetic-contact'",source);n++)await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'));await app.call(`/api/management/projects/${source}/contacts/synthetic-contact`,{token,status:200})}
    if(['expired','absolute'].includes(state)){const field=state==='expired'?'expires_at':'absolute_expires_at';await app.db.prepare(`UPDATE legacy_package_custody SET ${field}=0 WHERE manifest_sha256=?`).bind(p.manifestSha256).run();await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'));assert.equal((await app.first(`SELECT ${field} t FROM legacy_package_custody WHERE manifest_sha256=?`,p.manifestSha256)).t,0,'a pause cannot renew an expired source');assert.equal((await app.call(base+'/resume',{token,body:{approvedManifestSha256:p.manifestSha256}})).status,409)}
    if(state==='stopped')await app.call(base+'/stop',{token,body:{},status:202})
    if(state==='revoked'){
     await app.call('/auth/signout',{token,body:{},headers:{Origin:app.origin},status:204})
     await app.runJobs((await app.takeJobs()).filter(j=>j.type==='legacy-import.step'))
     assert.equal((await app.first('SELECT state FROM legacy_import_worker_runs WHERE manifest_sha256=?',p.manifestSha256)).state,'paused')
     token=(await app.call('/api/identity/login',{body:owner,status:200})).data.token
    }
   }
   if(state==='deleted'){
    await app.call(`/api/management/projects/${project}`,{token,method:'DELETE',status:200})
    await app.drainJobs()
    assert.ok([401,403,404,409].includes((await app.call(base+'/resume',{token,body:{approvedManifestSha256:p.manifestSha256}})).status))
    assert.ok([401,403,404,409].includes((await put()).status))
   }else{
    const targetProject=['rows','complete'].includes(state)?source:project,targetContact=['rows','complete'].includes(state)?'synthetic-contact':contact.contactId,erase=`/api/management/projects/${targetProject}/contacts/${targetContact}/erase`
    if(state==='complete'){
     const failed=await app.call(erase,{token,body:{},headers:{'x-custody-fault':'delete'}})
     assert.equal(failed.status,409);assert.equal(failed.data.code,'source_cleanup_pending')
     assert.equal(await app.first('SELECT 1 FROM contact_erasures WHERE project_id=? AND contact_id=?',targetProject,targetContact),null)
     await app.configure({})
    }
    for(let n=0;n<12;n++){
     const response=await app.call(erase,{token,body:{}})
     if(response.status===200)break
     assert.equal(response.status,409,JSON.stringify(response.data))
     if(n===11)assert.fail('erasure stayed pending')
    }
    if(inflight){await app.call('/_custody/barrier',{body:{}});assert.deepEqual((await inflight).retried,[])}
    if(state==='objects'||state.startsWith('objects_')||state==='rows')for(const object of p.manifest.objects)assert.equal(await (await app.files).head(object.key),null,'uncommitted canonical copies are erased too')
    const result=await app.call(base+'/result',{token})
    if(result.status===200){assert.equal(result.data.data.sourceCustody.invalidated,true);assert.equal(result.data.data.run.canResume,false)}
    for(const action of ['resume','start'])assert.equal((await app.call(base+'/'+action,{token,body:{approvedManifestSha256:p.manifestSha256,replay:action==='start'}})).status,409)
    assert.equal((await put()).status,409)
   }
   const held=await (await app.files).list({prefix:`legacy-package/${p.manifestSha256}/`});assert.equal(held.objects.length,0)
   for(const table of ['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities','legacy_import_worker_parts'])assert.equal(await app.first(`SELECT 1 FROM ${table} WHERE run_id=? LIMIT 1`,'legacy-package:'+p.manifestSha256),null)
   facts.push({state,sourceBodiesRemaining:0,scratchRemaining:0,refusesResume:true})
  }finally{await app.close()}
 }
 if(process.env.H2H_EVIDENCE_DIR){await mkdir(process.env.H2H_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.H2H_EVIDENCE_DIR,'mounted-erasure-states.json'),JSON.stringify(facts,null,2)+'\n')}
 return facts
 }finally{await rm(directory,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await mountedErasureStates()))
