import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,copyFile,symlink,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {nativeHarness} from './harness.mjs'

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)))
const fixture={runs:61,entries:14770,tickets:6214}
const empty=()=>({d1RoundTrips:0,r2:{get:0,head:0,put:0,delete:0,list:0},queueSends:0,wallMs:0,steps:0})
function add(total,step){assert.ok(step.metrics,'binding metrics missing');total.d1RoundTrips+=step.metrics.d1RoundTrips;total.queueSends+=step.metrics.queueSends;for(const key of Object.keys(total.r2))total.r2[key]+=step.metrics.r2[key];total.wallMs+=step.wallMs;total.steps++}
async function archivedSource(ref){
 const directory=await mkdtemp(join(tmpdir(),'move-in-replay-source-'))
 try{
  // git and tar are joined by a pipe, never by shell interpolation of the ref.
  const archive=spawn('git',['archive','--format=tar',ref],{cwd:root,stdio:['ignore','pipe','pipe']})
  const extract=spawn('tar',['-xf','-','-C',directory],{stdio:['pipe','ignore','pipe']})
  archive.stdout.pipe(extract.stdin)
  await Promise.all([archive,extract].map(child=>new Promise((ok,no)=>{let error='';child.stderr.on('data',chunk=>{error+=chunk});child.on('error',no);child.on('close',code=>code===0?ok():no(new Error(`Archive ${ref}: ${error}`)))})))
  await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir')
  await mkdir(join(directory,'tests/move-in'),{recursive:true})
  for(const name of ['worker.ts','apply-metrics.ts','apply-replay-fixture.ts'])await copyFile(join(root,'tests/move-in',name),join(directory,'tests/move-in',name))
  return directory
 }catch(error){await rm(directory,{recursive:true,force:true});throw error}
}

export async function replayApply({label='CANDIDATE',sourceRoot=root,evidenceDir=process.env.H2H_EVIDENCE_DIR||join(root,'logs/apply-replay')}={}){
 const h=await nativeHarness({sourceRoot}),total=empty(),steps=[],runs=[]
 const record=(runId,phase,started,metrics)=>{const row={runId,phase,wallMs:performance.now()-started,metrics};steps.push(row);add(total,row)}
 try{
  const seeded=[]
  for(let index=0;index<fixture.runs;index++)seeded.push(await h.call('/_test/apply-replay/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fixture,index})}))
  assert.equal(seeded.reduce((n,run)=>n+run.entries,0),fixture.entries)
  assert.equal(seeded.reduce((n,run)=>n+run.tickets,0),fixture.tickets)
  const pull=seeded.at(-1),started=performance.now(),approved=await h.raw(`/api/move-in/projects/p/zendesk/pulls/${pull.pullId}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:pull.fingerprint})})
  assert.ok(approved.response.ok,JSON.stringify(approved.data));record(pull.pullId,'approval',started,approved.metrics)
  while(h.queued.length){
   assert.ok(steps.length<20000,'apply replay must make bounded progress')
   const job=h.queued[0],at=performance.now(),result=await h.step()
   assert.deepEqual(result.retried,[]);assert.deepEqual(result.effects,{widget:0});record(job.id,job.type,at,result.metrics)
   if(steps.length%100===0)console.log(`${label}_PROGRESS ${JSON.stringify({steps:steps.length,d1RoundTrips:total.d1RoundTrips,wallMs:total.wallMs})}`)
  }
  const finished=(await h.call(`/api/move-in/projects/p/zendesk/pulls/${pull.pullId}`)).data
  assert.equal(finished.error,null);assert.equal(finished.state,'applied');assert.equal(finished.progress.batchesApplied,fixture.runs);assert.equal(finished.totals.tickets.imported,fixture.tickets)
  for(const run of seeded){
   const landed=await h.db.prepare('SELECT state,cursor,total,error FROM move_in_runs WHERE id=?').bind(run.id).first()
   assert.equal(landed.error,null,`${run.id}: ${landed.error}`);assert.equal(landed.state,'completed');assert.equal(landed.cursor,run.entries);assert.equal(landed.total,run.entries)
   const subtotal=empty();for(const step of steps.filter(step=>step.runId===run.id))add(subtotal,step)
   runs.push({id:run.id,entries:run.entries,...subtotal})
   console.log(`${label}_RUN ${JSON.stringify(runs.at(-1))}`)
  }
  const counts=await h.db.prepare('SELECT (SELECT COUNT(*) FROM contacts) contacts,(SELECT COUNT(*) FROM conversations) tickets,(SELECT COUNT(*) FROM messages) messages,(SELECT COUNT(*) FROM move_in_notes) notes,(SELECT COUNT(*) FROM ik_sources) sources').first()
  assert.equal(counts.contacts,fixture.entries-fixture.tickets);assert.equal(counts.tickets,fixture.tickets);assert.equal(counts.messages,fixture.tickets*2);assert.equal(counts.notes,fixture.tickets);assert.equal(counts.sources,fixture.entries)
  assert.equal(h.outbound,0)
  const receipt={label,fixture,counts,pull:{id:pull.pullId,state:finished.state,progress:finished.progress},...total,runs,steps}
  await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`${label.toLowerCase()}.json`),JSON.stringify(receipt,null,2)+'\n')
  console.log(`${label} ${JSON.stringify({fixture,counts,...total,evidence:join(evidenceDir,`${label.toLowerCase()}.json`)})}`)
  return receipt
 }finally{await h.close()}
}

/** This is folded into the existing nightly capacity journey, not registered as
 * another test. Baseline-only must run before editing application sources. */
export async function applyPerformanceReplay({baselineRef=process.env.H2H_APPLY_BASELINE_REF,baselineOnly=false,reportOnly=false,evidenceDir}={}){
 assert.ok(baselineRef,'Set H2H_APPLY_BASELINE_REF to the unedited main commit')
 const baselineRoot=await archivedSource(baselineRef)
 let baseline
 try{baseline=await replayApply({label:'BASELINE',sourceRoot:baselineRoot,evidenceDir})}finally{await rm(baselineRoot,{recursive:true,force:true})}
 if(baselineOnly)return baseline
 const candidate=await replayApply({label:'CANDIDATE',evidenceDir}),reduction=baseline.d1RoundTrips/candidate.d1RoundTrips
 console.log(`APPLY_REDUCTION ${JSON.stringify({baselineRef,d1RoundTrips:reduction,baselineWallMs:baseline.wallMs,candidateWallMs:candidate.wallMs,reportOnly})}`)
 if(!reportOnly)assert.ok(reduction>=5,`D1 round trips reduced ${reduction.toFixed(2)}x; require at least 5x`)
 return {baseline,candidate,reduction}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const option=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
 await applyPerformanceReplay({baselineRef:option('--baseline-ref')||process.env.H2H_APPLY_BASELINE_REF,baselineOnly:process.argv.includes('--baseline-only'),reportOnly:process.argv.includes('--report-only'),evidenceDir:option('--evidence-dir')})
}
