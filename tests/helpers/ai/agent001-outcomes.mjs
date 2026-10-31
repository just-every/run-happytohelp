import assert from 'node:assert/strict'
import {openaiToolCall} from '../openai-stream.mjs'
import {socketClient} from '../widget/sockets.mjs'
import {agent001Handoff} from './agent001-handoff.mjs'

const names=body=>(body.tools||[]).map(tool=>tool.name)
const answers=async v=>(await v.transcript()).messages.filter(message=>message.actor_role==='ai')
const evidence=async(a,v)=>(await a.app.call(`/api/ai-support/projects/${a.p}/conversations/${v.conversationId}/trace`,{token:a.owner,status:200})).data
const output=(body,id)=>JSON.parse(body.input.find(item=>item.type==='function_call_output'&&item.call_id==='call-'+id).output)

// AGENT-001's remaining customer outcomes share the real queue/admission doors.
// Only model responses and mail transport are faked; every visitor is independent.
export async function agent001Outcomes(a){
 const {app,ai,p,owner}=a,saved={respond:ai.respond,network:ai.network,before:ai.before}
 try{
  let turn=0
  ai.respond=body=>{
   if(++turn===1)return openaiToolCall('search_knowledge',{query:'zqxunanswerablemarker'},'no-evidence')
   assert.deepEqual(output(body,'no-evidence'),[],'an empty search issues no evidence')
   return 'I cannot find approved guidance. Please ask a teammate.'
  }
  const empty=await a.visitor();await empty.say('What is zqxunanswerablemarker?');await a.run()
  const emptyAnswers=await answers(empty);assert.equal(emptyAnswers.length,1)
  assert.match(emptyAnswers[0].content,/cannot find approved guidance/);assert.deepEqual(JSON.parse(emptyAnswers[0].citations_json),[])
  const emptyTrace=await evidence(a,empty)
  assert.deepEqual(emptyTrace.traces[0].sources,[]);assert.deepEqual(emptyTrace.generations[0].source.knowledge,[])
  assert.equal(emptyTrace.traces[0].toolTrace.calls[0].state,'completed')
  // Chat attribution is the exact public data consumed by transport + ChatHeader.
  const settings=(await app.call(`/api/widget/settings?widgetKey=${a.workspace.widgetKey}`,{headers:{Origin:'https://widget.example'},status:200})).data
  assert.equal(emptyAnswers[0].actor_role,'ai');assert.ok(settings.ais.some(profile=>profile.id===emptyAnswers[0].actor_id))

  // An offered history reader cannot read another customer's message, even in
  // the same workspace. No foreign body appears in model context or the answer.
  ai.respond=()=>'A private response'
  const other=await a.visitor();const secret='Foreignconversationmarker: private order 7823'
  const foreignMessage=(await other.say(secret)).message;await a.run()
  turn=0;ai.respond=body=>{
   assert.doesNotMatch(JSON.stringify(body.input),/Foreignconversationmarker|private order 7823/)
   if(++turn===1)return openaiToolCall('read_conversation_entry',{evidence_id:'message:'+foreignMessage.id,start_offset:0},'foreign-entry')
   assert.deepEqual(output(body,'foreign-entry'),{found:false})
   return 'That conversation is unavailable.'
  }
  const isolated=await a.visitor();await isolated.say('Read message '+foreignMessage.id);await a.run()
  assert.equal((await answers(isolated)).length,1)
  assert.doesNotMatch(JSON.stringify(await isolated.transcript()),/Foreignconversationmarker|private order 7823/)
  assert.deepEqual(JSON.parse((await answers(isolated))[0].citations_json),[])
  const denied=(await evidence(a,isolated)).traces[0]
  assert.equal(denied.toolTrace.calls[0].toolName,'read_conversation_entry');assert.equal(denied.toolTrace.calls[0].state,'denied')
  assert.equal(denied.toolTrace.calls[0].failureCategory,'unavailable-or-denied')

  // No customer business-action tool exists. Even a forged invocation cannot
  // change the ticket, create a proposal or publish a claimed completed action.
  for(const tool of ['issue_refund','propose_knowledge_change']){
   const visitor=await a.visitor(),before=await app.first('SELECT assigned_to,status_id,priority FROM conversations WHERE id=?',visitor.conversationId)
   const proposals=(await app.first('SELECT count(*) n FROM knowledge_proposals')).n
   let calls=0
   ai.respond=body=>{
    assert.ok(!names(body).includes(tool));calls++
    return calls===1?openaiToolCall(tool,{amount:100,content:'Unauthorized proposal'},'unoffered'):'Your refund and knowledge change are completed.'
   }
   await visitor.say('Refund and change the policy');const jobs=await app.takeJobs();await a.run(jobs)
   assert.deepEqual(await app.first('SELECT assigned_to,status_id,priority FROM conversations WHERE id=?',visitor.conversationId),before)
   assert.equal((await app.first('SELECT count(*) n FROM knowledge_proposals')).n,proposals)
   assert.equal((await answers(visitor)).length,0,'an unoffered action must not yield a success claim')
   assert.equal(calls,1,'an unoffered call stops before another provider turn')
   const trace=await evidence(a,visitor)
   assert.ok(!trace.traces[0].toolTrace.calls.some(call=>call.state==='completed'))
   assert.equal(trace.traces[0].failureCategory,'denied')
   const providerCalls=a.providerCalls();await a.run(jobs);assert.equal(a.providerCalls(),providerCalls)
  }

  // An operator takeover, or a new request for a person, while the next tool
  // response is in flight fences that old generation before the tool executes.
  for(const intervention of ['operator','customer']){
   const visitor=await a.visitor();let round=0,intervened=false
   ai.respond=()=>++round===1?openaiToolCall('search_knowledge',{query:'refund'},'before-takeover'):openaiToolCall('cite_knowledge',{sources:[]},'after-takeover')
   ai.before=async()=>{
    if(round!==1||intervened)return
    intervened=true
    if(intervention==='operator')await app.call(`/api/dashboard/projects/${p}/conversations/${visitor.conversationId}`,{token:owner,method:'PUT',body:{agent_id:a.workspace.users.admin},status:200})
    else await visitor.say('Stop. I need a human now.')
   }
   await visitor.say('Search the refund policy');const jobs=await app.takeJobs();await a.run(jobs);ai.before=null
   const generation=(await a.generations(visitor.conversationId))[0]
   assert.ok(['cancelled','superseded'].includes(generation.state),generation.error)
   assert.equal((await answers(visitor)).length,0)
   const trace=(await evidence(a,visitor)).traces.find(item=>item.generationId===generation.id)
   assert.deepEqual(trace.toolTrace.calls.map(call=>call.toolName),['search_knowledge'],'no later tool runs after authority changes')
   assert.equal(trace.failureCategory,generation.state==='cancelled'?null:'authority-changed')
   const beforeReplay=a.providerCalls();await a.run(jobs);assert.equal(a.providerCalls(),beforeReplay)
   if(intervention==='customer'){
    ai.respond=()=>openaiToolCall('switch_agent',{agent_id:'human'},'requested-person');await a.run()
    assert.ok((await app.first('SELECT assigned_to FROM conversations WHERE id=?',visitor.conversationId)).assigned_to)
    assert.equal((await answers(visitor)).length,0)
   }
  }

  // A lost customer-reply connection is terminal even if text began streaming,
  // or a search already completed. Socket clients never receive partial text.
  for(const stage of ['stream','after-search']){
   const visitor=await a.visitor(),socket=await socketClient(app)(`/api/conversations/${visitor.conversationId}/socket?token=${visitor.token}`,{Origin:'https://widget.example'})
   assert.equal(socket.status,101)
   try{
    let round=0
    ai.respond=()=>{
     if(stage==='after-search'&&++round===1)return openaiToolCall('search_knowledge',{query:'refund'},'before-disconnect')
     if(stage==='after-search')throw new DOMException('Provider connection lost between tools','TimeoutError')
     let sent=false
     return new Response(new ReadableStream({pull(controller){
      if(sent){controller.error(new DOMException('Provider connection dropped after start','TimeoutError'));return}
      sent=true;controller.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: '+JSON.stringify({type:'response.output_text.delta',item_id:'partial',delta:'Uncommitted partial answer'})+'\n\n'))
     }}),{headers:{'content-type':'text/event-stream'}})
    }
    await visitor.say('Help me before the connection drops');const jobs=await app.takeJobs(),before=a.providerCalls()
    await a.run(jobs);await a.run(jobs)
    assert.equal(a.providerCalls()-before,stage==='stream'?1:2,'redelivery never replays a paid attempt')
    const generation=(await a.generations(visitor.conversationId))[0]
    assert.equal(generation.state,'uncertain',generation.error)
    assert.equal((await answers(visitor)).length,0)
    const trace=await evidence(a,visitor)
    assert.ok(['timeout','unknown'].includes(trace.generations[0].providerOutcome));assert.equal(trace.generations[0].committedAnswer,null)
    assert.ok(['timeout','provider-or-runtime-error'].includes(trace.traces[0].failureCategory));assert.equal(trace.traces[0].attempts.length,1)
    assert.ok(!socket.frames.some(frame=>frame.type==='chunk'||frame.type==='message'&&frame.message.actor_role==='ai'))
   }finally{socket.socket.close()}
  }
  await agent001Handoff(a)
 }finally{Object.assign(ai,saved)}
}
