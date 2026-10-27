import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'

const evidence=body=>JSON.stringify(body).match(/message:[0-9a-f-]{36}/)?.[0]
const card=(button,response,body)=>({button,icon:'circle-question-mark',response,use_when:'',evidence_ids:[evidence(body)]})

// Operator assistance: suggestions and draft tools never send, run once per request id, and fail whole;
// handing a waiting conversation back to the assistant answers its turn once, within ceilings and authority.
export async function assistanceJourney(){
 const a=await assistantApp(),{app,ai,p}=a
 const assist=(conversationId,options={})=>a.action(conversationId,'agentAssist',{options})
 const generation=id=>app.call(`/api/ai-support/projects/${p}/generations/${id}`,{token:a.owner,status:200}).then(result=>result.data)
 const humanTurn=async text=>{const v=await a.visitor();assert.equal((await a.action(v.conversationId,'assignAi',{ai_id:null})).status,200);await app.takeJobs();if(text){await v.say(text);assert.deepEqual(await app.takeJobs(),[],'a person\'s conversation is not answered')}return v}
 try{
  // Without a customer message there is nothing to suggest: refused before any queue, attempt or provider call.
  const empty=await humanTurn(),refused=await assist(empty.conversationId,{request_id:crypto.randomUUID()})
  assert.ok(refused.status>=400)
  assert.deepEqual(await a.generations(empty.conversationId),[]);assert.deepEqual(await app.takeJobs(),[]);assert.equal(a.providerCalls(),0)
  // A draft tool works on the operator's own text even then, and never sends.
  ai.respond=()=>({user_goal:'Improve',responses:[{button:'Improved',icon:'circle-question-mark',response:'An improved draft.',use_when:'',evidence_ids:[]}],missing_information:[]})
  const draft=await assist(empty.conversationId,{request_id:crypto.randomUUID(),tool:'improve',message:'Unsent draft'});assert.equal(draft.status,202,JSON.stringify(draft.data))
  await a.run();assert.match(JSON.stringify(ai.calls.at(-1).body),/Unsent draft/);assert.equal((await empty.transcript()).messages.length,0)

  // Suggestions: one generation per request id, a primary card plus alternatives citing the customer's message, two usage rounds.
  const v=await humanTurn('How do I cancel my order?'),requestId=crypto.randomUUID()
  const first=await assist(v.conversationId,{request_id:requestId}),repeat=await assist(v.conversationId,{request_id:requestId})
  assert.equal(first.status,202);assert.equal(repeat.data.id,first.data.id);const jobs=await app.takeJobs();assert.equal(jobs.length,1,'a repeated request id never queues twice')
  ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[card('After cancelling','You will get a confirmation email.',body),card('Refund','Refunds follow within five days.',body)],missing_information:[]}:{user_goal:'Cancel an order',responses:[card('Cancel','Open Orders and choose Cancel.',body)],missing_information:[]}
  await a.run(jobs);const suggested=await generation(first.data.id);assert.equal(suggested.state,'completed')
  const responses=JSON.parse(suggested.output_json).result.responses;assert.equal(responses.length,3);assert.ok(responses.every(response=>/^message:/.test(response.evidence_ids[0])))
  assert.equal((await app.first('SELECT COUNT(*) n FROM ai_round_usage u JOIN ai_attempts t ON t.id=u.attempt_id WHERE t.generation_id=?',first.data.id)).n,2)
  assert.equal((await v.transcript()).messages.length,1,'suggestions never send')
  const trace=(await app.call(`/api/ai-support/projects/${p}/conversations/${v.conversationId}/trace`,{token:a.owner,status:200})).data.generations[0]
  assert.equal(trace.approval,'explicit operator request');assert.equal(trace.requestedScope,'operator suggestions')
  assert.equal(trace.committedAnswer,null);assert.equal(trace.result,'no committed answer');assert.equal(trace.usage.length,2)
  assert.equal(trace.usage[0].inputTokens,5);assert.equal(trace.providerCostUsd,null)
  // A failing or repeated alternative fails the whole suggestion: no primary card alone.
  for(const alternatives of [()=>new Response(JSON.stringify({error:{message:'second stage rejected'}}),{status:503}),body=>({alternatives:[card('Cancel','Open Orders and choose Cancel.',body)],missing_information:[]})]){
   ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?alternatives(body):{user_goal:'Cancel an order',responses:[card('Cancel','Open Orders and choose Cancel.',body)],missing_information:[]}
   const failed=await assist(v.conversationId,{request_id:crypto.randomUUID()});await a.run()
   const row=await generation(failed.data.id);assert.notEqual(row.state,'completed');assert.equal(JSON.parse(row.output_json||'{}').result,undefined)
  }

  // Handing a waiting conversation to the assistant answers the visitor's turn once, as the visitor's turn.
  ai.respond=()=>'Here is how to cancel.'
  const waiting=await humanTurn('Still there?'),before=a.providerCalls()
  for(let retry=0;retry<2;retry++)assert.equal((await a.action(waiting.conversationId,'assignAi',{ai_id:'ai'})).status,200)
  const [reply]=await a.generations(waiting.conversationId);assert.equal(reply.state,'queued');assert.equal(JSON.parse(reply.actor_json).role,'contact')
  await a.run();await a.run();assert.equal((await a.generations(waiting.conversationId))[0].state,'completed');assert.equal(a.providerCalls(),before+1)
  assert.equal((await a.action(waiting.conversationId,'assignAi',{ai_id:'ai'})).status,200);await a.run();assert.equal(a.providerCalls(),before+1)
  // After an uncertain explicit request the handback does not ask again; after a cancelled answer it asks exactly once more.
  const uncertain=await humanTurn('Hello?');assert.equal((await a.action(uncertain.conversationId,'request',{requestId:crypto.randomUUID()})).status>=400,true)
  await app.db.prepare("INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,source_last_message_id,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) SELECT 'prior-explicit',project_id,id,'uncertain',revision,last_message_id,'{}','gpt-5.6-luna','ai','{}',datetime(),datetime() FROM conversations WHERE id=?").bind(uncertain.conversationId).run()
  assert.equal((await a.action(uncertain.conversationId,'assignAi',{ai_id:'ai'})).status,200);assert.equal((await a.generations(uncertain.conversationId)).length,1)
  const cancelled=await humanTurn('Are you there?');assert.equal((await a.action(cancelled.conversationId,'assignAi',{ai_id:'ai'})).status,200)
  const [answer]=await a.generations(cancelled.conversationId);await app.call(`/api/ai-support/projects/${p}/generations/${answer.id}/cancel`,{token:a.owner,body:{},status:200});await app.takeJobs()
  await a.action(cancelled.conversationId,'assignAi',{ai_id:null});for(let retry=0;retry<2;retry++)await a.action(cancelled.conversationId,'assignAi',{ai_id:'ai'})
  assert.deepEqual((await a.generations(cancelled.conversationId)).map(row=>row.state),['cancelled','queued']);await app.takeJobs()
  // The daily reply ceiling skips the answer visibly and never retries; a removed operator cannot hand over.
  await app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:1})})
  const capped=await humanTurn('Ceiling?');assert.equal((await a.action(capped.conversationId,'assignAi',{ai_id:'ai'})).status,200)
  const skipped=(await a.generations(capped.conversationId))[0];assert.equal(skipped.state,'failed');assert.match(skipped.error,/AI_REPLY_CEILING:/);await a.run();assert.equal(a.providerCalls(),before+1)
  await app.configure({AI_DAILY_CEILINGS:undefined})
  const revoked=await humanTurn('Anyone?');await app.db.prepare("DELETE FROM memberships WHERE user_id=?").bind(a.workspace.users.operator).run()
  assert.equal((await a.action(revoked.conversationId,'assignAi',{ai_id:'ai'},a.workspace.tokens.operator)).status,401);assert.deepEqual(await a.generations(revoked.conversationId),[])
  // Without a provider key the handback is refused and the person keeps the conversation.
  const unkeyed=await humanTurn('Key?'),assignment=()=>app.first('SELECT c.assigned_to,a.ai_id FROM conversations c LEFT JOIN conversation_ai a ON a.conversation_id=c.id WHERE c.id=?',unkeyed.conversationId),held=await assignment()
  await app.configure({OPENAI_API_KEY:undefined})
  assert.ok((await a.action(unkeyed.conversationId,'assignAi',{ai_id:'ai'})).status>=400);assert.deepEqual(await a.generations(unkeyed.conversationId),[]);assert.deepEqual(await assignment(),held,'the assignment is unchanged')
 }finally{await a.close()}
 await automaticReplyRows()
}

// Automatic AI and API messages use proven addresses even when their requesting
// actor is a person. Human Send remains the explicit Reply-To-honouring path.
async function automaticReplyRows(){
 const a=await assistantApp({bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-mail',EMAIL_FROM:'support@example.com',INBOUND_EMAIL_TOKEN:'fixture-gateway'}}),{app,ai,p}=a,mail=[]
 const aiContent='Your replacement ships tomorrow.'
 ai.respond=()=>aiContent
 ai.network=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]})
  assert.equal(url.hostname,'api.resend.com');mail.push(await request.json());return Response.json({id:crypto.randomUUID()})
 }
 // R6 adds ticket threading to reply subjects. Identify the submitted message
 // independently of that presentation, retaining every recipient assertion.
 const replies=(from,content)=>mail.slice(from).filter(body=>body.text?.includes(content)).flatMap(body=>body.to)
 try{
  await app.call(`/api/management/projects/${p}/email-settings`,{token:a.owner,method:'PUT',body:{email_from_name:'Support',email_from_address:'support@example.com',inbound_address:'inbound@example.com',is_enabled:true},status:200})
  const request=await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-gateway'},body:{messageId:'ai-mail-proof',to:'inbound@example.com',from:'ai-requester@example.com',replyTo:'ai-preference@example.net',cc:['ai-unproven-cc@example.net'],text:'When does order 4827 ship?'},status:201})
  await app.scheduled();await a.action(request.data.conversationId,'assignAi',{ai_id:'ai'});await a.run();await app.scheduled()
  const id=request.data.conversationId
  assert.equal((await app.sql("SELECT id FROM messages WHERE conversation_id=? AND actor_role='ai'",id)).length,1)
  assert.deepEqual(replies(0,aiContent),['ai-requester@example.com'],'AI sends exactly once to the proven requester and nothing to unproven preferences or Cc')
  // A scoped API author is synthetic, despite its persisted operator role.
  const issued=await app.call(`/api/management/projects/${p}/connections/tokens`,{token:a.owner,body:{name:'Reply integration',scopes:['messages:write']},status:201})
  const current=await app.first('SELECT revision FROM conversations WHERE id=?',id),apiStart=mail.length,apiContent='The shipment is confirmed.'
  await app.call(`/api/v1/conversations/${id}/messages`,{token:issued.data.token,body:{localId:'api-mail-proof',content:apiContent,expectedRevision:current.revision},status:200});await app.scheduled()
  assert.deepEqual(replies(apiStart,apiContent),['ai-requester@example.com'],'API replies cannot inherit human Reply-To authority')
  const humanStart=mail.length,head=await app.first('SELECT revision FROM conversations WHERE id=?',id),humanContent='I checked your order personally.'
  await app.call(`/api/conversations/${id}/messages`,{token:a.owner,body:{localId:'human-mail-proof',content:humanContent,expectedRevision:head.revision},status:200});await app.scheduled()
  assert.deepEqual(replies(humanStart,humanContent).sort(),['ai-preference@example.net','ai-unproven-cc@example.net'].sort())
 }finally{await a.close()}
}
