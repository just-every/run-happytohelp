import assert from 'node:assert/strict'
import {openaiToolCall,openaiStream} from '../openai-stream.mjs'

// Continue the triaged customer's case, using the same workspace, visitor and queue.
export async function replyLifecycle(a,v){
 const {app,ai,p,owner}=a,id=v.conversationId
 const trace=async()=>(await app.ok(`/api/ai-support/projects/${p}/conversations/${id}/trace`,{token:owner})).generations
 const latest=async()=>{const rows=await trace();assert.ok(rows.length,'the assistant assignment admits a generation for the customer case');return rows[0]}
 const queuedForCase=async()=>{const ids=new Set((await a.generations(id)).map(row=>row.id));return (await app.takeJobs()).filter(j=>j.type==='ai.generate'&&ids.has(j.id))}
 const answer=async text=>{await v.say(text);const jobs=await queuedForCase();await a.run(jobs);return jobs}
 await app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('reply-policy',?,'refund-policy','Refund policy','Refund within thirty days.','published',1)").bind(p).run()
 const version=(await app.first("SELECT publication_version FROM knowledge_articles WHERE id='reply-policy'")).publication_version
 let round=0
 ai.respond=body=>{
  assert.ok(body.tools.some(t=>t.name==='search_knowledge'))
  if(++round===1)return openaiToolCall('search_knowledge',{query:'refund'},'policy-search')
  if(round===2){assert.match(JSON.stringify(body.input),/Refund within thirty days/);return openaiToolCall('cite_knowledge',{sources:[{id:'article:reply-policy',sourceVersion:version}]},'policy-citation')}
  return 'You can request a refund within thirty days.'
 }
 assert.equal((await a.action(id,'assignAi',{ai_id:'ai'})).status,200)
 const assigned=(await app.ok(`/api/dashboard/projects/${p}/conversations/${id}/ticket`,{token:owner})).data
 assert.equal(assigned.assigned_to,null,'the case is handed back from human routing to the assistant')
 await app.takeJobs()
 const jobs=await answer('What does your refund policy say?'),committed=await latest()
 assert.equal(committed.result,'committed answer');assert.ok(committed.tools.some(t=>t.name==='cite_knowledge'&&t.outcome==='completed'))
 assert.ok(committed.usage.length>0);assert.ok(committed.usage.every(u=>u.inputTokens>0));assert.equal(committed.providerCostUsd,null)
 const message=(await v.transcript()).messages.find(m=>m.id===committed.committedAnswer.id)
 assert.ok(JSON.parse(message.citations_json).some(c=>c.id==='article:reply-policy'&&c.sourceVersion===version))
 const calls=a.providerCalls();await a.run(jobs);assert.equal(a.providerCalls(),calls)
 const generation=await app.ok(`/api/ai-support/projects/${p}/generations/${committed.id}`,{token:owner})
 assert.ok(JSON.parse(generation.output_json).usage.input_tokens>0,'raw provider accounting remains readable')
 const upgraded=await app.request(`/api/conversations/${id}/socket?token=${v.token}`,{headers:{Upgrade:'websocket'}})
 assert.equal(upgraded.status,101);const socket=upgraded.webSocket;socket.accept()
 try{
  const replay=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('answer replay deadline')),5000);socket.addEventListener('message',event=>{const frame=JSON.parse(event.data);if(frame.message?.id===message.id){clearTimeout(timer);resolve(frame.message)}});socket.send(JSON.stringify({type:'replay'}))})
  assert.equal(replay.content,message.content);assert.equal(replay.citations_json,message.citations_json)
 }finally{socket.close()}
 await app.call(`/api/ai-support/projects/${p}/conversations/${id}/trace`,{token:v.token,status:403})

 // The next turn loses its provider response. Durable uncertainty, rather than another paid dispatch,
 // is what the operator sees after both delivery and scheduled recovery.
 ai.respond=()=>{throw new DOMException('synthetic-private-context','TimeoutError')}
 const interrupted=await answer('Please check my refund again.'),unknown=await latest(),paidCalls=a.providerCalls()
 assert.equal(unknown.result,'unknown');assert.equal(unknown.providerOutcome,'timeout');assert.equal(unknown.committedAnswer,null)
 assert.doesNotMatch(JSON.stringify(unknown),/synthetic-private-context/)
 await a.run(interrupted);await app.scheduled();assert.equal(a.providerCalls(),paidCalls)

 // The workspace's daily allowance is configurable; both reply count and reported spend leave
 // a durable skip without leaking the reason or losing the next customer message.
 const usagePath=`/api/dashboard/projects/${p}/ai-usage`
 const usage=async()=>(await app.ok(usagePath,{token:owner})).data
 const used=(await usage()).replies.used
 await app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:used})})
 ai.respond=()=>'Must not run'
 await answer('Any news about my refund?');const capped=await latest()
 assert.equal(capped.state,'failed');assert.equal(capped.providerOutcome,'not observed')
 assert.equal(a.providerCalls(),paidCalls);assert.equal((await usage()).replyCeilingReached,true)
 assert.doesNotMatch(JSON.stringify(await v.transcript()),/AI_REPLY_CEILING|repliesPerProject/)
 const skippedJobs=await queuedForCase();await app.scheduled();await a.run(skippedJobs);assert.equal(a.providerCalls(),paidCalls)

 // Raise the count allowance explicitly, then cross a configured spend allowance using real
 // provider usage. The amount is read from accounting, never invented from a token estimate.
 await app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:used+10,spendUsdPerProject:0.01})})
 ai.respond=()=>openaiStream('Refund reviewed.',{input_tokens:300000,output_tokens:2})
 await answer('Could you review the refund now?')
 assert.ok((await usage()).spendUsd.used>0.01)
 const spentCalls=a.providerCalls();await answer('And one more review?');assert.equal(a.providerCalls(),spentCalls)
 assert.equal((await usage()).replyCeilingReached,true)
 const admitted=(await usage()).replies.used
 await app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:admitted+10,repliesPerInstallation:admitted})})
 await answer('Can the installation answer now?');assert.equal(a.providerCalls(),spentCalls)
 assert.equal((await usage()).installationCeilingReached,true)
 const explicit=await app.call(`/api/conversations/${id}/widget-events`,{token:v.token,body:{action:'request',data:{requestId:crypto.randomUUID()}},status:429})
 assert.ok(Number(explicit.headers.get('Retry-After'))>0);assert.doesNotMatch(JSON.stringify(explicit.data),/AI_REPLY_CEILING|spendUsd|repliesPerInstallation/)

 // Removing the key never assigns a default assistant to a new customer; explicit operator
 // requests fail visibly without dispatch or a fabricated prediction.
 await app.configure({OPENAI_API_KEY:undefined,AI_DAILY_CEILINGS:undefined})
 const missing=await a.visitor('No configured provider');await missing.say('I need help')
 assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',missing.conversationId))?.ai_id??null,null)
 const refused=await a.action(id,'agentAssist',{options:{request_id:crypto.randomUUID()}})
 assert.ok(refused.status>=400);assert.match(JSON.stringify(refused.data),/OPENAI_API_KEY|configuration/i)
 assert.equal(a.providerCalls(),spentCalls)
}
