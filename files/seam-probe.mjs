import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {resolve,join} from 'node:path'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
const root=resolve(process.argv[2])
const {startApp}=await import(pathToFileURL(join(root,'tests/journeys/kit/app.mjs')))
const {packageFixture}=await import(pathToFileURL(join(root,'tests/move-in/legacy-package-upload/fixture.mjs')))
const app=await startApp({captureQueue:true,cf:false}),directory=await mkdtemp(join(tmpdir(),'legacy-seam-probe-')),receipts=[]
try{
 const owner=await app.seedWorkspace('seam-proof'),foreign=await app.seedWorkspace('seam-foreign'),p=await packageFixture(directory,owner.projectId)
 const base=`/api/move-in/projects/${owner.projectId}/legacy-import/${p.manifestSha256}`
 async function probe(name,path,options,status){
  const response=await app.request(path,options),body=await response.json()
  assert.equal(response.status,status,JSON.stringify({name,body}))
  assert.match(response.headers.get('Content-Type'),/application\/json/)
  receipts.push({name,status:response.status,json:true,code:body.code??null,error:body.error??null})
  return body
 }
 for(const control of ['start','resume','stop','result']){
  const options=control==='result'?{}:{body:{approvedManifestSha256:p.manifestSha256}}
  await probe('runner '+control+' operator',base+'/'+control,{...options,token:owner.tokens.operator},403)
  await probe('runner '+control+' unauthenticated',base+'/'+control,options,401)
  await probe('runner '+control+' foreign member',base+'/'+control,{...options,token:foreign.tokens.owner},404)
 }
 const manifestOptions={method:'PUT',raw:true,body:p.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p.manifestSha256}}
 await probe('intake operator',base+'/manifest',{...manifestOptions,token:owner.tokens.operator},403)
 await probe('intake unauthenticated',base+'/manifest',manifestOptions,401)
 await probe('intake foreign member',base+'/manifest',{...manifestOptions,token:foreign.tokens.owner},404)
 await probe('intake owner wrong version',base+'/manifest',{...manifestOptions,token:owner.tokens.owner,headers:{...manifestOptions.headers,'X-Legacy-Contract-Version':'2'}},422)
 await probe('intake owner accepts manifest',base+'/manifest',{...manifestOptions,token:owner.tokens.owner},201)
 await probe('runner owns approval despite intake-only version header',base+'/start',{token:owner.tokens.owner,body:{approvedManifestSha256:'0'.repeat(64)},headers:{'X-Legacy-Contract-Version':'2'}},409)
 assert.deepEqual(await app.takeJobs(),[])
 assert.equal((await app.first('SELECT count(*) n FROM legacy_import_worker_runs')).n,0)
 assert.equal(app.requests.length,0)
 console.log(JSON.stringify({assertions:receipts.length,receipts,runnerRuns:0,queuedJobs:0,outbound:0},null,2))
}finally{await app.close();await rm(directory,{recursive:true,force:true})}
