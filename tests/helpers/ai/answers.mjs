import assert from 'node:assert/strict'
import {providersJourney} from './providers.mjs'
import {repositoryJourney} from './repository.mjs'
import {cycleOutcomes} from './cycle-outcomes.mjs'
import {assistantApp} from './app.mjs'
import {openaiStream,openaiToolCall} from '../openai-stream.mjs'
import {socketClient} from '../widget/sockets.mjs'

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
   turn++;assert.ok(!toolNames(body).includes('propose_knowledge_change')&&!toolNames(body).includes('read_verified_resolution'),'customer-facing generations cannot inspect other customer cases or create knowledge drafts');assert.ok(toolNames(body).includes('cite_knowledge')&&toolNames(body).includes('switch_agent'),'the assistant can cite and hand off')
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
  const receipt=(await app.call(`/api/ai-support/projects/${p}/conversations/${first.v.conversationId}/trace`,{token:a.owner,status:200})).data.traces.find(row=>row.generationId===recorded.id)
  assert.equal(receipt.result.messageId,first.answers[0].id)
  assert.ok(receipt.toolTrace.calls.some(tool=>tool.toolName==='cite_knowledge'&&tool.state==='completed'&&tool.requestedScope==='conversation-recipient'))
  assert.ok(receipt.toolTrace.calls.every(tool=>!tool.businessActionExecuted&&!tool.verifiedBusinessResult))
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
  let privateVersion=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',privateArticle)).publication_version
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
  // Reviewed translations are real retrieval evidence, with their own admission identity.
  const management=(path,body)=>app.call(`/api/knowledge/${p}`+path,{token:a.owner,method:'PUT',body,status:200})
  await management('/experience',{defaultLocale:'en',locales:['en','fr'],templates:{}})
  const translate=(content,reviewStatus='reviewed')=>management(`/articles/${privateArticle}/translations/fr`,{title:'Guide privé',content,summary:'',reviewStatus})
  await translate('Guidemarqueur: réinitialiser la file avec un brouillon neuf.')
  const localized=async(visitor,{before,query='guidemarqueur',cite=true}={})=>{
   let turn=0,observed,ref
   ai.respond=async body=>{
    if(++turn===1)return openaiToolCall('search_knowledge',{query,locale:'fr'},'localized-search')
    if(turn===2){
     observed=JSON.stringify(body.input)
     const issued=await app.first('SELECT source_id,source_version FROM ai_generation_sources WHERE source_id=? AND source_version LIKE ? ORDER BY rowid DESC LIMIT 1','article:'+privateArticle,'%~fr~%')
     ref=issued&&{id:issued.source_id,sourceVersion:issued.source_version}
     if(cite&&observed.includes('Guidemarqueur'))return openaiToolCall('cite_knowledge',{sources:[ref]},'localized-cite')
    }
    await before?.();return 'Consultez le guide.'
   }
   await visitor.say('Comment utiliser ce guide en français?');await a.run()
   return {observed,ref,answers:(await visitor.transcript()).messages.filter(m=>m.actor_role==='ai')}
  }
  const translated=await localized(await privateVisitor('french@trusted.test'))
  assert.match(translated.observed,/réinitialiser la file/);assert.equal(translated.answers.length,1)
  const translatedCitation=JSON.parse(translated.answers[0].citations_json)[0]
  assert.equal(translatedCitation.locale,'fr');assert.equal(translatedCitation.localeFallback,false);assert.match(translatedCitation.url,/locale=fr/)
  await translate('Unreviewed French secret', 'draft')
  const retained=await localized(await privateVisitor('draft-reader@trusted.test'))
  assert.match(retained.observed,/réinitialiser la file/);assert.doesNotMatch(retained.observed,/Unreviewed French secret/)
  assert.equal(retained.ref.sourceVersion,translated.ref.sourceVersion,'editing a draft preserves the reviewed identity')
  const changed=await localized(await privateVisitor('raced-fr@trusted.test'),{before:()=>translate('Guidemarqueur: nouvelle publication.')})
  assert.equal(changed.answers.length,0,'a translated publication changed mid-answer admits no stale customer draft')
  const uncited=await localized(await privateVisitor('uncited-fr@trusted.test'),{cite:false,before:()=>translate('Guidemarqueur: troisième publication.')})
  assert.equal(uncited.answers.length,0,'uncited translated evidence has the same atomic fence')
  const localeChanged=await localized(await privateVisitor('locale-race@trusted.test'),{before:()=>management('/experience',{defaultLocale:'fr',locales:['en','fr'],templates:{}})})
  assert.equal(localeChanged.answers.length,0,'changing the configured source language withdraws old locale evidence')
  await management('/experience',{defaultLocale:'en',locales:['en','fr'],templates:{}})
  for(const visitor of [await privateVisitor('french@other.test'),await privateVisitor('typed-fr@trusted.test',false),await a.visitor()]){
   const denied=await localized(visitor);assert.doesNotMatch(denied.observed,/Guidemarqueur|nouvelle publication|troisième publication/)
  }
  await app.call(`/api/knowledge/${p}/articles`,{token:a.owner,body:{id:privateArticle,title:'Private export guide',slug:'private-export-guide',content:'Privatemarker: reset the export queue using a fresh draft. Updated source.',status:'published'},status:201})
  const fallback=await localized(await privateVisitor('fallback@trusted.test'),{query:'privatemarker'})
  assert.match(fallback.observed,/localeFallback/);assert.match(fallback.observed,/Updated source/)
  // Select the issued fallback explicitly; the server, not the model, discloses it.
  let fallbackTurn=0
  ai.respond=async body=>{
   if(++fallbackTurn===1)return openaiToolCall('search_knowledge',{query:'privatemarker',locale:'fr'},'fallback-search')
   if(fallbackTurn===2){const issued=await app.first('SELECT source_id,source_version FROM ai_generation_sources WHERE source_id=? ORDER BY rowid DESC LIMIT 1','article:'+privateArticle);return openaiToolCall('cite_knowledge',{sources:[{id:issued.source_id,sourceVersion:issued.source_version}]},'fallback-cite')}
   return 'Read the source guidance.'
  }
  const fallbackVisitor=await privateVisitor('fallback-cited@trusted.test');await fallbackVisitor.say('Please explain in French');await a.run()
  const fallbackMessage=(await fallbackVisitor.transcript()).messages.find(m=>m.actor_role==='ai')
  assert.match(fallbackMessage.content,/Knowledge language fallback: fr → en/)
  assert.equal(JSON.parse(fallbackMessage.citations_json)[0].localeFallback,true)

  privateVersion=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',privateArticle)).publication_version
  // Even an uncited source is fenced at final admission. Model deltas never
  // bypass that fence or leak an answer while the recipient's grant is revoked.
  const revoked=await privateVisitor('revoked@trusted.test')
  const upgradePrivate=await app.request(`/api/conversations/${revoked.conversationId}/socket?token=${revoked.token}`,{headers:{Upgrade:'websocket'}})
  const privateSocket=upgradePrivate.webSocket;privateSocket.accept();const privateFrames=[]
  privateSocket.addEventListener('message',event=>privateFrames.push(JSON.parse(event.data)))
  const revokedAnswer=await privateAnswer(revoked,{revoke:true,cite:false})
  assert.equal(revokedAnswer.answers.length,0);assert.ok(!privateFrames.some(frame=>frame.type==='chunk'),'unadmitted model deltas are never customer-visible');privateSocket.close()

  // A real operator takes over between the provider's provisional delta and
  // completion. Neither the live widget nor later replay may promote that text.
  const raced=await a.visitor(),racedPath=`/api/conversations/${raced.conversationId}`
  const live=await socketClient(app)(`${racedPath}/socket?token=${raced.token}`);assert.equal(live.status,101)
  let deltaSent=false,takeover
  const provisional='A superseded model answer must never be sent.'
  ai.respond=async()=>{
   const body=await openaiStream(provisional).text(),boundary=body.indexOf('\n\n')+2,encode=new TextEncoder();let part=0
   return new Response(new ReadableStream({async pull(controller){
    if(part++===0){controller.enqueue(encode.encode(body.slice(0,boundary)));deltaSent=true;return}
    const current=await raced.transcript();assert.equal(current.messages.filter(message=>message.actor_role==='ai').length,0,'a provisional delta has no durable answer before completion')
    takeover=(await app.call(racedPath+'/messages',{token:a.owner,body:{localId:'stream-takeover',content:'A teammate is handling this now.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data
    assert.equal(takeover.accepted,true)
    controller.enqueue(encode.encode(body.slice(boundary)));controller.close()
   }},{highWaterMark:0}),{headers:{'content-type':'text/event-stream'}})
  }
  try{
   const question=await raced.say('Please help with my return'),jobs=await app.takeJobs(),before=a.providerCalls()
   await a.run(jobs);assert.equal(deltaSent,true);assert.equal(a.providerCalls(),before+1)
   const superseded=await trace(a,raced);assert.equal(superseded.state,'cancelled','operator admission atomically cancels the superseded generation');assert.equal(superseded.committedAnswer,null)
   const committed=await raced.transcript();assert.deepEqual(committed.messages.map(message=>message.id),[question.message.id,takeover.message.id]);assert.equal(committed.revision,2)
   live.socket.send(JSON.stringify({type:'ping'}));await live.next(frame=>frame.type==='pong')
   assert.deepEqual(live.frames.filter(frame=>frame.type==='message').map(frame=>frame.message.id),committed.messages.map(message=>message.id))
   assert.ok(!live.frames.some(frame=>frame.type==='chunk'||JSON.stringify(frame).includes(provisional)),'superseded model text never crosses the widget socket')
   await a.run(jobs);assert.equal(a.providerCalls(),before+1,'redelivery never retries the superseded paid attempt')
  }finally{live.socket.close()}
  const replayed=await socketClient(app)(`${racedPath}/socket?token=${raced.token}`);assert.equal(replayed.status,101)
  try{replayed.socket.send(JSON.stringify({type:'ping'}));await replayed.next(frame=>frame.type==='pong');assert.deepEqual(replayed.frames.filter(frame=>frame.type==='message').map(frame=>frame.message.id),(await raced.transcript()).messages.map(message=>message.id));assert.ok(!JSON.stringify(replayed.frames).includes(provisional),'replay contains only guarded committed replies')}finally{replayed.socket.close()}

  // Asking for a person hands the conversation to a human; the assistant writes nothing more and a person can reply.
  ai.respond=async()=>openaiToolCall('switch_agent',{agent_id:'human'},'handoff')
  const handoff=await a.visitor();await handoff.say('I need a human');await a.run()
  assert.equal((await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',handoff.conversationId))?.ai_id??null,null)
  assert.ok((await app.first('SELECT assigned_to FROM conversations WHERE id=?',handoff.conversationId)).assigned_to,'a person now owns the conversation')
  assert.equal((await trace(a,handoff)).result,'handoff');assert.equal((await trace(a,handoff)).contribution,'handoff');assert.equal((await trace(a,handoff)).customerOutcome.cycle,null);assert.ok((await trace(a,handoff)).tools.some(t=>t.outcome==='handoff'))
  assert.equal((await a.generations(handoff.conversationId))[0].state,'superseded');assert.equal((await handoff.transcript()).messages.filter(m=>m.actor_role==='ai').length,0)
  // At handoff the operator asks for suggestions. The paid result is a draft,
  // with both provider rounds retained; only the operator's reviewed send follows.
  const requestId=crypto.randomUUID(),assist=()=>a.action(handoff.conversationId,'agentAssist',{options:{request_id:requestId}})
  ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:{user_goal:'Human support',responses:[{button:'Help',icon:'circle-question-mark',response:'A teammate is reviewing your request.',use_when:'',evidence_ids:[JSON.stringify(body).match(/message:[0-9a-f-]{36}/)[0]]}],missing_information:[]}
  const suggested=await assist();assert.equal(suggested.status,202);assert.equal((await assist()).data.id,suggested.data.id)
  const beforeDraft=(await handoff.transcript()).messages.length;await a.run()
  assert.equal((await handoff.transcript()).messages.length,beforeDraft)
  const draftTrace=await trace(a,handoff);assert.equal(draftTrace.approval,'explicit operator request');assert.equal(draftTrace.committedAnswer,null);assert.equal(draftTrace.usage.length,2)
  const current=await handoff.transcript()
  assert.equal((await app.call(`/api/conversations/${handoff.conversationId}/messages`,{token:a.owner,body:{localId:'operator-reply',content:'Human reply',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.accepted,true)
  await repositoryJourney(a,handoff)
  await providersJourney(a)
  ai.respond=()=>{throw new DOMException('Connection lost at the provider','TimeoutError')}
  const timed=await a.action(handoff.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}});assert.equal(timed.status,202)
  const pending=await app.takeJobs(),beforeTimeout=a.providerCalls();await a.run(pending);await a.run(pending)
  assert.equal(a.providerCalls(),beforeTimeout+1);assert.equal((await trace(a,handoff)).providerOutcome,'timeout');assert.equal((await trace(a,handoff)).committedAnswer,null)
  await app.configure({OPENAI_API_KEY:undefined})
  const missing=await a.action(handoff.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}})
  assert.equal(missing.status,503);assert.match(JSON.stringify(missing.data),/CONFIGURATION_REQUIRED/)
 }finally{await a.close()}
}
