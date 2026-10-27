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
  // Both accounts prove the same email domain through the signed widget door.
  // The model may retrieve and cite only the explicitly entitled account's article.
  const category=(await app.call(`/api/knowledge/${p}/categories`,{token:a.owner,body:{title:'Account policies',audience:'domains',allowedDomains:['trusted.test']},status:201})).data.id
  const restricted=(await app.call(`/api/knowledge/${p}/articles`,{token:a.owner,body:{title:'Refund entitlement',slug:'entitled-refund',content:'Refund entitlement for this account only.',categoryIds:[category],status:'published'},status:201})).data.id
  const verifiedVisitor=async email=>{
   const {createHmac}=await import('node:crypto'),secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
   const session=(await app.call('/api/identity/widget/session',{body:{widgetKey:a.workspace.widgetKey,identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')},headers:{Origin:'https://widget.example'},status:201})).data
   const conversation=(await app.call('/api/conversations',{token:session.token,body:{projectId:p},status:201})).data
   const path=`/api/conversations/${conversation.id}/messages`,transcript=async()=>(await app.call(path,{token:session.token,status:200})).data
   return {id:conversation.id,contact:(await app.first('SELECT contact_id FROM conversations WHERE id=?',conversation.id)).contact_id,transcript,say:async()=>{const current=await transcript();await app.call(path,{token:session.token,body:{localId:crypto.randomUUID(),content:'Explain my refund entitlement',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})}}
  }
  const permitted=await verifiedVisitor('synthetic-hh-1@trusted.test'),forbidden=await verifiedVisitor('synthetic-hh-2@trusted.test'),grantPath=`/api/knowledge/${p}/categories/${category}/entitlements`
  const grant=ids=>app.call(grantPath,{token:a.owner,method:'PUT',body:{contactIds:ids},status:200})
  await grant([permitted.contact])
  const restrictedVersion=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',restricted)).publication_version
  const restrictedRefs=[{id:`article:${restricted}`,sourceVersion:restrictedVersion}]
  ai.respond=answering(()=>restrictedRefs);await permitted.say();await a.run()
  assert.ok(searched.includes(`article:${restricted}`))
  const permittedAnswer=(await permitted.transcript()).messages.find(m=>m.actor_role==='ai');assert.ok(permittedAnswer)
  assert.equal(JSON.parse(permittedAnswer.citations_json)[0].id,`article:${restricted}`)
  ai.respond=answering(()=>[]);await forbidden.say();await a.run()
  assert.ok(!searched.includes(`article:${restricted}`),'same-domain customer without entitlement never exposes the article to the model')
  ai.respond=answering(()=>restrictedRefs,{before:()=>grant([])});await permitted.say();await a.run()
  assert.equal((await permitted.transcript()).messages.filter(m=>m.actor_role==='ai').length,1,'revocation between citation and message admission blocks the next answer')

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
