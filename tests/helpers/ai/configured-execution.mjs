import assert from 'node:assert/strict'
import {assistantApp,model} from './app.mjs'
import {openaiStream,openaiToolCall} from '../openai-stream.mjs'

const trace=async(a,v)=>(await a.app.call(`/api/ai-support/projects/${a.p}/conversations/${v.conversationId}/trace`,{token:a.owner,status:200})).data
const generation=(a,id)=>a.app.call(`/api/ai-support/projects/${a.p}/generations/${id}`,{token:a.owner,status:200}).then(r=>r.data)
const spend=async a=>(await a.app.call(`/api/dashboard/projects/${a.p}/ai-spend`,{token:a.owner,status:200})).data.data
const replies=async v=>(await v.transcript()).messages.filter(m=>m.actor_role==='ai')
const packet=body=>{
 const strings=[]
 const visit=value=>{if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(visit)}
 visit(body.input)
 const text=strings.find(value=>value.startsWith('Scoped customer-reply context:\n'))
 assert.ok(text,'the configured provider receives the native scoped context')
 return JSON.parse(text.slice(text.indexOf('\n')+1))
}

// Continue the existing answering journey, without registering another test. All
// business commands enter native routes; only provider responses are fixtures.
export async function configuredExecutionJourney(){
 await contextAndRounds()
 await toolBounds()
 await dailyBounds()
 await interruptedAttempt()
}

// The pre-existing supported-provider cases call this after their native reply.
export async function assertProviderNormalization(a,v,selectedModel){
 const receipt=(await trace(a,v)).traces.find(t=>t.result.customerMessageCommitted)
 assert.ok(receipt,selectedModel+': a reply was durably committed')
 assert.equal(receipt.rounds.length,1,selectedModel)
 const [round]=receipt.rounds
 assert.equal(round.observed,true,selectedModel)
 assert.equal(round.usage.input_tokens,12,selectedModel);assert.equal(round.usage.output_tokens,4,selectedModel)
 const events=await a.app.sql('SELECT type,event_json FROM ai_attempt_events WHERE attempt_id=? ORDER BY id',round.attemptId)
 for(const type of ['agent_start','cost_update','agent_done','stream_end'])assert.ok(events.some(e=>e.type===type),selectedModel+': '+type)
 const cost=events.filter(e=>e.type==='cost_update').map(e=>JSON.parse(e.event_json)).at(-1)
 assert.equal(cost.request_id,round.requestId,selectedModel)
 assert.equal(cost.usage.model,selectedModel==='claude-haiku-4-5'?'claude-haiku-4-5-20251001':selectedModel)
 assert.equal(cost.usage.input_tokens,12);assert.equal(cost.usage.output_tokens,4)
 const raw=await a.app.first('SELECT usage_json FROM ai_round_usage WHERE attempt_id=? AND request_id=?',round.attemptId,round.requestId)
 assert.deepEqual(JSON.parse(raw.usage_json),cost.usage,selectedModel+': raw round usage survives normalization')
}

async function contextAndRounds(){
 const a=await assistantApp(),{app,ai,p}=a
 try{
  const v=await a.visitor(),old='older-evidence '+'.'.repeat(60000),recent='newest-evidence '+'.'.repeat(60000)
  await v.say(old);await v.say(recent)
  ai.respond=body=>{
   assert.equal(body.model,model,'the saved assistant model reaches the provider')
   const context=packet(body),entries=context.evidence.conversation
   assert.equal(entries.length,2)
   assert.equal(entries.reduce((sum,e)=>sum+e.content.length,0),96*1024)
   assert.equal(entries.at(-1).content,recent,'the newest customer evidence is retained in full')
   assert.equal(entries[0].content_truncated,true)
   assert.equal(entries[0].content_total_chars,old.length)
   assert.deepEqual(entries[0].full_entry_retrieval,{tool:'read_conversation_entry',evidence_id:entries[0].evidence_id})
   return openaiStream('A bounded configured reply.',{input_tokens:31,output_tokens:7})
  }
  await a.run()
  const [answer]=await replies(v);assert.equal(answer.content,'A bounded configured reply.')
  const receipt=(await trace(a,v)).traces.find(t=>t.result.messageId===answer.id)
  assert.equal(receipt.rounds.length,1)
  assert.deepEqual(receipt.rounds.map(r=>[r.observed,r.usage.input_tokens,r.usage.output_tokens]),[[true,31,7]])
  // Inspect the durable normalization produced by the route/queue execution,
  // not private provider events exposed to an operator or customer.
  const events=await app.sql('SELECT type,event_json FROM ai_attempt_events WHERE attempt_id=? ORDER BY id',receipt.attempts[0].attemptId)
  for(const type of ['agent_start','cost_update','agent_done','stream_end'])assert.ok(events.some(e=>e.type===type),type+' is normalized and retained')
  const cost=events.filter(e=>e.type==='cost_update').map(e=>JSON.parse(e.event_json)).at(-1)
  assert.equal(cost.request_id,receipt.rounds[0].requestId)
  assert.equal(cost.usage.input_tokens,31);assert.equal(cost.usage.output_tokens,7)
  const raw=await app.first('SELECT usage_json FROM ai_round_usage WHERE attempt_id=? AND request_id=?',receipt.attempts[0].attemptId,cost.request_id)
  assert.deepEqual(JSON.parse(raw.usage_json),cost.usage,'the normalized round usage is preserved without aggregate substitution')
  const before=a.providerCalls();await a.run([{type:'ai.generate',id:receipt.generationId,projectId:p}])
  assert.equal(a.providerCalls(),before);assert.equal((await replies(v)).length,1)

  // Suggestions have two separately metered provider rounds and remain drafts.
  const evidence='message:'+answer.id
  ai.respond=body=>openaiStream(body.text?.format?.name==='agent_suggestion_alternatives'
   ?{alternatives:[],missing_information:[]}
   :{user_goal:'Clarify the answer',responses:[{button:'Clarify',icon:'circle-question-mark',response:'An operator-reviewed suggestion.',use_when:'',evidence_ids:[evidence]}],missing_information:[]},
   {input_tokens:body.text?.format?.name==='agent_suggestion_alternatives'?41:23,output_tokens:3})
  const request=await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}})
  assert.equal(request.status,202);await a.run()
  const suggestion=await generation(a,request.data.id);assert.equal(suggestion.state,'completed',suggestion.error)
  assert.equal(JSON.parse(suggestion.output_json).result.responses[0].response,'An operator-reviewed suggestion.')
  const draft=(await trace(a,v)).traces.find(t=>t.generationId===request.data.id)
  assert.equal(draft.result.customerMessageCommitted,false)
  assert.equal(new Set(draft.rounds.map(r=>r.requestId)).size,2)
  assert.deepEqual(draft.rounds.map(r=>r.usage.input_tokens).sort((x,y)=>x-y),[23,41])
  assert.ok(draft.rounds.every(r=>r.observed&&r.usage.output_tokens===3))
  assert.equal((await replies(v)).length,1,'a suggestion never sends a customer message')

  await app.configure({OPENAI_API_KEY:undefined})
  const missing=await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}})
  assert.equal(missing.status,503);assert.match(JSON.stringify(missing.data),/CONFIGURATION_REQUIRED/)
  const noKey=await a.visitor();await noKey.say('Please help');await a.run()
  assert.equal((await trace(a,noKey)).generations.length,0,'a keyless default assistant creates no paid work')
  assert.equal((await replies(noKey)).length,0);assert.equal(a.providerCalls(),before+2)
 }finally{await a.close()}
}

async function toolBounds(){
 const a=await assistantApp(),{ai}=a
 try{
  // Repeated tools reach the four-round limit without another provider round.
  let rounds=0
  ai.respond=()=>openaiToolCall('read_conversation_history',{before_revision:0},'round-'+(++rounds))
  const v=await a.visitor();await v.say('Read the conversation history');await a.run()
  const receipt=(await trace(a,v)).traces[0]
  assert.equal(rounds,4);assert.equal(receipt.toolTrace.calls.length,4)
  assert.ok(receipt.toolTrace.calls.every(t=>t.state==='completed'))
  assert.equal(receipt.state,'uncertain');assert.equal((await replies(v)).length,0)
  assert.match((await generation(a,receipt.generationId)).error,/Tool call rounds limit reached \(4\)/)
  // A single provider round requesting nine calls executes at most eight.
  ai.respond=()=>{
   const output=Array.from({length:9},(_,i)=>({id:'fc-'+i,type:'function_call',call_id:'call-'+i,name:'read_conversation_history',arguments:'{"before_revision":0}'}))
   const events=output.flatMap(item=>[{type:'response.output_item.added',item:{...item,arguments:''}},{type:'response.function_call_arguments.done',item_id:item.id,arguments:item.arguments}])
   events.push({type:'response.completed',response:{output,usage:{input_tokens:5,output_tokens:2,total_tokens:7,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}}})
   return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})
  }
  const many=await a.visitor();await many.say('Read several history windows');const before=a.providerCalls();await a.run()
  const bounded=(await trace(a,many)).traces[0]
  assert.equal(a.providerCalls(),before+1);assert.equal(bounded.toolTrace.calls.length,8)
  assert.equal(bounded.state,'uncertain');assert.equal((await replies(many)).length,0)
  assert.match((await generation(a,bounded.generationId)).error,/Tool call limit reached \(8\)/)
 }finally{await a.close()}
}

async function dailyBounds(){
 // Each setting is installation configuration, exercised independently. The
 // unknown-price case must stay unknown rather than becoming a zero-dollar bill.
 for(const limits of [{repliesPerProject:1},{repliesPerInstallation:1},{spendUsdPerProject:0.000001}]){
  const priced='spendUsdPerProject' in limits
  const a=await assistantApp({assistantModel:priced?'gpt-4.1-mini':model,bindings:{AI_DAILY_CEILINGS:JSON.stringify(limits)}})
  try{
   const v=await a.visitor();await v.say('First allowed reply');await a.run();assert.equal((await replies(v)).length,1)
   const before=a.providerCalls();await v.say('Keep this request for a teammate')
   const skipped=(await trace(a,v)).traces.find(t=>t.state==='failed');assert.ok(skipped)
   const row=await generation(a,skipped.generationId)
   assert.match(row.error,new RegExp('AI_REPLY_CEILING:.*'+Object.keys(limits)[0]))
   assert.equal(skipped.attempts.length,0)
   const usage=await spend(a)
   assert.equal(usage.automatic.replyCeilingReached,true);assert.equal(usage.automatic.skippedReplies,1)
   if(priced)assert.ok(usage.automatic.spendUsd.used>=limits.spendUsdPerProject)
   else assert.equal(usage.spend.knownUsd,null,'unpriced provider usage stays unknown')
   // Restart with raised limits. The old terminal decision never becomes work,
   // even when cron and the queue see it again after a configuration change.
   await a.app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:200,repliesPerInstallation:2000,spendUsdPerProject:10})})
   await a.app.scheduled();await a.run();await a.run([{type:'ai.generate',id:skipped.generationId,projectId:a.p}])
   assert.equal(a.providerCalls(),before);assert.equal((await generation(a,skipped.generationId)).state,'failed')
   assert.equal((await replies(v)).length,1)
   assert.ok((await v.transcript()).messages.some(m=>m.content==='Keep this request for a teammate'))
  }finally{await a.close()}
 }
}

async function interruptedAttempt(){
 const a=await assistantApp(),{app,ai}=a
 let release
 try{
  const v=await a.visitor();await v.say('Please answer once')
  const jobs=await app.takeJobs()
  let reached
  const dispatched=new Promise(resolve=>{reached=resolve}),blocked=new Promise(resolve=>{release=resolve})
  ai.respond=async()=>{reached();await blocked;return 'An answer lost with the old worker'}
  const running=app.runJobs(jobs).catch(()=>null)
  await dispatched
  // Terminate the actual Worker while its only fake (the network) is pending.
  // Real D1 state survives; no application or storage state is fabricated.
  await app.configure({});release();await running
  const unfinished=(await trace(a,v)).traces[0]
  assert.equal(unfinished.state,'running');assert.equal(unfinished.attempts[0].state,'running')
  const before=a.providerCalls();ai.respond=()=>'This replay must never be requested'
  await a.run(jobs);await app.configure({});await app.scheduled({'x-test-clock':'advance'},{after:300000});await a.run();await a.run(jobs)
  const recovered=(await trace(a,v)).traces[0]
  assert.equal(recovered.state,'uncertain');assert.equal(recovered.attempts[0].state,'uncertain')
  assert.equal(recovered.attempts.length,1);assert.equal(a.providerCalls(),before);assert.equal((await replies(v)).length,0)
  // A completed HTTP attempt whose stream disappears is likewise ambiguous.
  ai.respond=()=>new Response(new ReadableStream({start(controller){controller.error(new Error('Provider connection disappeared after dispatch'))}}),{headers:{'content-type':'text/event-stream'}})
  const ambiguous=await a.visitor();await ambiguous.say('Another question');const ambiguousJobs=await app.takeJobs(),calls=a.providerCalls()
  await a.run(ambiguousJobs);await app.configure({});await app.scheduled();await a.run();await a.run(ambiguousJobs)
  const unknown=(await trace(a,ambiguous)).traces[0]
  assert.equal(unknown.state,'uncertain');assert.equal(unknown.attempts.length,1)
  assert.equal(a.providerCalls(),calls+1);assert.equal((await replies(ambiguous)).length,0)
 }finally{release?.();await a.close()}
}
