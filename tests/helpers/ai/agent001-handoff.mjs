import assert from 'node:assert/strict'
import {openaiToolCall} from '../openai-stream.mjs'
import {socketClient} from '../widget/sockets.mjs'

// Handoff and channel parity through the same public conversation, trace,
// assignment, mailbox and socket doors used by customers and teammates.
export async function agent001Handoff(a){
 const {app,ai,p,owner,workspace}=a
 const dashboard=id=>`/api/dashboard/projects/${p}/conversations/${id}`
 const readTrace=async id=>(await app.call(`/api/ai-support/projects/${p}/conversations/${id}/trace`,{token:owner,status:200})).data
 const article=(await app.call(`/api/knowledge/${p}/articles`,{token:owner,body:{title:'Agent handoff guide',slug:'agent-handoff-guide',content:'Handoffmarker: a teammate reviews the refund request.',status:'published'},status:201})).data
 const ref={id:'article:'+article.id,sourceVersion:(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',article.id)).publication_version}
 const visitor=await a.visitor();let turn=0
 ai.respond=()=>{
  turn++
  if(turn===1)return openaiToolCall('search_knowledge',{query:'handoffmarker'},'handoff-search')
  if(turn===2)return openaiToolCall('cite_knowledge',{sources:[ref]},'handoff-cite')
  if(turn===3)return openaiToolCall('switch_agent',{agent_id:'nonexistent-person'},'failed-handoff')
  return openaiToolCall('switch_agent',{agent_id:'human'},'handoff-human')
 }
 await visitor.say('Please find the policy, then let a person review my request.')
 const jobs=await app.takeJobs(),socketTo=socketClient(app)
 const socket=await socketTo(`/api/conversations/${visitor.conversationId}/socket?token=${visitor.token}`,{Origin:'https://widget.example'})
 assert.equal(socket.status,101)
 let cursor
 try{cursor=(await socket.next(frame=>frame.type==='message')).eventId}finally{socket.socket.close()}
 await a.run(jobs)
 const generation=(await a.generations(visitor.conversationId))[0]
 assert.equal(generation.state,'superseded',generation.error);assert.equal(turn,4)
 const assigned=(await app.first('SELECT assigned_to FROM conversations WHERE id=?',visitor.conversationId)).assigned_to
 assert.equal(assigned,workspace.users.owner)
 assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',visitor.conversationId)).ai_id,null)
 const trace=await readTrace(visitor.conversationId),receipt=trace.traces.find(row=>row.generationId===generation.id)
 assert.equal(trace.generations[0].result,'handoff');assert.equal(trace.generations[0].committedAnswer,null)
 assert.deepEqual(receipt.sources,[ref],'the handoff retains the exact issued source version')
 assert.deepEqual(await app.sql('SELECT source_id id,source_version sourceVersion FROM ai_generation_sources WHERE generation_id=?',generation.id),[ref])
 assert.deepEqual(receipt.toolTrace.calls.map(call=>[call.toolName,call.state]),[['search_knowledge','completed'],['cite_knowledge','completed'],['switch_agent','denied'],['switch_agent','handoff']])
 assert.equal(receipt.toolTrace.calls[2].failureCategory,'unavailable-or-denied')
 assert.equal(receipt.toolTrace.calls[3].responsibleHumanId,assigned)
 assert.ok(receipt.toolTrace.calls.every(call=>!call.businessActionExecuted&&!call.verifiedBusinessResult))
 assert.ok((await visitor.transcript()).messages.some(message=>message.content.includes('let a person')),'the transcript remains readable')
 // Native assignment history and a durable notice must exist, not just an AI trace.
 const buckets=(await app.call(dashboard(visitor.conversationId)+'/buckets',{token:owner,status:200})).data
 assert.ok(buckets.data.flatMap(bucket=>bucket.events).some(event=>event.type==='AGENT_ASSIGNED'&&event.payload.name==='owner ai'&&!event.payload.is_ai))
 await app.scheduled()
 const inbox=async()=>(await app.call(`/api/management/projects/${p}/notification-inbox`,{token:owner,status:200})).data.data.filter(row=>row.conversation_id===visitor.conversationId&&row.kind==='assignment')
 assert.equal((await inbox()).length,1,'the next responsible human receives one native assignment notice')
 await app.configure({})
 const providerCalls=a.providerCalls();await a.run(jobs);await app.scheduled()
 assert.equal(a.providerCalls(),providerCalls);assert.equal((await inbox()).length,1,'restart and handoff-job replay do not transfer or notify twice')
 assert.equal((await app.first('SELECT count(*) n FROM ai_handoff_receipts WHERE generation_id=?',generation.id)).n,1)
 // The offline customer receives the person's answer from their last cursor.
 const current=await visitor.transcript(),human=(await app.call(`/api/conversations/${visitor.conversationId}/messages`,{token:owner,body:{localId:'agent001-human',content:'I am a teammate and will review your refund.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.message
 const reconnect=await socketTo(`/api/conversations/${visitor.conversationId}/socket?token=${visitor.token}&after=${cursor}`,{Origin:'https://widget.example'})
 assert.equal(reconnect.status,101)
 try{
  const caught=await reconnect.next(frame=>frame.type==='message')
  assert.equal(caught.message.id,human.id);assert.equal(caught.message.actor_role,'owner');assert.ok(Number(caught.eventId)>Number(cursor))
  assert.ok(!reconnect.frames.some(frame=>frame.type==='message'&&frame.message.actor_role==='ai'))
 }finally{reconnect.socket.close()}
 // Later customer turns cannot resume AI. Only an explicit operator handback can.
 const count=(await a.generations(visitor.conversationId)).length,before=a.providerCalls()
 await visitor.say('I am still waiting for the person.');await a.run()
 assert.equal((await a.generations(visitor.conversationId)).length,count);assert.equal(a.providerCalls(),before)
 await app.call(`/api/conversations/${visitor.conversationId}/widget-events`,{token:visitor.token,headers:{Origin:'https://widget.example'},body:{action:'assignAi',data:{ai_id:'ai'}},status:409})
 assert.equal((await visitor.transcript()).messages.filter(message=>message.actor_role==='ai').length,0)
 ai.respond=()=>'The assistant has explicitly been resumed.'
 assert.equal((await a.action(visitor.conversationId,'assignAi',{ai_id:'ai'})).status,200)
 assert.equal((await a.action(visitor.conversationId,'assignAi',{ai_id:'ai'})).status,200)
 const resumed=await app.takeJobs();await a.run(resumed);await a.run(resumed)
 assert.equal(a.providerCalls(),before+1);assert.equal((await a.generations(visitor.conversationId)).length,count+1)
 assert.deepEqual((await visitor.transcript()).messages.filter(message=>message.actor_role==='ai').map(message=>message.content),['The assistant has explicitly been resumed.'])

 // Inbound email has no automatic assistant. An operator deliberately assigns
 // one, then its real outbound notification discloses AI and validated sources.
 const mail=[],savedNetwork=ai.network,savedBindings={...app.bindings}
 try{
  ai.network=async request=>{
   assert.equal(new URL(request.url).hostname,'api.resend.com');assert.equal(request.method,'POST')
   mail.push(await request.json());return Response.json({id:'agent001-mail-'+mail.length})
  }
  await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-agent001-mail',EMAIL_FROM:'support@agent001.test',INBOUND_EMAIL_TOKEN:'synthetic-agent001-inbound'})
  await app.call(`/api/management/projects/${p}/email-settings`,{token:owner,method:'PUT',body:{from_name:'Support',from_address:'support@agent001.test',inbound_address:'help@agent001.test',is_enabled:true},status:200})
  const inbound=(await app.call('/api/integrations/email/inbound',{token:'synthetic-agent001-inbound',body:{messageId:'agent001-inbound',to:'help@agent001.test',from:'customer@agent001.test',subject:'Email handoff',text:'Please explain handoffmarker.'},status:201})).data
  const cid=inbound.conversationId
  assert.ok(cid)
  assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',cid))?.ai_id??null,null)
  const calls=a.providerCalls();await a.run()
  assert.equal((await a.generations(cid)).length,0);assert.equal(a.providerCalls(),calls,'email must not acquire a default answerer')
  turn=0;ai.respond=()=>{
   if(++turn===1)return openaiToolCall('search_knowledge',{query:'handoffmarker'},'mail-search')
   if(turn===2)return openaiToolCall('cite_knowledge',{sources:[ref]},'mail-cite')
   return 'A teammate reviews the refund request.'
  }
  assert.equal((await a.action(cid,'assignAi',{ai_id:'ai'})).status,200);await a.run()
  const transcript=async()=>(await app.call(`/api/conversations/${cid}/messages`,{token:owner,status:200})).data
  const answer=(await transcript()).messages.find(message=>message.actor_role==='ai')
  assert.ok(answer);assert.equal(answer.actor_id,'ai')
  const citation=JSON.parse(answer.citations_json)[0],sent=mail.filter(message=>message.headers?.['Auto-Submitted']==='auto-replied'&&JSON.stringify(message.to).includes('customer@agent001.test'))
  assert.equal(sent.length,1,JSON.stringify({mail:mail.map(message=>({subject:message.subject,to:message.to})),deliveries:await app.sql('SELECT state,error FROM email_deliveries WHERE project_id=?',p)}))
  assert.equal(sent[0].headers['Auto-Submitted'],'auto-replied');assert.match(sent[0].text,/This reply was written by an AI assistant\./)
  assert.match(sent[0].html,/This reply was written by an AI assistant\./)
  assert.ok(sent[0].text.includes(citation.title)&&sent[0].text.includes(citation.url))
  assert.ok(sent[0].html.includes(`href="${citation.url}"`));assert.match(sent[0].html,/Agent handoff guide/)
  const generationJobs=[{type:'ai.generate',id:(await a.generations(cid))[0].id,projectId:p}]
  const sentCount=mail.length;await a.run(generationJobs);assert.equal(mail.length,sentCount)
  const latest=await transcript()
  await app.call(`/api/conversations/${cid}/messages`,{token:owner,body:{localId:'agent001-email-person',content:'A person has reviewed your request.',expectedRevision:latest.revision,expectedLastMessageId:latest.lastMessageId},status:200})
  const humanMail=mail.filter(message=>message.text?.includes('A person has reviewed your request.')&&JSON.stringify(message.to).includes('customer@agent001.test')).at(-1)
  assert.equal(humanMail.headers['Auto-Submitted'],'auto-generated')
  assert.doesNotMatch(humanMail.text,/This reply was written by an AI assistant|Agent handoff guide/)
  assert.doesNotMatch(humanMail.html,/This reply was written by an AI assistant|agent-handoff-guide/)
 }finally{
  ai.network=savedNetwork
  await app.configure(Object.fromEntries(['EMAIL_PROVIDER','EMAIL_API_KEY','EMAIL_FROM','INBOUND_EMAIL_TOKEN'].map(key=>[key,savedBindings[key]])))
 }
}
