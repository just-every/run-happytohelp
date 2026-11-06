import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {assistantApp,model} from './app.mjs'
import {openaiStream} from '../openai-stream.mjs'

const selectedModel='gpt-5.4-nano'
const require=createRequire(import.meta.url),{loadFixture}=require('../../training/fixture.cjs')
const definition=id=>({id,family:'customer_reply',messages:[{role:'contact',content:'Synthetic refund question'}],expected:{must_include_any:['refund']}})

// Existing trainingJourney keeps the multi-stage, per-reply, lease and deletion assertions.
// These additional outcomes use the same public routes and real queue, faking only provider HTTP.
// Fixture checks establish evaluation behavior, never R-15 live support quality or R-16 live USD costs.
export async function trainingOutcomes(){
 const a=await assistantApp({bindings:{TRAINING_PRICE_CEILINGS:JSON.stringify({[model]:{inputPerMillion:5,outputPerMillion:20},[selectedModel]:{inputPerMillion:5,outputPerMillion:20}})}})
 const {app,p,owner,ai}=a,runs=`/api/training/projects/${p}/runs`
 const call=(path,options={})=>app.call(path,{token:owner,...options}).then(r=>({...r,data:r.data?.data??r.data}))
 const create=async(extra={},status=201)=>(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[definition('one')],models:[model],max_cost:1000,max_tokens:100,...extra},status})).data
 const read=async id=>(await call(`${runs}/${id}`,{status:200})).data
 const snapshot=async()=>({calls:a.providerCalls(),runs:(await call(runs,{status:200})).data.length,cases:(await app.first('SELECT count(*) n FROM training_cases')).n})
 const bounded=run=>{
  assert.ok(run.spent_cost>=0&&run.reserved_cost>=0)
  assert.ok(run.spent_cost+run.reserved_cost<=run.max_cost,JSON.stringify(run))
  assert.equal(run.cases.length,run.case_count)
 }
 const summary=run=>({status:run.status,case_statuses:run.cases.map(c=>c.status),spent:run.spent_cost,reserved:run.reserved_cost})
 const record=(outcome,before,after)=>console.log(JSON.stringify({training_outcome:outcome,before,after}))
 try{
  const supplied={input_tokens:19,output_tokens:7,provider_measurement:{label:'retained-exactly',count:31}}
  const raw={...supplied,total_tokens:26,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}
  ai.respond=()=>openaiStream('The refund policy is available.',supplied)
  const before=await snapshot(),requestId=crypto.randomUUID(),created=await create({request_id:requestId,models:[selectedModel],cases:[definition('one'),definition('two')]})
  const queued=await read(created.id);bounded(queued)
  assert.deepEqual(queued.config.models,[selectedModel]);assert.equal(queued.max_cost,1000);assert.equal(queued.max_tokens,100)
  assert.equal(queued.status,'queued');assert.equal(queued.spent_cost,0);assert.equal(queued.reserved_cost,0)
  assert.deepEqual(queued.cases.map(c=>[c.case_id,c.status,c.model]),[['one','queued',selectedModel],['two','queued',selectedModel]])
  assert.equal(a.providerCalls(),before.calls)
  // Lost creation response and a process restart retain the same run/cases and request identity.
  const repeated=await create({request_id:requestId,models:[selectedModel],cases:[definition('one'),definition('two')]},200)
  assert.equal(repeated.id,created.id)
  assert.equal((await app.takeJobs()).filter(j=>j.id===created.id).length,1)
  await app.configure({});assert.deepEqual(await read(created.id),queued)
  await app.scheduled()
  const jobs=(await app.takeJobs()).filter(j=>j.type==='training');assert.equal(jobs.filter(j=>j.id===created.id).length,1)
  await a.run(jobs)
  const completed=await read(created.id);bounded(completed)
  assert.equal(completed.status,'completed');assert.equal(completed.reserved_cost,0);assert.ok(completed.spent_cost>0)
  assert.equal(completed.spent_cost,completed.cases.reduce((sum,c)=>sum+c.usage.cost,0))
  for(const c of completed.cases){
   assert.equal(c.status,'completed');assert.equal(c.checks.passed,true);assert.equal(c.artifact_available,true)
   assert.equal(c.provider_rounds.length,1);const [round]=c.provider_rounds
   assert.equal(round.model,selectedModel);assert.equal(round.observed,true)
   assert.deepEqual(round.usage.metadata.raw_provider_usage,raw,'route retains exact provider usage, including fields the accounting normalizer does not use')
   assert.equal(c.usage.inputTokens,19);assert.equal(c.usage.outputTokens,7)
  }
  const requests=ai.calls.slice(before.calls);assert.equal(requests.length,2)
  assert.ok(requests.every(r=>r.body.model===selectedModel),'only the explicitly selected model reaches the provider')
  assert.ok(requests.every(r=>r.body.max_output_tokens===100),'the selected output-token cap reaches the provider')
  await app.runJobs(jobs);assert.equal(a.providerCalls()-before.calls,2,'redelivery never pays twice')
  assert.deepEqual(await read(created.id),completed)
  const after=await snapshot();assert.equal(after.runs-before.runs,1);assert.equal(after.cases-before.cases,2)
  record('persisted create, selected model/budget, exact usage and no paid replay',{...before,...summary(queued)},{...after,...summary(completed)})

  // A secondary stage cannot escape the explicit model selection even if it has a configured provider.
  const rejectedBefore=await snapshot()
  await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[{id:'outside',family:'monitoring',insightModel:'gpt-5.4-nano',context:{}}],models:[model],max_cost:1000,max_tokens:100},status:422})
  for(const max_tokens of [0,32001])await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[definition('invalid-tokens')],models:[model],max_cost:1000,max_tokens},status:422})
  assert.deepEqual(await snapshot(),rejectedBefore,'invalid selections admit no run, case or provider call')
  record('unselected secondary model and invalid token bounds',rejectedBefore,await snapshot())

  // Valid-shaped requests lacking a price ceiling or sufficient explicit budget stop before provider HTTP.
  // The current runner conservatively holds the reservation for inspection; it never invents spent cost.
  for(const [label,extra,error] of [
   ['unpriced model',{models:['gpt-5.4']},/TRAINING_PRICE_CEILINGS/],
   ['unconfigured provider',{models:['claude-sonnet-4-6']},/ANTHROPIC_API_KEY/],
   ['insufficient cost cap',{max_cost:0.01},/TRAINING_BUDGET_INSUFFICIENT/],
  ]){
   const b=await snapshot(),run=await create(extra),q=await read(run.id);bounded(q)
   await a.run();const stopped=await read(run.id);bounded(stopped)
   assert.equal(stopped.status,'uncertain');assert.equal(stopped.cases[0].status,'uncertain')
   assert.match(stopped.cases[0].error,error);assert.equal(stopped.spent_cost,0);assert.equal(stopped.reserved_cost,stopped.max_cost)
   assert.equal(stopped.cases[0].provider_rounds.length,0);assert.equal(a.providerCalls(),b.calls)
   await app.scheduled();await app.drainJobs();assert.equal(a.providerCalls(),b.calls)
   const s=await snapshot();assert.equal(s.runs-b.runs,1);assert.equal(s.cases-b.cases,1)
   record(label,{...b,...summary(q)},{...s,...summary(stopped)})
  }

  const b=await snapshot(),cancel=await create(),waiting=await app.takeJobs(),q=await read(cancel.id)
  await call(`${runs}/${cancel.id}/cancel`,{body:{},status:200});await app.runJobs(waiting);await app.scheduled();await app.drainJobs()
  const cancelled=await read(cancel.id);bounded(cancelled)
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cases[0].status,'cancelled')
  assert.equal(cancelled.spent_cost,0);assert.equal(cancelled.reserved_cost,0);assert.equal(a.providerCalls(),b.calls)
  record('cancelled wakeup',{...b,...summary(q)},{...await snapshot(),...summary(cancelled)})

  // Recreate only the state a lost worker leaves; all admission, recovery and readback use public doors.
  const leaseBefore=await snapshot(),expired=await create(),leased=await app.takeJobs()
  await app.db.prepare("UPDATE training_runs SET status='running',reserved_cost=1000 WHERE id=?").bind(expired.id).run()
  await app.db.prepare("UPDATE training_cases SET status='running',attempt_id='lost-paid-attempt',started_at=1,lease_expires_at=1 WHERE run_id=?").bind(expired.id).run()
  const interrupted=await read(expired.id)
  await app.runJobs(leased);await app.scheduled();await app.drainJobs()
  const lapsed=await read(expired.id);bounded(lapsed)
  assert.equal(lapsed.status,'uncertain');assert.equal(lapsed.cases[0].status,'uncertain')
  assert.match(lapsed.cases[0].error,/lease expired/i);assert.equal(lapsed.spent_cost,0);assert.equal(lapsed.reserved_cost,1000)
  assert.equal(a.providerCalls(),leaseBefore.calls)
  record('expired lease never replays',{...leaseBefore,...summary(interrupted)},{...await snapshot(),...summary(lapsed)})

  const planBefore=await snapshot(),planning=await create(),planned=await read(planning.id)
  await app.takeJobs()
  // Planning saved its source plan but crashed before creating its cases. No paid attempt existed.
  await app.db.prepare('DELETE FROM training_cases WHERE run_id=?').bind(planning.id).run()
  await app.db.prepare("UPDATE training_runs SET status='planning' WHERE id=?").bind(planning.id).run()
  await app.configure({});await app.scheduled()
  const recovered=await read(planning.id);bounded(recovered)
  assert.equal(recovered.status,'queued');assert.deepEqual(recovered.cases,planned.cases)
  assert.equal(recovered.spent_cost,0);assert.equal(recovered.reserved_cost,0)
  assert.equal(a.providerCalls(),planBefore.calls)
  await app.drainJobs();const resumed=await read(planning.id);bounded(resumed)
  assert.equal(resumed.status,'completed');assert.equal(resumed.cases[0].status,'completed')
  assert.equal(resumed.reserved_cost,0);assert.ok(resumed.spent_cost>0)
  assert.equal(a.providerCalls()-planBefore.calls,1)
  await app.scheduled();await app.drainJobs();assert.equal(a.providerCalls()-planBefore.calls,1)
  record('planning resumes once',{...planBefore,...summary(recovered)},{...await snapshot(),...summary(resumed)})

  // Production/default configuration refuses the loopback door too; enabling a test seed never overwrites an installed project.
  const fixture=loadFixture().value,seed='/api/training/synthetic-workspace',options={base:'http://localhost',body:{confirm:'happytohelp.synthetic-eval.v1',fixture}}
  const projectCount=async()=>(await app.first('SELECT count(*) n FROM projects')).n,projects=await projectCount(),seedBefore=await snapshot()
  await call(seed,{...options,status:403});assert.equal(await projectCount(),projects)
  await app.configure({ENABLE_SYNTHETIC_EVALUATION:'true'})
  const {seededId}=await import('../../../src/modules/training-runs/checks/index.mjs'),installed=seededId('project')
  await app.db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(installed,'Installed workspace','installed-key','https://installed.example').run()
  const installedBefore=await app.first('SELECT * FROM projects WHERE id=?',installed)
  await call(seed,{...options,status:409})
  assert.deepEqual(await app.first('SELECT * FROM projects WHERE id=?',installed),installedBefore)
  assert.equal((await app.first('SELECT count(*) n FROM training_workspaces')).n,0)
  assert.equal(await projectCount(),projects+1);assert.deepEqual(await snapshot(),seedBefore)
  record('synthetic admission disabled and installed project preserved',seedBefore,await snapshot())
 }finally{await a.close()}
}
