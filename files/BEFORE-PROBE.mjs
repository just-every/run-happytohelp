import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runnerRuntime} from './runtime.mjs'
import {putPackage} from './journey.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
const literal=Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' ')
/** The same owner package before/after: a source backlog followed by a copied saved reply. */
export async function knowledgeIndexDrainJourney({before=false}={}){
 const runtime=await runnerRuntime(),directory=await mkdtemp(join(tmpdir(),'legacy-index-drain-'))
 try{
  const {projectId:project,tokens}=await runtime.seed()
  const articles=Array.from({length:25},(_,i)=>({id:`synthetic-index-article-${i}`,project_id:project,slug:`synthetic-index-${i}`,title:`Synthetic guide ${i}`,content:i===0?literal:'Synthetic published help.',status:'published',created_at:1}))
  const macro={id:'synthetic-index-macro',project_id:project,title:'Synthetic saved reply',content:literal,created_by_id:'synthetic-owner',created_at:1,updated_at:1}
  const {manifest,manifestSha256:sha}=await writeLegacyPackage(directory,{format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'synthetic',exportedAt:'2026-01-01T00:00:00Z',projectId:project},tables:{articles,macros:[macro]}},{rowsPerChunk:31})
  await putPackage(runtime,directory,manifest,sha,project)
  const base=`/api/move-in/projects/${project}/legacy-import/${sha}`,runId=`legacy-package:${sha}`,read=()=>runtime.db.prepare('SELECT * FROM legacy_import_worker_runs WHERE id=?').bind(runId).first()
  const dirty=async()=>(await runtime.db.prepare('SELECT count(*) n FROM knowledge_index_dirty WHERE project_id=?').bind(project).first()).n
  await runtime.call(base+'/start',{token:tokens.owner,body:{approvedManifestSha256:sha},status:202})
  let queue=await runtime.take(),ticks=0
  const tick=async()=>{assert.ok(queue.length,'a real queue continuation exists');const result=await runtime.step(queue.splice(0,1));queue.push(...result.queue);ticks++;return read()}
  for(let n=0;n<500;n++){const run=await read();if(['complete','paused'].includes(run.state))break;await tick()}
  const run=await read(),facts={manifestSha256:sha,articles:articles.length,macroBytes:Buffer.byteLength(literal),state:run.state,phase:run.phase,error:run.error_code,dirty:await dirty(),ticks}
  if(before){
   assert.equal(run.state,'paused');assert.equal(run.error_code,'knowledge_index_not_ready');assert.equal(facts.dirty,articles.length)
   await runtime.call(base+'/resume',{token:tokens.owner,body:{approvedManifestSha256:sha},status:202});queue=await runtime.take();const resumed=await tick()
   facts.resume={state:resumed.state,error:resumed.error_code,dirty:await dirty()};assert.equal(resumed.state,'paused');assert.equal(facts.resume.dirty,articles.length)
  }else{
   assert.equal(run.state,'complete',JSON.stringify(facts))
   const result=(await runtime.call(base+'/result',{token:tokens.owner,status:200})).data.data
   assert.equal(result.verification,'verified');assert.equal(result.journalEqualsPackage,true);assert.equal(result.work.unchanged,true);assert.equal(facts.dirty,0)
   facts.result=result
  }
  assert.equal(runtime.outbound.length,0);console.log('LEGACY_INDEX_DRAIN '+JSON.stringify(facts));return facts
 }finally{await runtime.close();await rm(directory,{recursive:true,force:true})}
}
