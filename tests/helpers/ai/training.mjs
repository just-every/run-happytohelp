import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {assistantApp,model} from './app.mjs'

const require=createRequire(import.meta.url),{loadFixture}=require('../../training/fixture.cjs')
const suggestion=(response,evidence=['message:0'])=>({user_goal:'Help',responses:[{button:'Answer',icon:'circle-question-mark',response,use_when:'',evidence_ids:evidence}],missing_information:[]})
// Suggestions run in two passes: the primary card, then alternatives.
const suggesting=(primary,alternatives=[])=>body=>body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives,missing_information:[]}:primary
const card=response=>({button:response.slice(0,20),icon:'circle-question-mark',response,use_when:'',evidence_ids:['message:0']})

// Training runs through the operator's routes and the queue: a confirmed synthetic workspace, evaluation cases
// checked per reply, every evaluation family, and paid outcomes that stay uncertain rather than replaying.
export async function trainingJourney(){
 const a=await assistantApp({bindings:{ENABLE_SYNTHETIC_EVALUATION:'true',TRAINING_PRICE_CEILINGS:JSON.stringify({[model]:{inputPerMillion:5,outputPerMillion:20}})}}),{app,ai,p,owner}=a
 const runs=`/api/training/projects/${p}/runs`,call=(path,options={})=>app.call(path,{token:owner,...options}).then(result=>({...result,data:result.data?.data??result.data}))
 const evaluate=async(cases,extra={})=>{const run=(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases,models:[model],max_cost:1000,max_tokens:100,...extra},status:201})).data;await a.run();return (await call(`${runs}/${run.id}`,{status:200})).data}
 try{
  // The synthetic workspace is seeded once, only locally and only with its explicit confirmation.
  const fixture=loadFixture().value,local={base:'http://localhost'}
  assert.equal((await call('/api/training/synthetic-workspace',{body:{confirm:'happytohelp.synthetic-eval.v1',fixture}})).status,403,'never on a public host')
  assert.equal((await call('/api/training/synthetic-workspace',{...local,body:{confirm:'wrong',fixture}})).status,422)
  const seeded=await call('/api/training/synthetic-workspace',{...local,body:{confirm:'happytohelp.synthetic-eval.v1',fixture},status:200})
  assert.equal((await call('/api/training/synthetic-workspace',{...local,body:{confirm:'happytohelp.synthetic-eval.v1',fixture},status:200})).data.already_seeded,true)
  assert.equal((await app.first('SELECT COUNT(*) n FROM conversations WHERE project_id=?',seeded.data.project_id)).n,fixture.cases.length)
  // Each reply is checked on its own: cardinality, private text and evidence; a passing case passes.
  const expected={min_responses:1,max_responses:2,must_include_any:['refund'],must_not_include:['private-marker']}
  ai.respond=suggesting(suggestion('The refund is complete.'))
  const passing=await evaluate([{id:'pass',messages:[{role:'contact',content:'Is my refund done?'}],expected}])
  assert.equal(passing.status,'completed',JSON.stringify(passing));assert.equal(passing.cases[0].checks.passed,true);assert.ok(passing.cases[0].artifact_available)
  ai.respond=suggesting({user_goal:'Help',responses:[card('private-marker refund')],missing_information:[]},[card('another refund'),card('third refund')])
  const failing=await evaluate([{id:'leak',messages:[{role:'contact',content:'Is my refund done?'}],expected}])
  assert.equal(failing.cases[0].checks?.passed,false,JSON.stringify(failing.cases[0]));const checks=failing.cases[0].checks.failures.map(failure=>failure.check)
  assert.ok(checks.includes('response_cardinality')&&checks.includes('must_not_include_per_reply'),JSON.stringify(checks))
  // Every evaluation family executes against the provider and keeps its usage.
  for(const [definition,answer,variant] of [
   [{messages:[{role:'contact',content:'Can you help?'}]},{user_goal:'Help',responses:['One','Two','Three'].map(button=>({button,response:button}))},'baseline'],
   [{family:'human_voice',context:{assist:{packet:{timeline:[{kind:'message',content:'Help'}],drafting_identity:{human:{name:'Jordan'},ai_reference:{name:'Robot'}}},policies:[]},options:{}}},'Human voice answer','prototype'],
   [{family:'monitoring',context:{actions:[],summaries:[],last_insights:[],available_ais:[]}},{decision:'no_insight',help_type:null,help:null,evidence_ids:[]},'prototype'],
   [{family:'profile',type:'optimize',context:{dataset_files:[],optimize:{}}},{pages:[]},'prototype'],
   [{messages:[{role:'contact',content:'Can you help?'}],family:'customer_reply'},'Customer answer','prototype'],
  ]){
   ai.respond=()=>answer;const run=await evaluate([{id:definition.family||variant,...definition}],{variants:[variant]})
   assert.equal(run.cases[0].status,'completed',JSON.stringify(run.cases[0]));assert.ok(run.cases[0].usage,'usage is kept')
  }
  // A failing second stage fails the case once: both provider rounds are recorded, nothing is retried.
  ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?new Response(JSON.stringify({error:{message:'second stage rejected'}}),{status:503}):suggestion('Helpful answer')
  const calls=a.providerCalls(),stage=await evaluate([{id:'stage',messages:[{role:'contact',content:'Can you help?'}]}])
  assert.notEqual(stage.cases[0].status,'completed');assert.equal(a.providerCalls()-calls,2)
  // A provider that reports no usage leaves the case uncertain with its reservation held; its output stays readable until lost.
  const unreported=value=>{const text=JSON.stringify(value);return new Response([{type:'response.output_text.delta',item_id:'msg',delta:text},{type:'response.output_text.done',item_id:'msg',text},{type:'response.completed',response:{}}].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})}
  ai.respond=body=>unreported(body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:suggestion('Refund policy is available.'))
  const unknown=await evaluate([{id:'unknown',messages:[{role:'contact',content:'Refunds?'}],expected:{min_responses:1}}])
  assert.equal(unknown.status,'uncertain');assert.ok(unknown.reserved_cost>0);assert.equal(unknown.spent_cost,0);assert.match(unknown.cases[0].error,/cost.*not reported/i)
  assert.equal(unknown.cases[0].artifact_available,true);assert.equal((await app.request(`${runs}/${unknown.id}/cases/${unknown.cases[0].id}/artifact`,{token:owner})).status,200)
  await (await app.files).delete(unknown.cases[0].output_key);assert.equal((await call(`${runs}/${unknown.id}`,{status:200})).data.cases[0].artifact_available,false,'a missing object is not advertised')
  // An attempt whose lease expired is uncertain and never replayed.
  const expired=(await call(runs,{body:{request_id:'expired',kind:'evaluation',cases:[{id:'expired',expected:{min_responses:1}}],models:[model],max_cost:2,max_tokens:100},status:201})).data
  const [job]=await app.takeJobs();await app.db.prepare("UPDATE training_runs SET status='running',reserved_cost=2 WHERE id=?").bind(expired.id).run()
  await app.db.prepare("UPDATE training_cases SET status='running',attempt_id='interrupted',started_at=1,lease_expires_at=1 WHERE run_id=?").bind(expired.id).run()
  const before=a.providerCalls();await app.runJobs([job]);assert.equal(a.providerCalls(),before)
  const lapsed=(await call(`${runs}/${expired.id}`,{status:200})).data;assert.equal(lapsed.status,'uncertain');assert.equal(lapsed.reserved_cost,2);assert.match(lapsed.cases[0].error,/lease expired/i)
  // A run interrupted while planning resumes from its saved plan on the schedule.
  await app.db.prepare("INSERT INTO training_runs(id,project_id,operator_id,request_id,kind,status,config,case_count,max_cost,max_tokens,created_at) VALUES('restored',?,?,'restored','evaluation','planning',?,1,1,100,1)").bind(p,a.workspace.users.owner,JSON.stringify({plan:[{id:'restored-case',definition:{id:'restored',expected:{}},model,variant:'prototype'}]})).run()
  await app.scheduled();assert.equal((await app.first("SELECT status FROM training_runs WHERE id='restored'")).status,'queued');assert.equal((await app.first("SELECT COUNT(*) n FROM training_cases WHERE run_id='restored'")).n,1)
  assert.ok((await app.takeJobs()).some(job=>job.type==='training'&&job.id==='restored'))
  const cancelled=(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[{id:'cancelled',expected:{min_responses:1}}],models:[model],max_cost:2,max_tokens:100},status:201})).data
  const waiting=await app.takeJobs(),beforeCancel=a.providerCalls()
  await call(`${runs}/${cancelled.id}/cancel`,{body:{},status:200});await app.runJobs(waiting)
  assert.equal((await call(`${runs}/${cancelled.id}`,{status:200})).data.status,'cancelled');assert.equal(a.providerCalls(),beforeCancel)
  // Deletion after admission and before execution wins over the durable wakeup.
  const deleted=(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[{id:'deleted',expected:{min_responses:1}}],models:[model],max_cost:2,max_tokens:100},status:201})).data
  const queued=await app.takeJobs(),beforeDelete=a.providerCalls()
  await app.call(`/api/management/projects/${p}`,{token:owner,method:'DELETE',status:200})
  await app.runJobs(queued);assert.equal(a.providerCalls(),beforeDelete)
  assert.equal((await call(`${runs}/${deleted.id}`)).status,401)
 }finally{await a.close()}
}
