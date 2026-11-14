import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {startApp} from '../../journeys/kit/app.mjs'
import {packageFixture,sha} from './fixture.mjs'
/** Real mounted intake/erase and real R2, with B's existing I/O barriers only. */
export async function mountedOrderingJourney(){
 const app=await startApp({entry:'tests/helpers/legacy-custody/worker.ts',captureQueue:true,cf:false}),scratch=await mkdtemp(join(tmpdir(),'legacy-mounted-order-')),facts=[]
 try{
  for(const point of ['before_reserve','after_reserve','before_body','after_body']){
   const w=await app.seedWorkspace('mounted-'+point),token=w.tokens.owner,p=await packageFixture(join(scratch,point),'synthetic-source-'+point),base=`/api/move-in/projects/${w.projectId}/legacy-import/${p.manifestSha256}`
   await app.db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,'Synthetic',1)").bind('synthetic-'+point,w.projectId).run()
   const put=()=>app.call(base+'/manifest',{token,method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256,'x-custody-barrier':point}})
   const pending=put()
   await app.until(async()=> (await app.call('/_custody/barrier')).data.reached===point,{message:point})
   const erased=await app.call(`/api/management/projects/${w.projectId}/contacts/synthetic-${point}/erase`,{token,body:{},status:200})
   await app.call('/_custody/barrier',{body:{}})
   assert.equal((await pending).status,409)
   const key=`legacy-package/${p.manifestSha256}/manifest.json`,files=await app.files,held=await files.get(key)
   if(held){assert.equal(held.customMetadata.custodyBody,'reservation');assert.notEqual(await held.text(),p.bytes.toString())}
   const c=await app.first('SELECT generation FROM legacy_package_custody WHERE manifest_sha256=?',p.manifestSha256)
   const consumed=await app.runJobs([{type:'legacy-package.cleanup',id:p.manifestSha256,generation:c.generation}]);assert.deepEqual(consumed.retried,[])
   assert.equal(await files.head(key),null,'actual inactive-project-independent cleanup sweeps the late nonce')
   assert.equal((await app.call(base+'/manifest',{token,method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256}})).status,409)
   const newer=Buffer.from(JSON.stringify({...p.manifest,source:{...p.manifest.source,revision:'synthetic-fresh-after-erasure'}})),digest=sha(newer)
   assert.equal((await app.call(base.replace(p.manifestSha256,digest)+'/manifest',{token,method:'PUT',raw:true,body:newer,headers:{'Content-Type':'application/json','X-Manifest-SHA256':digest}})).status,409)
   facts.push({point,erasureStatus:erased.status,rawBodyAfterErasure:false,lateNonceSwept:true,sameAndFreshShaRefused:true})
  }
  const cron=await app.scheduled();assert.ok(cron.statements<=1000);assert.equal(cron.refused,0)
  for(const consumer of Object.values(cron.consumers))assert.equal(consumer.completed,true)
  await app.configure({})
  const schemaMissing=[]
  for(const prefix of ['328_','329_','331_','333_']){
   const old=await startApp({captureQueue:true,cf:false,migrate:name=>!name.startsWith(prefix)&&!(prefix==='329_'&&name.startsWith('333_'))&&!(['329_','331_'].includes(prefix)&&name.startsWith('332_'))&&!(prefix==='329_'&&name.startsWith('331_'))})
   try{const w=await old.seedWorkspace('schema-'+prefix),p=await packageFixture(join(scratch,'schema-'+prefix),'synthetic-schema-source'),response=await old.call(`/api/move-in/projects/${w.projectId}/legacy-import/${p.manifestSha256}/manifest`,{token:w.tokens.owner,method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256}});assert.equal(response.status,503);assert.equal((await (await old.files).list({prefix:'legacy-package/'})).objects.length,0);schemaMissing.push({migration:prefix,status:response.status,retainedBodies:0})}finally{await old.close()}
  }
  if(process.env.H2H_EVIDENCE_DIR){await mkdir(process.env.H2H_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.H2H_EVIDENCE_DIR,'mounted-ordering.json'),JSON.stringify({facts,cron,schemaMissing},null,2)+'\n')}
  return facts
 }finally{await app.close();await rm(scratch,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await mountedOrderingJourney()))
