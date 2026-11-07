import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,copyFile,symlink,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {nativeHarness} from './harness.mjs'

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)))
const fixture={runs:61,entries:14770,tickets:6214}
const empty=()=>({d1RoundTrips:0,entryReads:{source:0,target:0,predecessor:0},setReads:{source:0,target:0,predecessor:0},r2:{get:0,head:0,put:0,delete:0,list:0},queueSends:0,wallMs:0,maxStepWallMs:0,maxStatements:0,steps:0})
const trips=total=>total.d1RoundTrips+Object.values(total.r2).reduce((sum,n)=>sum+n,0)+total.queueSends
function add(total,step){assert.ok(step.metrics,'binding metrics missing');total.d1RoundTrips+=step.metrics.d1RoundTrips;total.queueSends+=step.metrics.queueSends;for(const key of Object.keys(total.entryReads)){total.entryReads[key]+=step.metrics.entryReads[key];total.setReads[key]+=step.metrics.setReads[key]};for(const key of Object.keys(total.r2))total.r2[key]+=step.metrics.r2[key];total.wallMs+=step.wallMs;total.maxStepWallMs=Math.max(total.maxStepWallMs,step.wallMs);total.maxStatements=Math.max(total.maxStatements,step.statements||0);total.steps++}
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
 const h=await nativeHarness({sourceRoot,bindings:process.env.H2H_APPLY_TRACE?{APPLY_TRACE:'1'}:{}}),total=empty(),steps=[],runs=[]
 const record=(runId,phase,started,metrics,statements=0)=>{const row={runId,phase,wallMs:performance.now()-started,metrics,statements};steps.push(row);add(total,row)}
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
   assert.deepEqual(result.retried,[]);assert.deepEqual(result.effects,{widget:0});assert.ok(result.statements<=980,'each delivery leaves the queue failure reserve intact');record(job.id,job.type,at,result.metrics,result.statements)
   if(steps.length%100===0)console.log(`${label}_PROGRESS ${JSON.stringify({steps:steps.length,d1RoundTrips:total.d1RoundTrips,wallMs:total.wallMs})}`)
  }
  if(process.env.H2H_APPLY_TRACE){const sample=steps.find(step=>step.statements>300);console.log(`${label}_TRACE ${JSON.stringify({runId:sample?.runId,statements:sample?.statements,trace:sample?.metrics.trace})}`);const create=steps.find(step=>step.metrics.d1RoundTrips===18);console.log(`${label}_TRACE_CREATE ${JSON.stringify(create?.metrics.trace)}`)}
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
  console.log(`${label} ${JSON.stringify({fixture,counts,...total,roundTrips:trips(total),evidence:join(evidenceDir,`${label.toLowerCase()}.json`)})}`)
  return receipt
 }finally{await h.close()}
}

/** Standalone scale gate: baseline-only runs before editing application sources.
 * A default comparison fails below 5x; report-only is explicitly diagnostic. */
export async function applyPerformanceReplay({baselineRef=process.env.H2H_APPLY_BASELINE_REF,baselineOnly=false,reportOnly=false,evidenceDir}={}){
 assert.ok(baselineRef,'Set H2H_APPLY_BASELINE_REF to the unedited main commit')
 const baselineRoot=await archivedSource(baselineRef)
 let baseline
 try{baseline=await replayApply({label:'BASELINE',sourceRoot:baselineRoot,evidenceDir})}finally{await rm(baselineRoot,{recursive:true,force:true})}
 if(baselineOnly)return baseline
 const candidate=await replayApply({label:'CANDIDATE',evidenceDir}),reduction=trips(baseline)/trips(candidate),d1Reduction=baseline.d1RoundTrips/candidate.d1RoundTrips
 console.log(`APPLY_REDUCTION ${JSON.stringify({baselineRef,roundTrips:reduction,d1RoundTrips:d1Reduction,baselineWallMs:baseline.wallMs,candidateWallMs:candidate.wallMs,reportOnly})}`)
 if(!reportOnly)assert.ok(reduction>=5&&d1Reduction>=5,`Round trips reduced ${reduction.toFixed(2)}x (D1 ${d1Reduction.toFixed(2)}x); require at least 5x`)
 return {baseline,candidate,reduction}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const option=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
 await applyPerformanceReplay({baselineRef:option('--baseline-ref')||process.env.H2H_APPLY_BASELINE_REF,baselineOnly:process.argv.includes('--baseline-only'),reportOnly:process.argv.includes('--report-only'),evidenceDir:option('--evidence-dir')})
}
