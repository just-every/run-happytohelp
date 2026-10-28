import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {assistantApp,model} from './app.mjs'
import {procedureDefinition} from './procedures.mjs'
import {openaiToolCall} from '../openai-stream.mjs'

const require=createRequire(import.meta.url),{loadFixture}=require('../../training/fixture.cjs')
const suggestion=(response,evidence=['message:0'])=>({user_goal:'Help',responses:[{button:'Answer',icon:'circle-question-mark',response,use_when:'',evidence_ids:evidence}],missing_information:[]})
// Suggestions run in two passes: the primary card, then alternatives.
const suggesting=(primary,alternatives=[])=>body=>body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives,missing_information:[]}:primary

// Training runs through the operator's routes and the queue: a confirmed synthetic workspace, evaluation cases
// checked per reply, every evaluation family, and paid outcomes that stay uncertain rather than replaying.
export async function trainingJourney(){
 const a=await assistantApp({bindings:{ENABLE_SYNTHETIC_EVALUATION:'true',TRAINING_PRICE_CEILINGS:JSON.stringify({[model]:{inputPerMillion:5,outputPerMillion:20}})}}),{app,ai,p,owner}=a
 const maxCost=1000,runs=`/api/training/projects/${p}/runs`,call=(path,options={})=>app.call(path,{token:owner,...options}).then(result=>({...result,data:result.data?.data??result.data}))
 const evaluate=async(cases,extra={})=>{const run=(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases,models:[model],max_cost:maxCost,max_tokens:100,...extra},status:201})).data;await a.run();return (await call(`${runs}/${run.id}`,{status:200})).data}
 try{
  // The synthetic workspace is seeded once, only locally and only with its explicit confirmation.
  const fixture=loadFixture().value,local={base:'http://localhost'}
  assert.equal((await call('/api/training/synthetic-workspace',{body:{confirm:'happytohelp.synthetic-eval.v1',fixture}})).status,403,'never on a public host')
  assert.equal((await call('/api/training/synthetic-workspace',{...local,body:{confirm:'wrong',fixture}})).status,422)
  const seeded=await call('/api/training/synthetic-workspace',{...local,body:{confirm:'happytohelp.synthetic-eval.v1',fixture},status:200})
  assert.equal((await call('/api/training/synthetic-workspace',{...local,body:{confirm:'happytohelp.synthetic-eval.v1',fixture},status:200})).data.already_seeded,true)
  assert.ok(seeded.data.project_id)
  // A lead evaluates the same refund procedure before qualification. Its immutable version,
  // selected model, sandbox evidence and raw provider usage are retained in the case artifact.
  const root=`/api/projects/${p}/procedures/refund/versions`,definition=procedureDefinition()
  const version=(await call(root,{body:definition,status:201})).data
  const procedureRoot=`/api/projects/${p}/procedures`,original=(await call(procedureRoot,{status:200})).data.versions.find(item=>item.id===version.id)
  const revisionInstructions='A revised immutable policy; ask a human to approve the refund.'
  const revision=(await call(root,{body:{...definition,basedOnVersionId:version.id,instructions:revisionInstructions},status:201})).data
  assert.equal(revision.version,version.version+1)
  const versions=(await call(procedureRoot,{status:200})).data.versions
  assert.deepEqual(versions.find(item=>item.id===version.id),original,'saving a revision preserves the original snapshot')
  assert.deepEqual(versions.find(item=>item.id===revision.id).definition,{...original.definition,basedOnVersionId:version.id,instructions:revisionInstructions})
  await call(`${procedureRoot}/another-procedure/versions`,{body:{...definition,basedOnVersionId:version.id},status:409})
  const other=await app.seedWorkspace('procedure-other')
  await call(`/api/projects/${other.projectId}/procedures/refund/versions`,{token:other.tokens.owner,body:{...definition,basedOnVersionId:version.id},status:409})
  ai.respond=body=>body.input?.some(x=>x.type==='function_call_output')?'Please ask a human to review this refund.':openaiToolCall('search_knowledge',{query:'refund'})
  const simulation=(await call(`${root}/${version.id}/simulations`,{body:{},status:201})).data
  await a.run()
  const qualified=(await call(`${runs}/${simulation.id}`,{status:200})).data
  assert.equal(qualified.status,'completed');assert.ok(qualified.cases.every(c=>c.checks.passed&&c.usage));assert.equal(qualified.max_tokens,definition.maxTokens);assert.equal(qualified.max_cost,definition.maxCost)
  const artifact=(await call(`${runs}/${qualified.id}/cases/${qualified.cases[0].id}/artifact`,{status:200})).data
  assert.equal(artifact.procedureVersionId,version.id);assert.equal(artifact.definition.procedure.model,model);assert.ok(artifact.sandbox.receipts.length)
  await call(`${root}/${version.id}/release`,{body:{evaluationId:qualified.id},status:200})
  await call(`${runs}/${qualified.id}`,{token:a.workspace.tokens.operator,status:403})

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
  // Evaluation checks the returned answer, rather than trusting a completed provider status.
  ai.respond=suggesting(suggestion('Do not disclose synthetic-private-customer-data.'))
  const failedCheck=await evaluate([{id:'private-answer',messages:[{role:'contact',content:'Can you help?'}],expected:{must_not_include:['synthetic-private-customer-data']}}])
  assert.equal(failedCheck.status,'completed');assert.equal(failedCheck.cases[0].checks.passed,false)
  assert.ok(failedCheck.cases[0].checks.failures.some(f=>f.check==='must_not_include_per_reply'))
  // A provider that reports no usage leaves the case uncertain with its reservation held; its output stays readable until lost.
  const unreported=value=>{const text=JSON.stringify(value);return new Response([{type:'response.output_text.delta',item_id:'msg',delta:text},{type:'response.output_text.done',item_id:'msg',text},{type:'response.completed',response:{}}].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})}
  ai.respond=body=>unreported(body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:suggestion('Refund policy is available.'))
  const unknown=await evaluate([{id:'unknown',messages:[{role:'contact',content:'Refunds?'}],expected:{min_responses:1}}])
  assert.equal(unknown.status,'uncertain');assert.ok(unknown.reserved_cost>0);assert.equal(unknown.spent_cost,0);assert.match(unknown.cases[0].error,/cost.*not reported/i)
  assert.equal(unknown.cases[0].artifact_available,true);assert.equal((await app.request(`${runs}/${unknown.id}/cases/${unknown.cases[0].id}/artifact`,{token:owner})).status,200)
  // An attempt whose lease expired is uncertain and never replayed.
  const expired=(await call(runs,{body:{request_id:'expired',kind:'evaluation',cases:[{id:'expired',expected:{min_responses:1}}],models:[model],max_cost:2,max_tokens:100},status:201})).data
  const [job]=await app.takeJobs();await app.db.prepare("UPDATE training_runs SET status='running',reserved_cost=2 WHERE id=?").bind(expired.id).run()
  await app.db.prepare("UPDATE training_cases SET status='running',attempt_id='interrupted',started_at=1,lease_expires_at=1 WHERE run_id=?").bind(expired.id).run()
  const before=a.providerCalls();await app.runJobs([job]);assert.equal(a.providerCalls(),before)
  const lapsed=(await call(`${runs}/${expired.id}`,{status:200})).data;assert.equal(lapsed.status,'uncertain');assert.equal(lapsed.reserved_cost,2);assert.match(lapsed.cases[0].error,/lease expired/i)
  // Queued cancellation is persisted and consumes no provider work on redelivery.
  const cancelled=(await call(runs,{body:{request_id:crypto.randomUUID(),kind:'evaluation',cases:[{id:'cancelled',expected:{}}],models:[model],max_cost:2,max_tokens:100},status:201})).data
  const cancelledJobs=await app.takeJobs()
  await call(`${runs}/${cancelled.id}/cancel`,{body:{},status:200})
  await a.run(cancelledJobs);assert.equal((await call(`${runs}/${cancelled.id}`,{status:200})).data.status,'cancelled');assert.equal(a.providerCalls(),before)
  // A run interrupted while planning resumes with the same valid provider budget as a new evaluation.
  await app.db.prepare("INSERT INTO training_runs(id,project_id,operator_id,request_id,kind,status,config,case_count,max_cost,max_tokens,created_at) VALUES('restored',?,?,'restored','evaluation','planning',?,1,?,100,1)").bind(p,a.workspace.users.owner,JSON.stringify({plan:[{id:'restored-case',definition:{id:'restored',messages:[{role:'contact',content:'Can you help with my refund?'}],expected:{}},model,variant:'prototype'}]}),maxCost).run()
  await app.scheduled();const restored=(await call(`${runs}/restored`,{status:200})).data;assert.equal(restored.status,'queued');assert.equal(restored.cases.length,1)
  const recoveredJobs=await app.takeJobs();assert.ok(recoveredJobs.some(job=>job.type==='training'&&job.id==='restored'))
  ai.respond=suggesting(suggestion('Recovered evaluation'));await a.run(recoveredJobs)
  const completed=(await call(`${runs}/restored`,{status:200})).data
  assert.equal(completed.status,'completed',JSON.stringify(completed.cases))
  const unknownCalls=a.providerCalls();await app.scheduled();await a.run();assert.equal(a.providerCalls(),unknownCalls,'terminal uncertain attempts are never automatically replayed')
 }finally{await a.close()}
}
