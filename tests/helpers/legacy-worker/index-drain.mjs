import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {runnerRuntime} from './runtime.mjs'
import {putPackage} from './journey.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
const literal=Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' ')
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
const hash=value=>createHash('sha256').update(value).digest('hex')
/** A source backlog followed by a copied saved reply must finish on its own wakes. */
export async function knowledgeIndexDrainJourney(){
 const runtime=await runnerRuntime(),directory=await mkdtemp(join(tmpdir(),'legacy-index-drain-'))
 try{
  const {projectId:project,tokens}=await runtime.seed()
  const articles=Array.from({length:25},(_,i)=>({id:`synthetic-index-article-${i}`,project_id:project,slug:`synthetic-index-${i}`,title:`Synthetic guide ${i}`,content:i===0?literal:'Synthetic published help.',status:'published',created_at:1}))
  const macro={id:'synthetic-index-macro',project_id:project,title:'Synthetic saved reply',content:literal,created_by_id:'synthetic-owner',created_at:1,updated_at:1}
  const {manifest,manifestSha256:sha}=await writeLegacyPackage(directory,{format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'synthetic',exportedAt:'2026-01-01T00:00:00Z',projectId:project},tables:{articles,macros:[macro]}},{rowsPerChunk:31})
  await putPackage(runtime,directory,manifest,sha,project)
  const base=`/api/move-in/projects/${project}/legacy-import/${sha}`,runId=`legacy-package:${sha}`,read=()=>runtime.db.prepare('SELECT * FROM legacy_import_worker_runs WHERE id=?').bind(runId).first()
  const dirty=async()=>(await runtime.db.prepare('SELECT count(*) n FROM knowledge_index_dirty WHERE project_id=?').bind(project).first()).n
  const journal=async()=>(await runtime.db.prepare('SELECT source_table,source_id,row_digest,source_json,status FROM legacy_import_rows ORDER BY source_table,source_id').all()).results
  const index=async()=>(await runtime.db.prepare('SELECT source_id,version,fingerprint FROM knowledge_source_index WHERE project_id=? ORDER BY source_id,version').bind(project).all()).results
  let token=tokens.owner,queue=[],ticks=0
  const start=async(replay=false)=>{await runtime.call(base+'/start',{token,body:{approvedManifestSha256:sha,...(replay?{replay:true}:{})},status:202});queue=await runtime.take()}
  const resume=async()=>{await runtime.call(base+'/resume',{token,body:{approvedManifestSha256:sha},status:202});queue=await runtime.take()}
  const tick=async()=>{assert.ok(queue.length,'a real queue continuation exists');const result=await runtime.step(queue.splice(0,1));queue.push(...result.queue);ticks++;return {run:await read(),statements:result.metrics.statements}}
  const until=async(check)=>{for(let n=0;n<500;n++){const run=await read();if(await check(run))return run;assert.notEqual(run.state,'paused',run.error_code);await tick()}throw Error('Index drain did not settle')}
  await start()
  await until(async run=>run.phase==='rows'&&await dirty()===articles.length)
  const fences={}
  // Each failed drain uses the same still-pending macro. The real SQL batch
  // waits after planning; only the action being fenced changes during the wait.
  for(const kind of ['stop','revocation','workspaceLease','runLease']){
   const before=await read(),originalJournal=await journal(),originalIndex=await index(),count=await dirty()
   let finished=false
   const pending=runtime.step(queue.splice(0,1),{'x-legacy-barrier':'before_index'}).finally(()=>{finished=true})
   try{
    for(let n=0;n<100;n++){if((await runtime.call('/_test/legacy/barrier')).data.barrier==='before_index')break;assert.equal(finished,false,'drain reached its actual index transaction');await new Promise(resolve=>setTimeout(resolve,20));if(n===99)throw Error('Index barrier not reached')}
    if(kind==='stop')await runtime.call(base+'/stop',{token,body:{},status:202})
    else if(kind==='revocation')await runtime.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),hash(token)).run()
    else if(kind==='workspaceLease')await runtime.db.prepare('UPDATE legacy_delta_leases SET expires_at=0 WHERE project_id=?').bind(project).run()
    else await runtime.db.prepare('UPDATE legacy_import_worker_runs SET lease_until=0 WHERE id=?').bind(runId).run()
   }finally{await runtime.call('/_test/legacy/barrier',{body:{}});await pending}
   const after=await read();assert.equal(after.state,kind==='stop'?'stopped':'paused')
   if(kind==='revocation'){assert.equal(after.error_code,'import_authority_revoked');token=tokens.admin}
   assert.equal(await dirty(),count);assert.deepEqual(await journal(),originalJournal);assert.deepEqual(await index(),originalIndex);assert.equal(after.cursor_json,before.cursor_json)
   assert.equal((await runtime.db.prepare("SELECT count(*) n FROM macros WHERE id=?").bind(macro.id).first()).n,0)
   fences[kind]={state:after.state,error:after.error_code,dirty:count,cursorUnchanged:true,journalUnchanged:true,indexUnchanged:true}
   await resume()
  }
  // Lose the queue wake deliberately; the real cron dispatcher rediscovers it.
  queue=[];await runtime.call('/_test/scheduled',{body:{},status:200});queue=(await runtime.take()).filter(job=>job.type==='legacy-import.step')
  assert.ok(queue.length,'cron supplies the lost wake')
  const drains=[]
  for(let n=0;n<500;n++){
   const before=await read();if(before.state==='complete')break
   const count=await dirty(),{run,statements}=await tick();assert.notEqual(run.state,'paused',run.error_code)
   const left=await dirty()
   if(before.phase==='rows'&&count>20){assert.equal(left,count-1,'each continuation drains one source');assert.equal(run.cursor_json,before.cursor_json,'index work never advances the source row');assert.equal((await journal()).length,articles.length,'the macro is not journaled until its plan can commit');drains.push({before:count,after:left,statements})}
  }
  const complete=await read();assert.equal(complete.state,'complete');assert.ok(drains.length>1,'backlog spans bounded wakes')
  const first=(await runtime.call(base+'/result',{token,status:200})).data.data
  assert.equal(first.verification,'verified');assert.equal(first.journalEqualsPackage,true);assert.equal(first.work.unchanged,true);assert.equal(await dirty(),0)
  assert.equal(first.lease.runHeld,false);assert.equal(first.lease.workspaceHeld,false)
  const copied=(await runtime.call(`/api/management/projects/${project}/macros/${macro.id}`,{token,status:200})).data.data
  const previews=new Map(copied.references.map(reference=>[reference.token,reference.preview]))
  assert.equal(copied.content.replace(/⟦k:[a-f0-9]{32}⟧/g,token=>previews.get(token)??''),literal)
  assert.ok(copied.references.length&&copied.references.every(reference=>!reference.withheld&&reference.articles.every(article=>article.id===articles[0].id)))
  const originals=new Map([...articles.map(row=>['articles:'+row.id,row]),['macros:'+macro.id,macro]]),sourceJournal=await journal()
  assert.equal(sourceJournal.length,originals.size)
  for(const row of sourceJournal){const source=stable(originals.get(row.source_table+':'+row.source_id));assert.equal(row.source_json,source);assert.equal(row.row_digest,hash(source))}
  await start(true);await until(run=>run.state==='complete')
  const replay=(await runtime.call(base+'/result',{token,status:200})).data.data
  assert.equal(replay.attempt.appliedRows,0);assert.equal(replay.attempt.replayedRows,sourceJournal.length);assert.equal(replay.journalEqualsPackage,true);assert.deepEqual(await journal(),sourceJournal)
  assert.equal(runtime.outbound.length,0)
  const facts={manifestSha256:sha,articles:articles.length,macroBytes:Buffer.byteLength(literal),state:complete.state,dirty:await dirty(),ticks,drains,fences,cronRecovered:true,journalExact:true,journalRows:sourceJournal.length,replayApplied:replay.attempt.appliedRows,workUnchanged:first.work.unchanged,outbound:runtime.outbound.length}
  console.log('LEGACY_INDEX_DRAIN '+JSON.stringify(facts));return facts
 }finally{await runtime.close();await rm(directory,{recursive:true,force:true})}
}
