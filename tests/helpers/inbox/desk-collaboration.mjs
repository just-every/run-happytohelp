import assert from 'node:assert/strict'

// Teammates collaborate on, merge and forward the same active replacement.
export async function deskCollaboration(f){
 const {app,w,foreign,id,ok,call,get,visitor}=f,sockets=[]
 const connect=async token=>{const response=await app.request(`/api/conversations/${id}/socket?token=${token}`,{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);const ws=response.webSocket,frames=[];ws.accept();ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)));sockets.push(ws);return {ws,frames}}
 try{
  // Socket presence warns in both directions before a public send, without draft bytes.
  const owner=await connect(w.tokens.owner),teammate=await connect(w.tokens.operator),customer=await connect(visitor.token)
  const peer=(stream,user)=>stream.frames.findLast(frame=>frame.type==='presence')?.peers.find(peer=>peer.id===user)
  await app.until(()=>peer(owner,w.users.operator)&&peer(teammate,w.users.owner))
  assert.equal(peer(owner,w.users.operator).typing,false);assert.equal(peer(teammate,w.users.owner).draft,false)
  for(const stream of [owner,teammate])stream.ws.send(JSON.stringify({type:'presence',typing:true,draft:true,content:'Private draft content'}))
  await app.until(()=>peer(owner,w.users.operator)?.typing&&peer(teammate,w.users.owner)?.typing)
  assert.ok(peer(owner,w.users.operator).draft);assert.ok(peer(teammate,w.users.owner).draft)
  for(const stream of [owner,teammate])stream.ws.send(JSON.stringify({type:'presence',typing:false,draft:true}))
  await app.until(()=>peer(owner,w.users.operator)?.draft&&!peer(owner,w.users.operator).typing&&peer(teammate,w.users.owner)?.draft&&!peer(teammate,w.users.owner).typing)
  assert.ok(!JSON.stringify(owner.frames).includes('Private draft content'));assert.ok(!customer.frames.some(frame=>frame.type==='presence'))

  const management=`/api/management/projects/${w.projectId}`
  const inbox=async(role)=> (await app.ok(management+'/notification-inbox',{token:w.tokens[role]})).data
  await ok(`/conversations/${id}/followers`,{user_ids:[]},'owner','PUT')
  const note=await ok(`/conversations/${id}/notes`,{content:`Private @[Operator](user:${w.users.operator}) review`,mention_ids:[w.users.operator]})
  assert.ok((await inbox('operator')).some(entry=>entry.conversation_id===id&&entry.kind==='mention'))
  assert.ok(!(await inbox('admin')).some(entry=>entry.conversation_id===id&&entry.kind==='mention'))
  assert.ok(!(await inbox('owner')).some(entry=>entry.conversation_id===id&&entry.kind==='mention'))
  const beforeNotes=(await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',id)).n
  assert.equal((await call(`/conversations/${id}/notes`,{content:`Private @[Foreign](user:${foreign.users.owner}) review`,mention_ids:[foreign.users.owner]})).status,403)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',id)).n,beforeNotes)
  assert.ok(!(await app.ok(`/api/management/projects/${foreign.projectId}/notification-inbox`,{token:foreign.tokens.owner})).data.some(entry=>entry.conversation_id===id))
  assert.equal((await app.call(management+'/notification-inbox',{token:visitor.token})).status,403)
  assert.equal((await call(`/conversations/${id}/followers`,{user_ids:[foreign.users.owner]},'owner','PUT')).status,403)
  const followers=await ok(`/conversations/${id}/followers`,{user_ids:[w.users.operator]},'owner','PUT')
  assert.deepEqual(followers.followers.map(member=>member.id),[w.users.operator])
  const beforeFollower=new Set((await inbox('operator')).map(entry=>entry.id))
  await ok(`/conversations/${id}/notes`,{content:'Private follower update'})
  assert.ok((await inbox('operator')).some(entry=>!beforeFollower.has(entry.id)&&entry.kind==='follower'&&entry.conversation_id===id))
  assert.equal((await app.call(f.base+`/conversations/${id}/collaboration`,{token:visitor.token})).status,403)
  assert.ok(!customer.frames.some(frame=>['activity','presence'].includes(frame.type)))

  // Personal work stays personal; shared definitions are readable but only maintainers may change them.
  const view=await ok('/ticket-views',{name:'Collaboration queue',visibility:'shared',filters:[],sort:[]})
  const personal=await ok('/ticket-views',{name:'My collaboration queue',visibility:'personal',filters:[],sort:[]},'operator')
  const reply=await ok('/macros',{title:'Shared collaboration reply',content:'Reusable collaboration answer',scope:{visibility:'shared'}})
  const privateReply=await ok('/macros',{title:'My collaboration reply',content:'Private reusable draft',scope:{visibility:'personal'}},'operator')
  assert.equal((await ok(`/ticket-views/${view.id}`,undefined,'operator')).name,view.name)
  assert.equal((await call(`/ticket-views/${personal.id}`)).status,404)
  assert.equal((await call(`/ticket-views/${view.id}`,{...view,name:'Forbidden edit',expected_version:view.version},'operator','PUT')).status,403)
  assert.equal((await ok(`/macros/${reply.id}`,undefined,'operator')).content,reply.content)
  assert.equal((await call(`/macros/${privateReply.id}`)).status,404)
  assert.equal((await call(`/macros/${reply.id}`,{title:'Forbidden edit',expected_version:reply.version},'operator','PUT')).status,403)
  const applied=await ok(`/macros/${privateReply.id}/apply`,{version:privateReply.version,command_id:'private-collaboration-draft',tickets:[{id,expected_version:(await get(id)).ticket_version}]},'operator')
  assert.equal(applied.results[0].status,'applied')
  assert.equal((await ok(`/conversations/${id}/macro-draft`,undefined,'operator')).content,privateReply.content)
  assert.notEqual((await ok(`/conversations/${id}/macro-draft`))?.content,privateReply.content)

  const publicMessages=()=>app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
  const frontier=await get(id),beforeMessages=(await publicMessages()).messages.length
  const commands=[w.tokens.owner,w.tokens.operator].map((token,index)=>({token,body:{localId:'collision-'+index,content:'The replacement is being reviewed '+index,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}}))
  // Start both requests before awaiting either; both carry the same observed frontier.
  const competing=await Promise.all(commands.map(command=>app.call(`/api/conversations/${id}/messages`,command)))
  assert.equal(competing.filter(result=>result.data.accepted).length,1)
  const refused=competing.find(result=>!result.data.accepted)
  assert.ok(refused);assert.equal(refused.data.reason,'conversation_changed_or_admission_denied')
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n,beforeMessages+1)
  const transcript=await publicMessages(),winner=competing.find(result=>result.data.accepted).data.message
  assert.equal(transcript.messages.length,beforeMessages+1)
  assert.equal(transcript.messages.filter(message=>message.local_id?.startsWith('collision-')).length,1)
  assert.equal(transcript.messages.at(-1).id,winner.id)
  for(const privateText of [note.content,'Private follower update','Private draft content',privateReply.content])assert.ok(!JSON.stringify(transcript).includes(privateText))
  // Replaying the admitted command cannot create another customer-visible reply.
  assert.equal((await app.ok(`/api/conversations/${id}/messages`,commands[competing.findIndex(result=>result.data.accepted)])).accepted,true)
  assert.equal((await publicMessages()).messages.length,beforeMessages+1)
  assert.ok(!JSON.stringify(customer.frames).includes('Private'))

  const partner=['synthetic-happytohelp-partner','example.test'].join('@')
  const forward={recipient:partner,message_ids:transcript.messages.map(message=>message.id)}
  const forwardPreview=await ok(`/conversations/${id}/partner-forwards/preview`,forward)
  assert.equal(forwardPreview.private_notes_included,false);assert.deepEqual(forwardPreview.messages.map(message=>message.id),transcript.messages.map(message=>message.id))
  for(const privateId of [note.id,applied.results[0].usage_id]){
   assert.equal((await call(`/conversations/${id}/partner-forwards/preview`,{...forward,message_ids:[privateId]})).status,400)
   assert.equal((await call(`/conversations/${id}/partner-forwards`,{...forward,message_ids:[privateId],subject:'Review',idempotencyKey:'private-forward-'+privateId,expected_version:(await get(id)).ticket_version})).status,400)
  }
  teammate.ws.close();await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==w.users.operator))
  for(const socket of sockets)try{socket.close()}catch{}
  // Reopen the persistent application, then read the same public doors after reload.
  await app.configure({})
  assert.equal((await ok(`/ticket-views/${view.id}`,undefined,'operator')).name,view.name)
  assert.equal((await ok(`/ticket-views/${personal.id}`,undefined,'operator')).name,personal.name)
  assert.equal((await ok(`/macros/${reply.id}`,undefined,'operator')).content,reply.content)
  assert.equal((await ok(`/macros/${privateReply.id}`,undefined,'operator')).content,privateReply.content)
  assert.ok((await ok('/ticket-views',undefined,'operator')).some(saved=>saved.id===personal.id))
  assert.ok(!(await ok('/ticket-views')).some(saved=>saved.id===personal.id))
  assert.ok((await ok('/macros',undefined,'operator')).some(saved=>saved.id===privateReply.id))
  assert.ok(!(await ok('/macros')).some(saved=>saved.id===privateReply.id))
  assert.deepEqual((await publicMessages()).messages.map(message=>message.id),transcript.messages.map(message=>message.id))
  const reconnected=await connect(visitor.token)
  await app.until(()=>reconnected.frames.some(frame=>frame.message?.id===winner.id))
  assert.equal(reconnected.frames.filter(frame=>frame.message?.local_id?.startsWith('collision-')).length,1)
  assert.ok(!JSON.stringify(reconnected.frames).includes('Private'))

  const other=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'Another customer'},headers:{Origin:w.allowedOrigin}})
  const duplicate=await app.ok('/api/conversations',{token:other.token,body:{projectId:w.projectId}})
  await app.ok(`/api/conversations/${duplicate.id}/messages`,{token:other.token,body:{localId:'duplicate-order',content:'Different customer evidence',expectedRevision:0}})
  const mergeBody=async()=>({source_id:duplicate.id,source_version:(await get(duplicate.id)).ticket_version,target_version:(await get(id)).ticket_version})
  const preview=await ok(`/conversations/${id}/merge/preview`,await mergeBody());assert.equal(preview.customer_history_shared,false)
  const merged=await ok(`/conversations/${id}/merge`,await mergeBody())
  assert.ok((await ok(`/conversations/${id}/merged-history`)).some(thread=>thread.conversation_id===duplicate.id))
  assert.ok(!JSON.stringify(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).includes('Different customer evidence'))
  assert.equal((await app.call(`/api/conversations/${duplicate.id}/messages`,{token:visitor.token})).status,404)
  await ok(`/conversations/${id}/merges/${merged.id}/undo`,{})
  const remerged=await ok(`/conversations/${id}/merge`,await mergeBody())
  const current=await get(id)
  await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'merge-frontier',content:'My return is still pending.',expectedRevision:current.revision}})
  assert.equal((await call(`/conversations/${id}/merges/${remerged.id}/undo`,{})).status,409)
 }
 finally{for(const socket of sockets)try{socket.close()}catch{}}
}

// Two separately signed-in teammates use the emitted dashboard, with real conversation sockets.
export async function collaborationBrowser({width=1440,proofOnly=false}={}){
 const {createRuntime}=await import('../emitted-runtime.mjs')
 const {launchBrowser,evidence}=await import('../../journeys/kit/browser.mjs')
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',H2H_LOCAL:'true',EMAIL_PROVIDER:'development'}})
 const browser=await launchBrowser(),shot=await evidence('collaboration'),origin=runtime.origin
 let passed=false
 const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  assert.ok(response.ok,path+': '+response.status);return response.json()
 }
 try{
  const email=who=>[who+'-synthetic-happytohelp','example.test'].join('@'),password='synthetic-happytohelp-password'
  const workspace=await request('/api/identity/bootstrap',{email:email('owner'),password,name:'Collaboration support',ownerName:'Morgan Owner',allowedOrigin:origin})
  const owner=await request('/api/identity/login',{email:email('owner'),password}),projectId=workspace.projectId,management=`/api/management/projects/${projectId}`,base=`/api/dashboard/projects/${projectId}`
  await request(management+'/availability',{is_availability_schedule_enabled:false,is_presence_away_enabled:false},owner.token,'PUT')
  const invitation=await request(management+'/agents',{email:email('operator'),role:'operator'},owner.token)
  await request('/api/identity/accept-token',{token:new URL(invitation.data.invitationUrl).searchParams.get('token'),name:'Taylor Operator',password})
  const operator=await request('/api/identity/login',{email:email('operator'),password})
  const project=await request('/api/identity/projects/'+projectId,undefined,owner.token)
  const visitor=await request('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Collaboration customer'})
  const ticket=await request('/api/conversations',{projectId},visitor.token)
  await request(`/api/conversations/${ticket.id}/messages`,{localId:'collaboration-opening',content:'Please review my replacement.',expectedRevision:0},visitor.token)
  const contexts=[],pages=[],errors=[]
  for(const signedIn of [owner,operator]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:900}})
   contexts.push(context);await context.addCookies([{name:'h2h_session',value:signedIn.token,url:origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));pages.push(page)
   await page.goto(`${origin}/projects/${projectId}/conversations/${ticket.id}`)
   await page.getByPlaceholder('Type your reply…').waitFor()
  }
  const [ownerPage,operatorPage]=pages,line=page=>page.locator('.conversation-presence')
  await line(ownerPage).filter({hasText:'viewing'}).waitFor();await line(operatorPage).filter({hasText:'viewing'}).waitFor()
  await operatorPage.getByPlaceholder('Type your reply…').fill('Private operator draft')
  await line(ownerPage).filter({hasText:'is typing'}).waitFor()
  if(!proofOnly)assert.match(await line(ownerPage).innerText(),/Taylor Operator is typing.*Check before replying/)
  await line(ownerPage).filter({hasText:'has an unsent draft'}).waitFor()
  await ownerPage.getByPlaceholder('Type your reply…').fill('Private owner draft')
  await line(operatorPage).filter({hasText:'is typing'}).waitFor()
  await line(operatorPage).filter({hasText:'has an unsent draft'}).waitFor()
  if(!proofOnly){
   for(const page of pages){
    assert.equal(await line(page).getAttribute('role'),'status')
    assert.ok(await line(page).evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=13))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   }
  }
  await ownerPage.screenshot({path:shot('warnings-'+width+'.png'),fullPage:true})
  // Only the desktop journey asserts the flow; phone proof records this same screen once.
  if(!proofOnly){
   const response=await request(`/api/conversations/${ticket.id}/messages`,undefined,visitor.token)
   assert.deepEqual(response.messages.map(message=>message.content),['Please review my replacement.'])
   await operatorPage.reload();await operatorPage.getByPlaceholder('Type your reply…').waitFor()
   await line(operatorPage).filter({hasText:'has an unsent draft'}).waitFor()
   assert.deepEqual(errors,[])
  }
  for(const context of contexts)await context.close()
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
