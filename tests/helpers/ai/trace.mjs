import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'
export async function traceJourney(){
 const a=await assistantApp({prompt:'synthetic-happytohelp-1'}),{app,p,owner,ai}=a
 try{
  const article=(await app.call(`/api/knowledge/${p}/articles`,{token:owner,body:{title:'Refunds',slug:'refunds',content:'Refund within 30 days.',status:'published'},status:201})).data
  let sources,turn=0
  ai.respond=async body=>{
   if(++turn===1)return openaiToolCall('search_knowledge',{query:'refunds'},'search')
   if(turn===2){const issued=await app.first('SELECT source_id,source_version FROM ai_generation_sources WHERE project_id=?',p);sources=[{id:issued.source_id,sourceVersion:issued.source_version}];return openaiToolCall('cite_knowledge',{sources},'cite')}
   return 'Refund within 30 days.'
  }
  const v=await a.visitor();await v.say('Can I get a refund?');await a.run()
  const [generation]=await a.generations(v.conversationId),path=`/api/ai-support/projects/${p}/conversations/${v.conversationId}/trace`
  assert.equal(generation.state,'completed',generation.error)
  const read=async()=>(await app.call(path,{token:owner,status:200})).data
  let trace=(await read()).traces[0]
  assert.equal(trace.generationId,generation.id);assert.equal(trace.assistantVersion.length,64);assert.deepEqual(trace.sources,sources)
  assert.equal(trace.result.messageId,(await v.transcript()).messages.find(m=>m.actor_role==='ai').id)
  assert.equal(trace.result.customerMessageCommitted,true);assert.ok(trace.durationMs>=0);assert.ok(trace.rounds.length>=1)
  const raw=await app.sql('SELECT r.* FROM ai_round_usage r JOIN ai_attempts a ON a.id=r.attempt_id WHERE a.generation_id=?',generation.id)
  assert.deepEqual(trace.rounds.map(r=>r.usage.input_tokens),raw.map(r=>JSON.parse(r.usage_json).input_tokens))
  assert.equal(trace.providerCostEstimateUsd,raw.reduce((n,r)=>n+JSON.parse(r.usage_json).cost,0))
  assert.equal(trace.toolTrace.available,false);assert.equal(trace.procedure.available,false)
  // Opaque metadata and free text can carry credentials; the public trace never serializes them.
  await app.db.prepare("UPDATE ai_round_usage SET usage_json=json_set(usage_json,'$.cost',NULL,'$.authorization','synthetic-happytohelp-2','$.input_tokens','synthetic-happytohelp-3') WHERE attempt_id=?").bind(raw[0].attempt_id).run()
  await app.db.prepare("UPDATE ai_attempts SET error='synthetic-happytohelp-4' WHERE generation_id=?").bind(generation.id).run()
  trace=(await read()).traces[0];assert.equal(trace.providerCostEstimateUsd,null);assert.equal(trace.priceData,'unavailable');assert.equal(trace.rounds[0].usage.input_tokens,null)
  assert.doesNotMatch(JSON.stringify(trace),/synthetic-happytohelp-/)
  ai.reject=true
  const failed=await a.visitor();await failed.say('Please try my question');await a.run()
  const failure=(await app.call(`/api/ai-support/projects/${p}/conversations/${failed.conversationId}/trace`,{token:owner,status:200})).data.traces[0]
  assert.notEqual(failure.state,'completed');assert.equal(failure.result.customerMessageCommitted,false);assert.equal(failure.providerCostEstimateUsd,null)
  await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',1)").bind(p,a.workspace.users.operator).run()
  assert.equal((await app.call(path,{token:a.workspace.tokens.operator})).status,403,'a collaborator cannot read usage traces')
  assert.equal((await app.call(path,{token:v.token})).status,403)
  const foreign=await app.seedWorkspace('trace-foreign');assert.equal((await app.call(path,{token:foreign.tokens.owner})).status,403)
  assert.equal((await app.call(`/api/ai-support/projects/${p}/conversations/${crypto.randomUUID()}/trace`,{token:owner})).status,404)
  await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(p,a.workspace.users.owner).run()
  assert.equal((await app.call(path,{token:owner})).status,401)
 }finally{await a.close()}
}
