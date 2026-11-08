import assert from 'node:assert/strict'
import {assistantApp,model} from './app.mjs'
import {openaiStream,openaiToolCall} from '../openai-stream.mjs'
import {proactiveReplyModes,replyModeMailHolds} from './reply-mode-followups.mjs'

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
 await privateNoteFrontier()
 await replyModes()
 await proactiveReplyModes()
 await replyModeMailHolds()
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
  await a.run(jobs);await app.configure({});await app.scheduled({'x-test-clock':'advance'},{after:240001});await a.run();await a.run(jobs)
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


// Retain the candidate's private-note admission assertion in the current
// configured generation journey, where the consolidated tests run it.
async function privateNoteFrontier(){
 const a=await assistantApp(),{app,ai,p,owner}=a
 try{
  const visitor=await a.visitor()
  ai.before=()=>app.call('/api/dashboard/projects/'+p+'/conversations/'+visitor.conversationId+'/notes',{token:owner,body:{content:'New private fact'},status:201})
  await visitor.say('Answer after reviewing the current private facts')
  await a.run()
  const rows=await a.generations(visitor.conversationId)
  assert.equal(rows.at(-1).state,'superseded','a private note supersedes the old captured context')
  assert.equal((await replies(visitor)).length,0,'the superseded private-note frontier admits no customer answer')
 }finally{await a.close()}
}

// The workspace's AI reply mode, set by the owner through the AI route: draft keeps every AI word
// with the team (operator drafts still work), off makes no model call, and switching back to auto
// releases nothing from the draft period while the visitor's next message is answered again.
export async function replyModes(){
 const a=await assistantApp(),{app,ai,p,owner,workspace}=a,route=`/api/management/projects/${p}/ai`
 const mode=async()=>(await app.call(route,{token:owner,status:200})).data.data.ai_reply_mode
 const setMode=value=>app.call(route,{token:owner,method:'PUT',body:{ai_reply_mode:value},status:200})
 try{
  assert.equal(await mode(),'auto','a workspace that never chose a mode replies automatically')
  for(const value of ['Draft','',' draft','manual',1,null,true])await app.call(route,{token:owner,method:'PUT',body:{ai_reply_mode:value,default_visitor_ai_id:'-'},status:400})
  await app.call(route,{token:workspace.tokens.operator,method:'PUT',body:{ai_reply_mode:'draft'},status:403})
  assert.equal(await mode(),'auto');assert.equal((await app.call(route,{token:owner,status:200})).data.data.assistant?.id,'ai','a refused body writes none of its keys')
  // Real concurrent PUTs across every settings writer preserve both owners' fields,
  // including JSON booleans, null defaults and the nested widget object.
  const base=`/api/management/projects/${p}`
  for(const [path,body,key,expected] of [
   ['settings',{timezone:'Pacific/Auckland',proactive_help_enabled:true},'timezone','Pacific/Auckland'],
   ['widget-settings',{theme:{color:'#123456'}},'widget_settings',{theme:{color:'#123456'}}],
   ['availability',{is_availability_schedule_enabled:false,is_presence_away_enabled:true,presence_idle_minutes:10},'is_presence_away_enabled',true],
   ['ai',{default_verified_user_ai_id:'-'},'default_verified_user_ai_id',null],
  ]){
   await Promise.all([setMode('off'),app.call(`${base}/${path}`,{token:owner,method:'PUT',body,status:200})])
   assert.equal(await mode(),'off',path+' cannot restore the earlier mode')
   const saved=(await app.call(base+'/settings',{token:owner,status:200})).data.data
   const field=key==='widget_settings'?(await app.call(base+'/widget-settings',{token:owner,status:200})).data.settings:saved[key]
   assert.deepEqual(field,expected,path+' survives the concurrent mode write')
   assert.equal((await app.call(route,{token:owner,status:200})).data.data.assistant?.id,'ai','unrelated defaults survive')
   await setMode('auto')
  }
  // Independently saved general fields also survive each other.
  await Promise.all(['brand_name','welcome_message'].map(key=>app.call(base+'/settings',{token:owner,method:'PUT',body:{[key]:'Concurrent '+key},status:200})))
  const saved=(await app.call(base+'/settings',{token:owner,status:200})).data.data
  assert.equal(saved.brand_name,'Concurrent brand_name');assert.equal(saved.welcome_message,'Concurrent welcome_message')
  const modeEvents=async()=>(await app.call(base+'/audit?category=data&limit=50',{token:owner,status:200})).data.data.filter(e=>e.action==='ai.reply_mode_changed')
  const previousEvents=(await modeEvents()).length
  assert.equal(previousEvents,8,'each concurrent off/auto transition is audited once, including retries')
  // A reply queued in auto, then the switch: it never reaches the provider.
  const v=await a.visitor();await v.say('Queued before the switch');const queued=await app.takeJobs()
  await setMode('draft');assert.equal(await mode(),'draft')
  const before=a.providerCalls();await a.run(queued)
  assert.equal(a.providerCalls(),before);assert.deepEqual((await a.generations(v.conversationId)).map(g=>g.state),['cancelled'])
  const events=(await app.call(`/api/management/projects/${p}/audit?category=data&limit=50`,{token:owner,status:200})).data.data.filter(e=>e.action==='ai.reply_mode_changed')
  assert.equal(events.length,previousEvents+1);assert.deepEqual(events[0].detail,{from:'auto',to:'draft'});await setMode('draft')
  assert.equal((await modeEvents()).length,previousEvents+1,'saving the same mode records nothing')
  // In draft a visitor's message to the assistant earns no generation, no provider call and no AI message.
  await v.say('Written in draft');await a.run();await app.scheduled();await a.run()
  assert.equal(a.providerCalls(),before);assert.equal((await a.generations(v.conversationId)).length,1);assert.equal((await replies(v)).length,0)
  await app.call(`/api/conversations/${v.conversationId}/widget-events`,{token:v.token,headers:{Origin:'https://widget.example'},body:{action:'request',data:{requestId:crypto.randomUUID()}},status:409})
  // Operator drafts keep working and stay drafts.
  const evidence='message:'+(await v.transcript()).messages.at(-1).id
  ai.respond=body=>openaiStream(body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:{user_goal:'Answer',responses:[{button:'Answer',icon:'circle-question-mark',response:'A draft for the team.',use_when:'',evidence_ids:[evidence]}],missing_information:[]},{input_tokens:5,output_tokens:2})
  const draft=await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}});assert.equal(draft.status,202,JSON.stringify(draft.data));await a.run()
  const drafted=await generation(a,draft.data.id);assert.equal(drafted.state,'completed',drafted.error);assert.equal(JSON.parse(drafted.output_json).result.responses[0].response,'A draft for the team.');assert.ok(a.providerCalls()>before)
  assert.equal((await replies(v)).length,0,'a draft never reaches the visitor')
  // Back to auto: nothing from before or during draft is answered, even by recovery; the next message is.
  await setMode('auto');ai.respond=()=>'Answered after the switch back'
  const afterDraft=a.providerCalls();await a.run(queued);await app.scheduled();await a.run()
  assert.equal(a.providerCalls(),afterDraft);assert.equal((await replies(v)).length,0)
  await v.say('Written after the switch back');await a.run()
  assert.deepEqual((await replies(v)).map(m=>m.content),['Answered after the switch back'])
  // Off: no drafts either.
  await setMode('off');const calls=a.providerCalls()
  const refused=await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}});assert.equal(refused.status,409)
  await v.say('Written while off');await a.run();assert.equal(a.providerCalls(),calls);assert.equal((await replies(v)).length,1)
  // Only the mode route writes the mode: a mode change fired together with concurrent whole-settings saves
  // (workspace settings, widget settings, availability and a defaults-only AI save) is never undone.
  const widget=(await app.call(`${base}/widget-settings`,{token:owner,status:200})).data.settings
  const since=async()=>(await app.first("SELECT json_extract(settings_json,'$.ai_reply_mode_since') since FROM project_settings WHERE project_id=?",p)).since
  const newestChange=async()=>(await app.call(`${base}/audit?category=data&limit=50`,{token:owner,status:200})).data.data.find(e=>e.action==='ai.reply_mode_changed').detail
  let previousSince=0
  for(let round=0;round<8;round++){
   const target=round%2?'auto':'draft',saves=[]
   for(let k=0;k<4;k++)saves.push(
    ()=>app.call(`${base}/settings`,{token:owner,method:'PUT',body:{unavailable_message:`Away ${round}.${k}`},status:200}),
    ()=>app.call(`${base}/widget-settings`,{token:owner,method:'PUT',body:widget,status:200}),
    ()=>app.call(`${base}/availability`,{token:owner,method:'PUT',body:{is_availability_schedule_enabled:false},status:200}),
    ()=>app.call(route,{token:owner,method:'PUT',body:{default_visitor_ai_id:'ai'},status:200}))
   const changed=Math.floor(saves.length/2),calls=saves.map(save=>save());calls.splice(changed,0,setMode(target))
   await Promise.all(calls)
   const stamp=await since()
   assert.equal(await mode(),target,`round ${round}: a concurrent save never restores the earlier mode`)
   assert.deepEqual(await newestChange(),{from:round?(round%2?'draft':'auto'):'off',to:target},`round ${round}: the security log's newest mode change is the mode in effect`)
   assert.ok(Number.isFinite(stamp)&&stamp>previousSince,`round ${round}: the switch time is the new switch's own`);previousSince=stamp
  }
  // Every save still stores its own values, and leaves the mode and its switch time as they are.
  const stamp=await since()
  assert.equal((await app.call(`${base}/settings`,{token:owner,method:'PUT',body:{unavailable_message:'Back soon'},status:200})).data.data.unavailable_message,'Back soon')
  await app.call(`${base}/widget-settings`,{token:owner,method:'PUT',body:{...widget,greeting:'Hello'},status:200})
  await app.call(`${base}/availability`,{token:owner,method:'PUT',body:{is_availability_schedule_enabled:false,presence_idle_minutes:30},status:200})
  await app.call(route,{token:owner,method:'PUT',body:{ai_reply_mode:'auto',default_visitor_ai_id:'ai'},status:200})
  const stored=JSON.parse((await app.first('SELECT settings_json FROM project_settings WHERE project_id=?',p)).settings_json)
  assert.equal(stored.unavailable_message,'Back soon');assert.equal(stored.widget_settings.greeting,'Hello');assert.equal(stored.presence_idle_minutes,30);assert.equal(stored.default_visitor_ai_id,'ai')
  assert.equal(stored.ai_reply_mode,'auto');assert.equal(stored.ai_reply_mode_since,stamp,'saving the mode in effect keeps its switch time')
 }finally{await a.close()}
}
