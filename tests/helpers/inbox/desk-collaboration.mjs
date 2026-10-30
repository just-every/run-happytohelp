import assert from 'node:assert/strict'

// Teammates collaborate on, merge and forward the same active replacement.
export async function deskCollaboration(f){
 const {app,w,foreign,id,ok,call,get,visitor}=f,sockets=[]
 const inbox=async role=>(await app.ok(`/api/management/projects/${w.projectId}/notification-inbox`,{token:w.tokens[role]})).data
 const transcript=()=>app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
 const privateDraft='Private draft content'
 const privateNote=`Private @[Operator](user:${w.users.operator}) review`
 const connect=async token=>{const response=await app.request(`/api/conversations/${id}/socket?token=${token}`,{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);const ws=response.webSocket,frames=[];ws.accept();ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)));sockets.push(ws);return {ws,frames}}
 try{
  const owner=await connect(w.tokens.owner),teammate=await connect(w.tokens.operator),customer=await connect(visitor.token)
  for(const [receiver,peer] of [[owner,w.users.operator],[teammate,w.users.owner]]){
   await app.until(()=>receiver.frames.findLast(frame=>frame.type==='presence')?.peers.some(row=>row.id===peer&&!row.typing&&!row.draft),{message:'the other operator is viewing before either types'})
  }
  owner.ws.send(JSON.stringify({type:'presence',typing:true,draft:true}));teammate.ws.send(JSON.stringify({type:'presence',typing:true,draft:true,content:privateDraft}))
  await app.until(()=>teammate.frames.findLast(frame=>frame.type==='presence')?.peers.some(peer=>peer.id===w.users.owner&&peer.typing&&peer.draft),{message:'the teammate sees the owner typing'})
  const presence=await app.until(()=>owner.frames.find(frame=>frame.type==='presence'&&frame.peers.some(peer=>peer.id===w.users.operator&&peer.typing&&peer.draft)))
  assert.ok(!JSON.stringify(presence).includes('Private draft content'));assert.ok(!customer.frames.some(frame=>frame.type==='presence'))
  for(const socket of [owner,teammate])socket.ws.send(JSON.stringify({type:'presence',typing:false,draft:true}))
  for(const [receiver,peer] of [[owner,w.users.operator],[teammate,w.users.owner]]){
   await app.until(()=>receiver.frames.findLast(frame=>frame.type==='presence')?.peers.some(row=>row.id===peer&&!row.typing&&row.draft),{message:'an unsent draft remains visible after typing stops'})
  }
  const beforePrivate=await transcript()
  await ok(`/conversations/${id}/followers`,{user_ids:[w.users.operator]},'owner','PUT')
  const followers=await ok(`/conversations/${id}/followers`,{user_ids:[w.users.operator,w.users.admin]},'owner','PUT')
  assert.deepEqual(followers.followers.map(row=>row.id).sort(),[w.users.operator,w.users.admin].sort())
  assert.ok((await inbox('admin')).some(row=>row.kind==='follower'&&row.conversation_id===id),'added follower receives an inbox update')
  const note=await ok(`/conversations/${id}/notes`,{content:privateNote,mention_ids:[w.users.operator]})
  assert.ok((await inbox('operator')).some(row=>row.kind==='mention'&&row.conversation_id===id),'permitted mention arrives in the teammate inbox')
  assert.ok((await inbox('admin')).some(row=>row.kind==='follower'&&row.id.includes(note.id)),'an internal note notifies its follower')
  assert.ok(!(await inbox('admin')).some(row=>row.kind==='mention'&&row.id.includes(note.id)),'non-mentioned teammates get no mention')
  assert.deepEqual(await transcript(),beforePrivate,'notes and internal CC updates leave the customer transcript unchanged')
  const notesBefore=await ok(`/conversations/${id}/buckets`),noticesBefore=await inbox('operator')
  assert.equal((await call(`/conversations/${id}/notes`,{content:`Hidden @[Foreign](user:${foreign.users.owner})`,mention_ids:[foreign.users.owner]})).status,403)
  assert.equal((await call(`/conversations/${id}/notes`,{content:'No visible mention',mention_ids:[w.users.operator]})).status,400)
  assert.deepEqual(await ok(`/conversations/${id}/buckets`),notesBefore,'refused mentions create no note')
  assert.deepEqual(await inbox('operator'),noticesBefore,'refused mentions create no notification')
  for(const suffix of ['notes','collaboration','followers'])assert.equal((await app.call(f.base+`/conversations/${id}/${suffix}`,{token:visitor.token,...(suffix==='followers'?{method:'PUT',body:{user_ids:[visitor.contactId]}}:suffix==='notes'?{body:{content:'Customer cannot create private notes'}}:{})})).status,403)
  assert.equal((await app.call(`/api/management/projects/${w.projectId}/notification-inbox`,{token:visitor.token})).status,403)
  assert.equal((await app.call(f.base+`/conversations/${id}/notes`,{token:foreign.tokens.owner,body:{content:'Foreign private note'}})).status,404)
  customer.ws.send(JSON.stringify({type:'ping'}));await app.until(()=>customer.frames.some(frame=>frame.type==='pong'))
  assert.ok(!customer.frames.some(frame=>['presence','activity'].includes(frame.type)),'private collaboration events never reach the customer socket')
  assert.ok(!JSON.stringify(customer.frames).includes(privateNote));assert.ok(!JSON.stringify(customer.frames).includes(privateDraft))
  assert.ok(await app.first("SELECT id FROM notification_inbox WHERE conversation_id=? AND user_id=? AND kind='mention'",id,w.users.operator))
  assert.ok(!(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).messages.some(message=>message.content===note.content))
  assert.equal((await call(`/conversations/${id}/followers`,{user_ids:[foreign.users.owner]},'owner','PUT')).status,403)
  const frontier=await get(id),beforeMessages=(await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n
  const competing=await Promise.all([w.tokens.owner,w.tokens.operator].map((token,index)=>app.call(`/api/conversations/${id}/messages`,{token,body:{localId:'collision-'+index,content:'The replacement is being reviewed '+index,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}})))
  assert.equal(competing.filter(result=>result.data.accepted).length,1)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n,beforeMessages+1)
  assert.ok(competing.some(result=>result.data.accepted===false||result.status===409))
  const refused=competing.find(result=>!result.data.accepted)
  assert.equal(refused.data.reason,'conversation_changed_or_admission_denied','the losing reply is refused at the stale frontier')
  const visible=await transcript(),answers=visible.messages.filter(message=>message.content.startsWith('The replacement is being reviewed '))
  assert.equal(answers.length,1,'exactly one raced reply reaches the customer')
  assert.equal(visible.messages.length,beforeMessages+1)
  assert.equal(answers[0].id,competing.find(result=>result.data.accepted).data.message.id)
  const retry=await app.call(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'stale-after-race',content:'This must remain unsent',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}})
  assert.equal(retry.data.accepted,false);assert.deepEqual(await transcript(),visible)
  customer.ws.send(JSON.stringify({type:'replay'}))
  await app.until(()=>customer.frames.some(frame=>frame.type==='message'&&frame.message.id===answers[0].id))
  assert.equal(new Set(customer.frames.filter(frame=>frame.type==='message'&&frame.message.content.startsWith('The replacement is being reviewed ')).map(frame=>frame.message.id)).size,1)
  assert.ok(!JSON.stringify(customer.frames).includes(privateNote));assert.ok(!JSON.stringify(customer.frames).includes(privateDraft))
  teammate.ws.close();await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==w.users.operator))

  await savedCollaboration(f)
  const recipient=['synthetic-happytohelp-partner','example.test'].join('@')
  const publicMessage=visible.messages[0],forward={recipient,message_ids:[publicMessage.id]}
  const preview=await ok(`/conversations/${id}/partner-forwards/preview`,forward)
  assert.equal(preview.messages.length,1);assert.equal(preview.messages[0].content,publicMessage.content)
  assert.ok(!JSON.stringify(preview).includes(privateNote));assert.ok(!JSON.stringify(preview).includes(privateDraft))
  for(const messageId of [note.id,'synthetic-happytohelp-private-draft']){
   assert.equal((await call(`/conversations/${id}/partner-forwards/preview`,{...forward,message_ids:[messageId]})).status,400)
   assert.equal((await call(`/conversations/${id}/partner-forwards`,{...forward,message_ids:[messageId],subject:'Review',idempotencyKey:'synthetic-happytohelp-private-forward',expected_version:(await get(id)).ticket_version})).status,400)
  }
  assert.deepEqual((await ok(`/conversations/${id}/partner-forwards`)).forwards,[])

  const other=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'Another customer'},headers:{Origin:w.allowedOrigin}})
  const duplicate=await app.ok('/api/conversations',{token:other.token,body:{projectId:w.projectId}})
  await app.ok(`/api/conversations/${duplicate.id}/messages`,{token:other.token,body:{localId:'duplicate-order',content:'Different customer evidence',expectedRevision:0}})
  const mergeBody=async()=>({source_id:duplicate.id,source_version:(await get(duplicate.id)).ticket_version,target_version:(await get(id)).ticket_version})
  const mergePreview=await ok(`/conversations/${id}/merge/preview`,await mergeBody());assert.equal(mergePreview.customer_history_shared,false)
  const merged=await ok(`/conversations/${id}/merge`,await mergeBody())
  assert.ok((await ok(`/conversations/${id}/merged-history`)).some(thread=>thread.conversation_id===duplicate.id))
  assert.ok(!JSON.stringify(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).includes('Different customer evidence'))
  assert.equal((await app.call(`/api/conversations/${duplicate.id}/messages`,{token:visitor.token})).status,404)
  await ok(`/conversations/${id}/merges/${merged.id}/undo`,{})
  const remerged=await ok(`/conversations/${id}/merge`,await mergeBody())
  const current=await get(id)
  await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'merge-frontier',content:'My return is still pending.',expectedRevision:current.revision}})
  assert.equal((await call(`/conversations/${id}/merges/${remerged.id}/undo`,{})).status,409)
  const admin=await connect(w.tokens.admin);let adminClosed=false;admin.ws.addEventListener('close',()=>{adminClosed=true},{once:true})
  await app.ok('/api/identity/session',{token:w.tokens.admin,method:'DELETE'})
  admin.ws.send(JSON.stringify({type:'presence',typing:true,draft:true}))
  await app.until(()=>adminClosed,{message:'revoked teammate socket closes'})
  const revoked=await app.call(f.base+`/conversations/${id}/notes`,{token:w.tokens.admin,body:{content:'Revoked operator note'}})
  assert.equal(revoked.status,401)
  assert.equal((await app.call(`/api/management/projects/${w.projectId}/notification-inbox`,{token:w.tokens.admin})).status,401)
 }
 finally{for(const socket of sockets)try{socket.close()}catch{}}
 await privateForward(f)
}

// Personal and shared queue definitions and reusable replies are re-read through
// the same routes a reloaded dashboard uses, including denied edits and reads.
async function savedCollaboration({app,w,foreign,id,ok,call,get,base}){
 const personal=await ok('/ticket-views',{name:'My replacement work',visibility:'personal',filters:[],sort:[]},'operator')
 const shared=await ok('/ticket-views',{name:'Team replacement work',visibility:'shared',filters:[],sort:[]})
 assert.equal((await ok(`/ticket-views/${personal.id}`,undefined,'operator')).name,personal.name)
 assert.ok(!(await ok('/ticket-views')).some(view=>view.id===personal.id))
 assert.equal((await call(`/ticket-views/${personal.id}`)).status,404)
 assert.equal((await call('/ticket-views',{name:'Unpermitted shared view',visibility:'shared'},'operator')).status,403)
 assert.equal((await call(`/ticket-views/${shared.id}`,{...shared,name:'Unauthorized edit',expected_version:shared.version},'operator','PUT')).status,403)
 assert.equal((await ok(`/ticket-views/${shared.id}`,undefined,'operator')).name,shared.name)
 assert.ok((await ok(`/conversations?saved_view=${shared.id}`,undefined,'operator')).some(ticket=>ticket.id===id))
 assert.equal((await app.call(base+`/ticket-views/${shared.id}`,{token:foreign.tokens.owner})).status,403)
 const own=await ok('/macros',{title:'My reusable replacement reply',content:'Private reusable draft',scope:{visibility:'personal'}},'operator')
 const reply=await ok('/macros',{title:'Team reusable replacement reply',content:'We are checking your replacement.',scope:{visibility:'shared'}})
 assert.equal((await ok(`/macros/${own.id}`,undefined,'operator')).content,own.content)
 assert.ok(!(await ok('/macros')).some(macro=>macro.id===own.id))
 assert.equal((await call(`/macros/${own.id}`)).status,404)
 assert.equal((await call(`/macros/${reply.id}`,{content:'Unauthorized edit',expected_version:reply.version},'operator','PUT')).status,403)
 assert.equal((await ok(`/macros/${reply.id}`,undefined,'operator')).content,reply.content)
 const applied=await ok(`/macros/${own.id}/apply`,{version:own.version,command_id:'synthetic-happytohelp-private-macro',tickets:[{id,expected_version:(await get(id)).ticket_version}]},'operator')
 assert.equal(applied.results[0].status,'applied')
 assert.equal((await ok(`/conversations/${id}/macro-draft`,undefined,'operator')).content,own.content)
 assert.equal((await call(`/conversations/${id}/macro-draft`)).data.data,null,'another operator cannot read the saved draft')
}

// Two native password sessions use the built inbox. Assertions run at desktop
// width; the same live warning is also captured at phone width for review.
export async function deskCollaborationBrowser(){
 const {createRuntime}=await import('../emitted-runtime.mjs')
 const {launchBrowser,auditPage,viewports,evidence}=await import('../../journeys/kit/browser.mjs')
 const runtime=await createRuntime(),browser=await launchBrowser(),shot=await evidence('collaboration'),origin=runtime.origin
 let passed=false
 const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data
 }
 try{
  const email=['synthetic-happytohelp-owner','example.test'].join('@'),password='synthetic-happytohelp-password'
  const initial=await request('/api/identity/bootstrap',{email,password,name:'Collaboration workspace',ownerName:'Alex Owner',allowedOrigin:origin})
  const owner=await request('/api/identity/login',{email,password}),projectId=initial.projectId,base=`/api/dashboard/projects/${projectId}`
  await request(`/api/management/projects/${projectId}/availability`,{is_availability_schedule_enabled:false,is_presence_away_enabled:false},owner.token,'PUT')
  const teammateEmail=['synthetic-happytohelp-operator','example.test'].join('@')
  const invitation=await request(`/api/management/projects/${projectId}/agents`,{email:teammateEmail,role:'operator'},owner.token)
  await request('/api/identity/accept-token',{token:new URL(invitation.data.invitationUrl).searchParams.get('token'),name:'Casey Operator',password})
  const teammate=await request('/api/identity/login',{email:teammateEmail,password})
  const project=await request('/api/identity/projects/'+projectId,undefined,owner.token)
  const visitor=await request('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Replacement customer'})
  const ticket=await request('/api/conversations',{projectId},visitor.token),id=ticket.id
  await request(`/api/conversations/${id}/messages`,{localId:'synthetic-happytohelp-browser-question',content:'Please review my replacement.',expectedRevision:0},visitor.token)
  const contexts=await Promise.all([owner,teammate].map(async actor=>{const context=await browser.newContext({viewport:viewports.desktop});await context.addCookies([{name:'h2h_session',value:actor.token,url:origin}]);return context}))
  const pages=await Promise.all(contexts.map(context=>context.newPage())),errors=[]
  for(const page of pages){page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))}
  const path=`${origin}/projects/${projectId}/conversations/${id}`
  await Promise.all(pages.map(page=>page.goto(path)))
  const [ownerPage,teammatePage]=pages
  await ownerPage.locator('.conversation-presence').filter({hasText:'Casey Operator viewing'}).waitFor()
  await teammatePage.locator('.conversation-presence').filter({hasText:'Alex Owner viewing'}).waitFor()
  await Promise.all(pages.map((page,index)=>page.getByRole('textbox',{name:'Reply to conversation',exact:true}).fill(`Private unsent browser draft ${index}`)))
  await ownerPage.locator('.conversation-presence').filter({hasText:'Casey Operator is typing'}).waitFor()
  await teammatePage.locator('.conversation-presence').filter({hasText:'Alex Owner is typing'}).waitFor()
  await ownerPage.locator('.conversation-presence').filter({hasText:'Casey Operator has an unsent draft'}).waitFor()
  await teammatePage.locator('.conversation-presence').filter({hasText:'Alex Owner has an unsent draft'}).waitFor()
  for(const page of pages){assert.match(await page.locator('.conversation-presence').innerText(),/Check before replying/);assert.ok(await page.getByRole('button',{name:'Send',exact:true}).isEnabled())}
  assert.equal((await request(`/api/conversations/${id}/messages`,undefined,visitor.token)).messages.length,1,'typing and drafts send no customer reply')
  await auditPage(ownerPage,shot('warning-1440.png'))
  await ownerPage.setViewportSize(viewports.mobile);await ownerPage.screenshot({path:shot('warning-390.png'),fullPage:true});await ownerPage.setViewportSize(viewports.desktop)
  const saved=await request(base+'/macros',{title:'Replacement status',content:'Saved replacement reply awaiting review',scope:{visibility:'personal'}},teammate.token)
  const current=(await request(base+`/conversations/${id}/ticket`,undefined,teammate.token)).data
  const applied=await request(base+`/macros/${saved.data.id}/apply`,{version:saved.data.version,command_id:'synthetic-happytohelp-browser-macro',tickets:[{id,expected_version:current.ticket_version}]},teammate.token)
  assert.equal(applied.data.results[0].status,'applied')
  const view=await request(base+'/ticket-views',{name:'My replacement work',visibility:'personal',filters:[],sort:[]},teammate.token)
  await teammatePage.reload()
  assert.equal(await teammatePage.getByRole('textbox',{name:'Reply to conversation',exact:true}).inputValue(),saved.data.content,'reload restores the saved reusable reply draft')
  await ownerPage.locator('.conversation-presence').filter({hasText:'Casey Operator has an unsent draft'}).waitFor()
  await teammatePage.goto(`${origin}/projects/${projectId}/conversations?view=open`)
  await teammatePage.locator('nav[data-testid="inbox-views"]').getByRole('link',{name:view.data.name,exact:true}).click()
  await teammatePage.waitForURL(url=>url.searchParams.get('saved_view')===view.data.id)
  await teammatePage.locator('.conversation-list-items').getByText('Replacement customer',{exact:true}).click()
  assert.equal(await teammatePage.getByRole('textbox',{name:'Reply to conversation',exact:true}).inputValue(),saved.data.content)
  const transcript=await request(`/api/conversations/${id}/messages`,undefined,visitor.token)
  assert.equal(transcript.messages.length,1);assert.ok(!JSON.stringify(transcript).includes(saved.data.content))
  assert.deepEqual(errors,[]);passed=true
 }finally{await browser.close();await runtime.close(passed)}
}

async function privateForward({app,w,id,ok,get,visitor}){
 const before={...app.bindings},address=name=>['synthetic-happytohelp-'+name,'example.test'].join('@')
 await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-1',EMAIL_FROM:address('sender')})
 try{
  await app.ok(`/api/management/projects/${w.projectId}/email-settings`,{token:w.tokens.owner,method:'PUT',body:{from_address:address('sender'),inbound_address:address('inbound'),is_enabled:true}})
  const transcript=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token}),selected=transcript.messages[0]
  const result=await ok(`/conversations/${id}/partner-forwards`,{recipient:address('partner'),message_ids:[selected.id],subject:'Replacement review',idempotencyKey:'synthetic-happytohelp-public-forward',expected_version:(await get(id)).ticket_version})
  assert.equal(result.state,'sent')
  const copies=app.requests.filter(request=>new URL(request.url).hostname==='api.resend.com').map(request=>JSON.parse(request.body)).filter(body=>JSON.stringify(body.to).includes(address('partner')))
  assert.equal(copies.length,1);assert.ok(copies[0].text.includes(selected.content))
  for(const privateText of ['Private draft content','Private @[Operator]','Private reusable draft'])assert.ok(!JSON.stringify(copies[0]).includes(privateText),'forward contains no private note or draft')
  assert.deepEqual(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token}),transcript,'forwarding never publishes internal work to the customer')
 }finally{await app.configure({EMAIL_PROVIDER:before.EMAIL_PROVIDER,EMAIL_API_KEY:before.EMAIL_API_KEY,EMAIL_FROM:before.EMAIL_FROM})}
}
