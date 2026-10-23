import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'

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
  assert.equal(first.answers.length,1);const citations=JSON.parse(first.answers[0].citations_json)
  assert.deepEqual(citations.find(c=>c.id==='article:a'),{id:'article:a',sourceVersion:version,title:'Refund policy',url:'https://support.example/help/p-ai/refunds'})
  assert.equal(citations.find(c=>c.id==='knowledge:doc').url,'https://docs.example')
  // The same answer arrives through the socket replay, and redelivery of the job calls no provider.
  const calls=a.providerCalls();await app.runJobs([{type:'ai.generate',id:(await a.generations(first.v.conversationId))[0].id,projectId:p}]);assert.equal(a.providerCalls(),calls)
  const upgrade=await app.request(`/api/conversations/${first.v.conversationId}/socket?token=${first.v.token}`,{headers:{Upgrade:'websocket'}});assert.equal(upgrade.status,101)
  const socket=upgrade.webSocket;socket.accept()
  const frame=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('replay deadline')),5000);socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.type==='message'&&message.message.actor_role==='ai'){clearTimeout(timer);resolve(message)}});socket.send(JSON.stringify({type:'replay'}))})
  assert.equal(frame.message.id,first.answers[0].id);assert.deepEqual(JSON.parse(frame.message.citations_json),citations);socket.close()

  // A citation of a draft, private history or a version the search never issued is refused: no answer carries it.
  for(const sources of [[{id:'article:draft',sourceVersion:'x'}],[{id:'knowledge:private',sourceVersion:'v'}],[{id:'article:a',sourceVersion:'fabricated'}]]){
   const refused=await ask('Refunds again?',answering(()=>sources))
   for(const answer of refused.answers)assert.deepEqual(JSON.parse(answer.citations_json),[],JSON.stringify(sources))
  }
  // Unpublication or a new publication between citation and admission denies the answer atomically.
  for(const change of ["UPDATE knowledge_articles SET status='draft' WHERE id='a'","UPDATE knowledge_articles SET content='New publication' WHERE id='a'","UPDATE knowledge_datasets SET published_version=NULL WHERE id='ds'"]){
   const current=[{id:'article:a',sourceVersion:await publication()},{id:'knowledge:doc',sourceVersion:'v'}]
   const raced=await ask('One more time?',answering(()=>current,{before:()=>app.db.prepare(change).run()}));assert.equal(raced.answers.length,0,change)
   await app.db.prepare("UPDATE knowledge_articles SET status='published' WHERE id='a'").run();await app.db.prepare("UPDATE knowledge_datasets SET published_version='v' WHERE id='ds'").run()
  }
  // Retrieval and citations use the recipient's proven identity, never a typed
  // address or the wider authority of the operator/provider running the turn.
  const {createHmac}=await import('node:crypto')
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const category=(await app.call(`/api/knowledge/${p}/categories`,{token:a.owner,body:{title:'Private account',audience:'domains',allowedDomains:['trusted.test']},status:201})).data.id
  const privateArticle=(await app.call(`/api/knowledge/${p}/articles`,{token:a.owner,body:{title:'Private export guide',content:'Privatemarker: reset the export queue using a fresh draft.',categoryIds:[category],status:'published'},status:201})).data.id
  const privateVersion=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',privateArticle)).publication_version
  const privateVisitor=async(email,proven=true)=>a.visitor('Member',proven?{identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')}:{email})
  const privateAnswer=async(visitor,{revoke=false,cite=true}={})=>{
   let turn=0,observed
   ai.respond=async body=>{
    if(++turn===1)return openaiToolCall('search_knowledge',{query:'privatemarker'},'private-search')
    observed=JSON.stringify(body.input)
    if(turn===2&&cite&&observed.includes('reset the export queue'))return openaiToolCall('cite_knowledge',{sources:[{id:'article:'+privateArticle,sourceVersion:privateVersion}]},'private-cite')
    if(revoke)await app.db.prepare('UPDATE contacts SET is_verified=0 WHERE id=?').bind(visitor.contactId).run()
    return observed.includes('reset the export queue')?'Reset the export queue using a fresh draft.':'I cannot locate approved guidance; ask a teammate.'
   }
   await visitor.say('How can I use the privatemarker guidance?');await a.run()
   return {observed,answers:(await visitor.transcript()).messages.filter(m=>m.actor_role==='ai')}
  }
  const member=await privateVisitor('member@trusted.test')
  const permitted=await privateAnswer(member)
  assert.match(permitted.observed,/reset the export queue/);assert.equal(permitted.answers.length,1)
  assert.equal(JSON.parse(permitted.answers[0].citations_json)[0].id,'article:'+privateArticle)
  for(const visitor of [await privateVisitor('outsider@other.test'),await privateVisitor('typed@trusted.test',false),await a.visitor()]){
   const denied=await privateAnswer(visitor);assert.doesNotMatch(denied.observed,/reset the export queue/)
   for(const answer of denied.answers){assert.doesNotMatch(answer.content,/reset the export queue/);assert.deepEqual(JSON.parse(answer.citations_json),[])}
  }
  // Even an uncited source is fenced at final admission. Model deltas never
  // bypass that fence or leak an answer while the recipient's grant is revoked.
  const revoked=await privateVisitor('revoked@trusted.test')
  const upgradePrivate=await app.request(`/api/conversations/${revoked.conversationId}/socket?token=${revoked.token}`,{headers:{Upgrade:'websocket'}})
  const privateSocket=upgradePrivate.webSocket;privateSocket.accept();const privateFrames=[]
  privateSocket.addEventListener('message',event=>privateFrames.push(JSON.parse(event.data)))
  const revokedAnswer=await privateAnswer(revoked,{revoke:true,cite:false})
  assert.equal(revokedAnswer.answers.length,0);assert.ok(!privateFrames.some(frame=>frame.type==='chunk'),'unadmitted model deltas are never customer-visible');privateSocket.close()

  // Asking for a person hands the conversation to a human; the assistant writes nothing more and a person can reply.
  ai.respond=async()=>openaiToolCall('switch_agent',{agent_id:'human'},'handoff')
  const handoff=await a.visitor();await handoff.say('I need a human');await a.run()
  assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',handoff.conversationId))?.ai_id??null,null)
  assert.ok((await app.first('SELECT assigned_to FROM conversations WHERE id=?',handoff.conversationId)).assigned_to,'a person now owns the conversation')
  assert.equal((await a.generations(handoff.conversationId))[0].state,'superseded');assert.equal((await handoff.transcript()).messages.filter(m=>m.actor_role==='ai').length,0)
  const current=await handoff.transcript()
  assert.equal((await app.call(`/api/conversations/${handoff.conversationId}/messages`,{token:a.owner,body:{localId:'operator-reply',content:'Human reply',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.accepted,true)
 }finally{await a.close()}
}
