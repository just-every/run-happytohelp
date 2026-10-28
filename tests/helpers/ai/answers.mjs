import assert from 'node:assert/strict'
import {cycleOutcomes} from './cycle-outcomes.mjs'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'

const trace=async(a,v)=>{
 const response=await a.app.call(`/api/ai-support/projects/${a.p}/conversations/${v.conversationId}/trace`,{token:a.owner,status:200})
 assert.match(response.headers.get('cache-control')||'',/(?:^|,)\s*no-store(?:,|$)/,'private execution evidence must never enter a response cache')
 return response.data.generations[0]
}
const toolNames=body=>(body.tools||[]).map(tool=>tool.name)

// The visitor's assistant answers from published knowledge with exact citations, through the queue.
export async function answersJourney(){
 const a=await assistantApp({prompt:'Use policy'}),{app,ai,p}=a
 try{
  await app.db.batch([
   app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('a',?,'refunds','Refund policy','Refund within 30 days.','published',1),('draft',?,'secret','Refund secret','Private','draft',1)").bind(p,p),
   app.db.prepare("INSERT INTO knowledge_datasets(id,project_id,name,created_at) VALUES('ds',?,'Dataset',1)").bind(p),
   app.db.prepare("INSERT INTO knowledge_versions(id,dataset_id,fingerprint,created_at) VALUES('v','ds','fp',1)"),
   app.db.prepare("INSERT INTO knowledge_documents(id,version_id,url,title,content) VALUES('doc','v','https://docs.example','Dataset refunds','Refund details'),('private','v','h2h://conversation/ct','Refund history','Private history')"),
   app.db.prepare("UPDATE knowledge_datasets SET published_version='v',status='ready' WHERE id='ds'"),
  ])
  const publication=async()=>(await app.first("SELECT publication_version FROM knowledge_articles WHERE id='a'")).publication_version
  // Search, cite and answer: the model sees only citable results; `cite(rows)` chooses what to cite.
  let searched
  const answering=(cite,{before}={})=>{let turn=0;return async body=>{
   turn++;assert.ok(toolNames(body).includes('cite_knowledge')&&toolNames(body).includes('switch_agent'),'the assistant can cite and hand off')
   if(turn===1)return openaiToolCall('search_knowledge',{query:'refund'},'search')
   if(turn===2){searched=JSON.stringify(body.input);return openaiToolCall('cite_knowledge',{sources:cite()},'cite')}
   await before?.();return 'Refunds are available within 30 days.'
  }}
  const ask=async(question,respond)=>{const v=await a.visitor();ai.respond=respond;await v.say(question);await a.run();return {v,answers:(await v.transcript()).messages.filter(message=>message.actor_role==='ai')}}

  const version=await publication(),cited=[{id:'article:a',sourceVersion:version},{id:'knowledge:doc',sourceVersion:'v'}]
  const first=await ask('What is the refund window?',answering(()=>cited))
  assert.match(searched,/article:a/);assert.ok(searched.includes(version),'the model receives the issued publication version');assert.doesNotMatch(searched,/Refund secret/,'drafts never reach the model')
  const recorded=await trace(a,first.v)
  assert.equal(recorded.result,'committed answer');assert.equal(recorded.committedAnswer.id,first.answers[0].id)
  assert.equal(recorded.providerOutcome,'completed');assert.equal(recorded.providerCostUsd,null)
  assert.match(recorded.source.assistantVersion,/^[a-f0-9]{64}$/);assert.equal(recorded.source.knowledge.find(s=>s.source_id==='article:a').source_version,version)
  assert.equal(recorded.approval,'automatic assistant policy');assert.equal(recorded.requestedScope,'conversation reply');assert.ok(recorded.timing.durationMs>=0)
  assert.ok(recorded.tools.some(t=>t.name==='cite_knowledge'&&t.outcome==='completed'))
  const tracePath=`/api/ai-support/projects/${p}/conversations/${first.v.conversationId}/trace`
  await app.call(tracePath,{token:first.v.token,status:403})
  await app.call(tracePath,{status:401})
  const foreign=await app.seedWorkspace('trace-foreign')
  await app.call(tracePath,{token:foreign.tokens.owner,status:403})
  await app.call(`/api/ai-support/projects/not-this-project/conversations/${first.v.conversationId}/trace`,{token:a.owner,status:403})
  await app.call(`/api/ai-support/projects/${p}/conversations/missing/trace`,{token:a.owner,status:404})
  assert.doesNotMatch(JSON.stringify(recorded),/Refund policy|Refund within|Use policy|Refunds are available/)
  assert.equal(first.answers.length,1);const citations=JSON.parse(first.answers[0].citations_json)
  assert.deepEqual(citations.find(c=>c.id==='article:a'),{id:'article:a',sourceVersion:version,title:'Refund policy',url:'https://support.example/help/p-ai/refunds'})
  assert.equal(citations.find(c=>c.id==='knowledge:doc').url,'https://docs.example')
  // The same answer arrives through the socket replay, and redelivery of the job calls no provider.
  const calls=a.providerCalls();await app.runJobs([{type:'ai.generate',id:(await a.generations(first.v.conversationId))[0].id,projectId:p}]);assert.equal(a.providerCalls(),calls)
  const upgrade=await app.request(`/api/conversations/${first.v.conversationId}/socket?token=${first.v.token}`,{headers:{Upgrade:'websocket'}});assert.equal(upgrade.status,101)
  const socket=upgrade.webSocket;socket.accept()
  const frame=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('replay deadline')),5000);socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.type==='message'&&message.message.actor_role==='ai'){clearTimeout(timer);resolve(message)}});socket.send(JSON.stringify({type:'replay'}))})
  assert.equal(frame.message.id,first.answers[0].id);assert.deepEqual(JSON.parse(frame.message.citations_json),citations);socket.close()

  await cycleOutcomes(a,first.v,recorded)

  // A citation of a draft, private history or a version the search never issued is refused: no answer carries it.
  for(const sources of [[{id:'article:draft',sourceVersion:'x'}],[{id:'knowledge:private',sourceVersion:'v'}],[{id:'article:a',sourceVersion:'fabricated'}]]){
   const refused=await ask('Refunds again?',answering(()=>sources))
   assert.ok((await trace(a,refused.v)).tools.some(t=>t.outcome==='denied'),'a refused citation is visible without its payload')
   for(const answer of refused.answers)assert.deepEqual(JSON.parse(answer.citations_json),[],JSON.stringify(sources))
  }
  // Withdrawal denies admission; editing preserves the already issued publication snapshot.
  for(const change of ["UPDATE knowledge_articles SET status='draft' WHERE id='a'","UPDATE knowledge_articles SET content='New publication' WHERE id='a'","UPDATE knowledge_datasets SET published_version=NULL WHERE id='ds'"]){
   const current=[{id:'article:a',sourceVersion:await publication()},{id:'knowledge:doc',sourceVersion:'v'}]
   const raced=await ask('One more time?',answering(()=>current,{before:()=>app.db.prepare(change).run()}));assert.equal(raced.answers.length,change.includes("content='New publication'")?1:0,change);if(raced.answers.length){const citations=JSON.parse(raced.answers[0].citations_json);assert.ok(citations.some(citation=>citation.id==='article:a'&&citation.sourceVersion===current[0].sourceVersion),'an edit preserves the issued citation snapshot')}
   await app.db.prepare("UPDATE knowledge_articles SET status='published' WHERE id='a'").run();await app.db.prepare("UPDATE knowledge_datasets SET published_version='v' WHERE id='ds'").run()
  }
  // Asking for a person hands the conversation to a human; the assistant writes nothing more and a person can reply.
  ai.respond=async()=>openaiToolCall('switch_agent',{agent_id:'human'},'handoff')
  const handoff=await a.visitor();await handoff.say('I need a human');await a.run()
  assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',handoff.conversationId))?.ai_id??null,null)
  assert.ok((await app.first('SELECT assigned_to FROM conversations WHERE id=?',handoff.conversationId)).assigned_to,'a person now owns the conversation')
  assert.equal((await trace(a,handoff)).result,'handoff');assert.equal((await trace(a,handoff)).contribution,'handoff');assert.equal((await trace(a,handoff)).customerOutcome.cycle,null);assert.ok((await trace(a,handoff)).tools.some(t=>t.outcome==='handoff'))
  assert.equal((await a.generations(handoff.conversationId))[0].state,'superseded');assert.equal((await handoff.transcript()).messages.filter(m=>m.actor_role==='ai').length,0)
  const current=await handoff.transcript()
  assert.equal((await app.call(`/api/conversations/${handoff.conversationId}/messages`,{token:a.owner,body:{localId:'operator-reply',content:'Human reply',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.accepted,true)
 }finally{await a.close()}
}
