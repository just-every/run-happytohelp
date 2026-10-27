import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {openaiStream} from '../openai-stream.mjs'

// One public-door matrix replaces the overlapping prepared-send cases. Setup
// uses synthetic accounts; every preview, authority change and send uses routes.
export async function preparedReplyJourney(k,{category,article,customer,token,provider}){
 const {app,p,call}=k,grants=`/api/knowledge/${p}/categories/${category}/entitlements`
 await app.presenceAwayOff(p)
 const grant=ids=>call(grants,{method:'PUT',body:{contactIds:ids},status:200})
 const machine=(await call(`/api/management/projects/${p}/connections/tokens`,{body:{name:'Knowledge reply acceptance',scopes:['conversations:read','messages:write']},status:201})).data.token
 const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret,email='matrix-peer@trusted.test'
 const peer=(await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p',identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')},status:201})).data
 const peerId=(await app.first('SELECT id FROM contacts WHERE project_id=? AND external_id=?',p,email)).id
 const company=(await call(`/api/management/projects/${p}/companies`,{body:{name:'Synthetic company',domains:['trusted.test'],attributes:{}},status:201})).data.company
 for(const id of [customer,peerId])await call(`/api/management/projects/${p}/companies/${company.id}/members/${id}`,{method:'PUT',body:{},status:200})
 await call(`/api/management/projects/${p}/companies/${company.id}`,{method:'PATCH',body:{portalCompanyView:true},status:200})
 await app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('knowledge-matrix-ai',?,'Matrix assistant','support','Use the prepared evidence','gpt-5.6-luna',1)").bind(p).run()
 let answer='';const mailCalls=[]
 k.provider=async(request,entry)=>{if(new URL(request.url).hostname==='api.openai.com')return openaiStream(answer);if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.synthetic.test.'}]});mailCalls.push(entry);return provider(request,entry)}
 try{
 const doors=['native','widget','email','api','ai-auto','replay','scheduled','saved-reply','insert-link','attachment','insight','away','transcript','forward']
 const cases=['requester-only','participant-added','participant-removed','grant-revoked','company-viewer','domain-without-grant','entitled-participant']
 for(const door of doors)for(const change of cases){
  // Optional selectors let the external negative-mutation runner execute this
  // identical matrix against each shared call site without new registrations.
  if(process.env.H2H_KNOWLEDGE_MATRIX_DOOR&&process.env.H2H_KNOWLEDGE_MATRIX_DOOR!==door)continue
  await grant([customer])
  const conversation=(await call('/api/conversations',{body:{projectId:p,contactId:customer},status:201})).data.id
  const messages=`/api/conversations/${conversation}/messages`,participants=`/api/dashboard/projects/${p}/conversations/${conversation}/participants`
  // Alternate the two byte-bearing preview doors; neither is an insertion.
  const preview=door==='api'||door==='ai-auto'?(await call(`/api/knowledge/${p}/search?`+new URLSearchParams({q:'Restricted',conversationId:conversation}),{status:200})).data.citations.find(a=>a.id===`article:${article}`):(await call(`/api/knowledge/${p}/conversations/${conversation}/articles`,{status:200})).data.find(a=>a.id===article)
  assert.ok(preview,`${door}/${change}: authorized preview`)
  let content=preview.content,mediaIds=[]
  if(door==='saved-reply'){
   const base=`/api/management/projects/${p}`,macro=(await call(`${base}/macros`,{body:{title:`Matrix ${change}`,content,actions:{reply_type:'public'},scope:{visibility:'shared',roles:['owner'],groups:[],brands:[p]}},status:201})).data.data
   const current=await app.first('SELECT ticket_version FROM conversations WHERE id=?',conversation)
   await call(`${base}/macros/${macro.id}/apply`,{body:{version:macro.version,tickets:[{id:conversation,expected_version:current.ticket_version}],command_id:crypto.randomUUID()},status:200})
   content=(await call(`${base}/conversations/${conversation}/macro-draft`,{status:200})).data.data.content
  }
  if(door==='insert-link')content=(await call(`/api/knowledge/${p}/conversations/${conversation}/articles/${article}/insert`,{body:{mode:'link'},status:200})).data.text
  if(door==='attachment')mediaIds=[(await call(`/api/conversations/${conversation}/media`,{raw:true,body:content,headers:{'Content-Type':'text/plain','X-Filename':'restricted-preview.txt'},status:201})).data.id]
  const body={localId:`matrix-${door}-${change}`,content,mediaIds,expectedRevision:0,expectedLastMessageId:null,knowledgeSources:[],citations:[]}
  let selectedMessage
  if(['transcript','forward'].includes(door)){
   const question=(await app.call(messages,{token,body:{localId:'matrix-question',content:'Please explain my account',expectedRevision:0},status:200})).data.message
   selectedMessage=(await call(messages,{body:{...body,expectedRevision:1,expectedLastMessageId:question.id},status:200})).data.message
   if(door==='forward')await call(`/api/dashboard/projects/${p}/conversations/${conversation}/partner-forwards/preview`,{body:{recipient:(await app.first('SELECT email FROM contacts WHERE id=?',customer)).email,message_ids:[selectedMessage.id]},status:200})
  }
  if(door==='replay')await call(messages,{body,status:200})
  let participant
  if(['participant-added','participant-removed','entitled-participant'].includes(change)&&!(door==='away'&&change==='participant-added')){
   participant=(await call(participants,{body:{email},status:201})).data.data
   if(change==='participant-removed')await call(`${participants}/${participant.pivot.id}`,{method:'DELETE',status:200})
   if(change==='entitled-participant')await grant([customer,peerId])
  }
  if(change==='grant-revoked'&&door!=='away')await grant([])
  if(['company-viewer','domain-without-grant'].includes(change)&&door!=='away'){
   // Deliberate company ticket visibility and a proven matching domain are
   // independent of knowledge entitlement, including a changed requester.
   await call(`/api/dashboard/projects/${p}/conversations/${conversation}/ticket`,{method:'PATCH',body:{requester_id:peerId},status:200})
  }
  const allowed=['requester-only','participant-removed','entitled-participant'].includes(change)
  const before=(await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)).n
  let result
  if(['transcript','forward'].includes(door))await app.until(async()=>!await app.first("SELECT 1 FROM email_deliveries WHERE project_id=? AND state='sending'",p))
  const beforeMail=mailCalls.length
  if(door==='transcript'){
   const recipient=(await app.first('SELECT email FROM contacts WHERE id=?',['company-viewer','domain-without-grant'].includes(change)?peerId:customer)).email
   result=await call(`/api/dashboard/projects/${p}/conversations/${conversation}`,{method:'PUT',body:{send_transcript_to:recipient,idempotencyKey:crypto.randomUUID()}})
  }else if(door==='forward'){
   const recipient=(await app.first('SELECT email FROM contacts WHERE id=?',['company-viewer','domain-without-grant'].includes(change)?peerId:customer)).email,current=await app.first('SELECT ticket_version FROM conversations WHERE id=?',conversation)
   result=await call(`/api/dashboard/projects/${p}/conversations/${conversation}/partner-forwards`,{body:{recipient,message_ids:[selectedMessage.id],subject:'Synthetic forwarded reply',expected_version:current.ticket_version,idempotencyKey:crypto.randomUUID()}})
  }else if(door==='away'){
   await call(`/api/management/projects/${p}/settings`,{method:'PUT',body:{is_available:false,unavailable_message:content},status:200})
   // Move authority immediately before the independent away writer, after the
   // harmless visitor message. This tests its own call, not the caller's check.
   const mutation=change==='grant-revoked'?`DELETE FROM knowledge_collection_entitlements WHERE project_id='${p}' AND category_id='${category}'`:change==='participant-added'?`INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at,joined_via) VALUES('${crypto.randomUUID()}','${conversation}','${peerId}',1,'operator')`:['company-viewer','domain-without-grant'].includes(change)?`UPDATE conversations SET contact_id='${peerId}',requester_id='${peerId}' WHERE id='${conversation}'`:undefined
   result=await app.call(messages,{token,body:{...body,content:'Please help with my request'},...(mutation?{headers:{'x-test-statement':"'system'",'x-test-before-statement':mutation}}:{})})
   await call(`/api/management/projects/${p}/settings`,{method:'PUT',body:{is_available:true,unavailable_message:''},status:200})
  }else if(door==='api')result=await app.call(`/api/v1/conversations/${conversation}/messages`,{token:machine,body})
  else if(door==='widget')result=await app.call(messages,{token:['company-viewer','domain-without-grant'].includes(change)?peer.token:token,body})
  else if(door==='email')result=await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-native-knowledge'},body:{messageId:`matrix-email-${change}`,to:'native-help@example.test',from:'owner-p@example.test',text:content,conversationId:conversation}})
  else if(door==='insight'){
   const subject=['company-viewer','domain-without-grant'].includes(change)?peerId:customer,id=crypto.randomUUID()
   await app.db.batch([
    app.db.prepare("INSERT OR REPLACE INTO context_insights VALUES(?,?,?,'support',?,?, '[]',1,NULL)").bind(id,p,subject,content,JSON.stringify([{id:'read',label:'Read it',text:'Read it',action:'send'}])),
    app.db.prepare('UPDATE context_subjects SET consent=1,bot_enabled=1 WHERE project_id=? AND subject_id=?').bind(p,subject),
    app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.is_contact_tracking_enabled',json('true'),'$.proactive_help_enabled',json('true')) WHERE project_id=?").bind(p)
   ])
   result=await app.call(`/api/conversations/${conversation}/widget-events`,{token:subject===peerId?peer.token:token,body:{action:'useInsight',data:{insight_id:id,button_id:'read',ai_message:{local_id:'insight-ai-'+id},local_id:'insight-contact-'+id}}})
  }else if(door==='ai-auto'){
   // The final uncited response runs through the actual queue/provider boundary.
   // The preview's sources remain server held even when the AI emits no citations.
   await app.db.prepare("INSERT INTO conversation_ai VALUES(?,'knowledge-matrix-ai')").bind(conversation).run()
   answer=content
   await call(`/api/ai-support/projects/${p}/conversations/${conversation}/generations`,{body:{expectedRevision:0},status:202})
   for(const job of await app.takeJobs())await app.runJobs([job])
   const generation=await app.first('SELECT state,error FROM ai_generations WHERE conversation_id=?',conversation)
   assert.equal(generation.state,allowed?'completed':'superseded',`${door}/${change}: ${generation.error}`)
  }else if(door==='scheduled'){
   const due=Date.now()+60000
   const scheduled=(await call(`/api/dashboard/projects/${p}/workflow-schedules`,{body:{conversation_id:conversation,kind:'reply',due_at:due,timezone:'UTC',body:content,owner_id:k.owner.users.owner},status:201})).data.data
   await app.scheduled({'x-test-clock':'advance'},{after:120000})
   const settled=await app.first('SELECT state,reason FROM workflow_schedules WHERE id=?',scheduled.id)
   assert.equal(settled.state,allowed?'sent':'cancelled',`${door}/${change}: ${settled.reason}`)
   if(!allowed)assert.equal(settled.reason,'knowledge_access_changed')
  }else result=await call(messages,{body})
  if(result)assert.equal(result.status,door==='away'?200:allowed?(['email','forward'].includes(door)?201:200):409,`${door}/${change}: ${JSON.stringify(result.data)}`)
  const after=(await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)).n
  assert.equal(after-before,door==='away'?(allowed?2:1):allowed&&!['replay','transcript','forward'].includes(door)?(door==='insight'?2:1):0,`${door}/${change}: persisted disclosure`)
  if(!allowed&&door==='away')assert.equal(await app.first("SELECT 1 FROM messages WHERE conversation_id=? AND actor_role='system'",conversation),null,'away content withheld at its independent writer')
  if(!allowed&&!['replay','away','transcript','forward'].includes(door))assert.equal(await app.first('SELECT 1 FROM conversation_outbox WHERE conversation_id=?',conversation),null,`${door}/${change}: no delivery`)
  if(['transcript','forward'].includes(door))assert.equal(mailCalls.length-beforeMail,allowed?1:0,`${door}/${change}: final mail disclosure`)
  if(door==='replay'){
   const read=await app.call(messages,{token:['company-viewer','domain-without-grant'].includes(change)?peer.token:token,status:200})
   assert.equal(read.data.messages.length,allowed?1:0,`${door}/${change}: transcript replay`)
  }
  if(door==='attachment'&&allowed){
   const signature=createHmac('sha256','fixture-native-knowledge').update(JSON.stringify(['file-v1',p,conversation,mediaIds[0]])).digest('hex').slice(0,32),path=`/api/integrations/email/files/${mediaIds[0]}/${signature}`
   assert.equal((await app.call(path,{token})).status,200,'authorized attachment link rechecks its reader')
   assert.equal((await app.call(path)).status,404,'a signed file link cannot grant restricted knowledge access')
  }
  if(door==='attachment'&&!allowed)assert.equal((await app.call(`/api/conversations/${conversation}/media/${mediaIds[0]}`,{token})).status,404,`${door}/${change}: attachment withheld`)
  console.log(`authority-matrix ${door} / ${change}: expected ${allowed?'admit':'withhold'}, observed ${allowed?'admit':'withhold'}`)
 }
 }finally{k.provider=provider;await grant([customer])}
 // Preserve the high-stakes race assertion in the existing journey.
 const conversation=(await call('/api/conversations',{body:{projectId:p,contactId:customer},status:201})).data.id
 const prepared=(await call(`/api/knowledge/${p}/conversations/${conversation}/articles/${article}/insert`,{body:{mode:'text'},status:200})).data
 const result=await call(`/api/conversations/${conversation}/messages`,{body:{localId:'atomic-prepared-revocation',content:prepared.text,expectedRevision:0},headers:{'x-test-statement':'INSERT INTO messages','x-test-before-statement':`DELETE FROM knowledge_collection_entitlements WHERE project_id='${p}' AND category_id='${category}'`}})
 assert.equal(result.status,409,'revocation in the admitting statement cannot leak prepared text')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)).n,0)
 await grant([customer])
 for(const field of ['cc','bcc']){
  const target=(await call('/api/conversations',{body:{projectId:p,contactId:customer},status:201})).data.id
  const preview=(await call(`/api/knowledge/${p}/conversations/${target}/articles`,{status:200})).data.find(a=>a.id===article)
  const result=await call(`/api/conversations/${target}/messages`,{body:{localId:'prepared-'+field,content:preview.content,expectedRevision:0,[field]:['unauthorized@other.test']}})
  assert.equal(result.status,409,`${field}: every prepared mail recipient is checked at message admission`)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',target)).n,0)
 }
 const pending=(await call('/api/conversations',{body:{projectId:p,contactId:customer},status:201})).data.id
 const pendingText=(await call(`/api/knowledge/${p}/conversations/${pending}/articles`,{status:200})).data.find(a=>a.id===article).content
 const pendingResult=await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-native-knowledge'},body:{messageId:'prepared-pending-cc',to:'native-help@example.test',from:'owner-p@example.test',text:pendingText,conversationId:pending,cc:['new-unauthorized@other.test']}})
 assert.equal(pendingResult.status,409,'pending mail CCs participate in the same final authority check')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',pending)).n,0)
 assert.equal(await app.first('SELECT 1 FROM conversation_outbox WHERE conversation_id=?',pending),null)
}
