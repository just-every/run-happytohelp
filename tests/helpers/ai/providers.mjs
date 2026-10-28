import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'

const keys={ANTHROPIC_API_KEY:'sk-ant-fixture',GOOGLE_API_KEY:'google-fixture',DEEPSEEK_API_KEY:'sk-fixture',XAI_API_KEY:'xai-fixture',OPENROUTER_API_KEY:'sk-fixture'}

// The visitor's assistant answers through each supported provider protocol with its usage recorded,
// and a refused paid attempt is never replayed.
export async function providersJourney(a){
 const {app,ai,p,owner}=a
 await app.configure(keys);ai.network=null
 try{
  for(const model of ['claude-haiku-4-5','gemini-3.5-flash-lite','deepseek-v4-flash','grok-4.3','meta-llama/llama-4-maverick']){
   await app.call(`/api/management/projects/${p}/ais/ai`,{token:owner,method:'PUT',body:{model},status:200})
   const v=await a.visitor();await v.say('Which plan fits me?');await a.run()
   const [answer]=await a.generations(v.conversationId);assert.equal(answer.state,'completed',model+': '+answer.error)
   assert.deepEqual((await v.transcript()).messages.filter(m=>m.actor_role==='ai').map(m=>m.content),['Provider fixture answer'],model)
   const usage=JSON.parse(answer.output_json).usage;assert.equal(usage.input_tokens,12,model);assert.equal(usage.output_tokens,4,model)
   // A refusal is one attempt: the generation records it and redelivery calls nobody.
   ai.reject=true;const refused=await a.visitor();await refused.say('And now?');const jobs=await app.takeJobs(),before=a.providerCalls()
   await a.run(jobs);assert.equal(a.providerCalls()-before,1,model+' must not replay a paid attempt');await a.run(jobs);assert.equal(a.providerCalls()-before,1)
   assert.notEqual((await a.generations(refused.conversationId))[0].state,'completed');ai.reject=false
  }
 }finally{ai.reject=false;await app.call(`/api/management/projects/${p}/ais/ai`,{token:owner,method:'PUT',body:{model:'gpt-5.6-luna'},status:200})}
}
