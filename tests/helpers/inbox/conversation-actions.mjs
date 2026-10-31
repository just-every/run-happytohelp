import assert from 'node:assert/strict'
import {mailApp,message,recipients,replyTo} from '../email/app.mjs'

// CONVERSATION-002: inbox commands and projections on real D1/R2. Only the
// existing DNS/mail provider edge is fake; all business state enters by routes.
export async function conversationActionsJourney(){
 const m=await mailApp(),{app,mail,operator}=m,base='/api/dashboard/projects/p'
 const ticket=id=>`${base}/conversations/${id}`
 const read=async(path,body,method)=>{
  const result=await app.ok(path,{headers:operator,body,method})
  return result.data??result
 }
 const state=id=>read(ticket(id)+'/ticket')
 const history=id=>read(ticket(id)+'/merged-history')
 const journal=id=>read(ticket(id)+'/merges')
 const reports=()=>read(base+'/reports?days=7')
 const mergeBody=async(source,target)=>({source_id:source,source_version:(await state(source)).ticket_version,target_version:(await state(target)).ticket_version})
 const rejected=async(path,body,status)=>{
  const result=await app.call(path,{headers:operator,body})
  assert.equal(result.status,status,JSON.stringify(result.data));return result.data
 }
 try{
  // Seed only native account authority, as mailApp seeds its operator session.
  await app.db.batch([
   app.db.prepare("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='op'"),
   app.db.prepare("UPDATE sessions SET role='owner' WHERE actor_id='op'"),
  ])
  const calendar=await read(base+'/workflow-calendars',{name:'Merge commitments',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})
  const policy=await read(base+'/sla-policies',{name:'Merge service',calendar_id:calendar.id,position:1,conditions:{priorities:[],plans:[],channels:[],brands:[]},first_response_minutes:60,next_response_minutes:120,resolution_minutes:480})
  const fileBytes='Original duplicate receipt bytes'
  const mime=['--merge-file','Content-Type: text/plain','','Source customer evidence','--merge-file','Content-Type: text/plain','Content-Disposition: attachment; filename=receipt.txt','Content-Transfer-Encoding: base64','',Buffer.from(fileBytes).toString('base64'),'--merge-file--',''].join('\r\n')
  assert.equal(await m.email(message({id:'merge-source@example.com',to:'inbound@example.com',from:'source@example.com',subject:'Duplicate return',type:'multipart/mixed; boundary=merge-file',text:mime}),{from:'source@example.com',to:'inbound@example.com'}),undefined)
  const sourceMessage=await m.admitted('merge-source@example.com'),source=sourceMessage.conversation_id
  const incoming={messageId:'merge-target',to:'inbound@example.com',from:'customer@example.com',subject:'Duplicate return',text:'Selected customer evidence'}
  assert.equal((await m.gateway(incoming)).status,201)
  const targetMessage=await m.admitted(incoming.messageId),target=targetMessage.conversation_id
  assert.notEqual(source,target)
  assert.equal((await m.gateway({...incoming,messageId:'merge-unselected',text:'Unselected customer evidence'})).status,201)
  const notes=[]
  for(const id of [source,target])notes.push(await read(ticket(id)+'/notes',{content:`Private merge note for ${id}`}))
  await read(ticket(source),{resolved:true},'PUT')
  await app.scheduled()

  const beforeTickets=await Promise.all([source,target].map(state))
  const beforeHistory=await Promise.all([source,target].map(history))
  const slaEvidence=async id=>{
   const sla=await read(ticket(id)+'/sla')
   assert.equal(sla.policy.id,policy.id)
   // Running clocks accrue ordinary time; their commitments and completions
   // must retain their original ticket and cycle across merge/undo.
   return sla.clocks.map(({metric,cycle,started_at,completed_at})=>({metric,cycle,started_at,completed_at}))
  }
  const beforeSla=await Promise.all([source,target].map(slaEvidence))
  assert.ok(beforeSla[0].some(clock=>clock.metric==='resolution'&&clock.completed_at!==null))
  assert.ok(beforeSla[1].some(clock=>clock.metric==='resolution'&&clock.completed_at===null))
  const beforeReport=await reports()
  assert.equal(beforeReport.volume,2);assert.equal(beforeReport.aiResolution.total,1)
  assert.equal(beforeReport.daily.reduce((n,day)=>n+day.conversations,0),2)
  assert.equal(beforeReport.daily.reduce((n,day)=>n+day.resolved,0),1)
  const attempts=mail.attempts,body=await mergeBody(source,target)
  const preview=await read(ticket(target)+'/merge/preview',body)
  assert.equal(preview.source_id,source);assert.equal(preview.target_id,target)
  assert.equal(preview.customer_sends,0);assert.equal(preview.customer_identity_changes,false)
  assert.equal(preview.customer_history_shared,false);assert.equal(preview.status_changes,false)
  assert.match(preview.private_notes,/no notes are forwarded/i)
  assert.match(preview.outcome_treatment,/retain their own resolution and SLA evidence/)
  assert.match(preview.channel_restrictions,/surviving ticket.*original recipient and channel/)
  for(const row of preview.tickets){
   assert.equal(row.private_notes,1);assert.equal(row.channel,'email')
   assert.equal(row.customer_email,row.id===source?'source@example.com':'customer@example.com')
   assert.equal(row.messages,row.id===source?1:2);assert.equal(row.attachments,row.id===source?1:0)
  }
  assert.equal(preview.tickets.length,2)
  assert.deepEqual(await journal(target),[],'preview is read-only')
  await rejected(ticket(target)+'/merge',{...body,source_version:body.source_version-1},409)
  const merged=await read(ticket(target)+'/merge',body)
  assert.equal(merged.source_id,source);assert.equal(merged.target_id,target)
  const records=await journal(target)
  assert.equal(records.length,1);assert.equal(records[0].id,merged.id)
  assert.equal(records[0].actor_id,'op');assert.equal(records[0].undone_at,null)
  assert.deepEqual(await journal(source),records)

  const preserved=async()=>{
   for(const id of [target,source]){
    const threads=await history(id)
    assert.deepEqual(threads.map(thread=>thread.conversation_id),[target,source])
    for(const [index,original] of beforeHistory.entries()){
     const thread=threads.find(row=>row.conversation_id===[source,target][index])
     assert.deepEqual(thread,original[0],'each source retains its own messages, authors, files, notes and link')
     assert.equal(thread.source_link,`/conversations/${thread.conversation_id}`)
    }
   }
   for(const [index,id] of [source,target].entries()){
    const current=await state(id),before=beforeTickets[index]
    for(const key of ['contact_id','requester_id','channel','revision','last_message_id','status_category','resolved_at'])assert.equal(current[key],before[key],`${id} retains ${key}`)
    assert.deepEqual(await slaEvidence(id),beforeSla[index])
   }
   const file=(await history(target)).find(thread=>thread.conversation_id===source).buckets.flatMap(bucket=>bucket.messages).flatMap(msg=>msg.media)[0]
   assert.ok(file);assert.equal(await (await app.request(file.url,{headers:operator})).text(),fileBytes)
   for(const note of notes)assert.ok(JSON.stringify(await history(target)).includes(note.content))
  }
  await preserved()
  const mergedReport=await reports()
  assert.equal(mergedReport.volume,1);assert.equal(mergedReport.aiResolution.total,0)
  assert.equal(mergedReport.daily.reduce((n,day)=>n+day.conversations,0),1)
  assert.equal(mergedReport.daily.reduce((n,day)=>n+day.resolved,0),0)
  assert.equal((await read(ticket(source))).merged_into,target)
  await rejected(ticket(target)+'/merge',body,409)
  assert.equal((await journal(target)).length,1)
  await app.scheduled();assert.equal(mail.attempts,attempts,'merge creates no customer mail or replay')

  // Safe undo restores the report cohort without moving either source's data.
  assert.equal((await read(ticket(target)+`/merges/${merged.id}/undo`,{})).undone,true)
  const restored=await reports()
  assert.deepEqual(restored,beforeReport)
  for(const [index,id] of [source,target].entries())assert.deepEqual(await history(id),beforeHistory[index])
  assert.ok((await journal(source))[0].undone_at)
  const active=await read(ticket(target)+'/merge',await mergeBody(source,target))

  // A foreign native ticket exists, but neither direction of the merge door
  // may reveal or mutate it, including when an operator names a real version.
  const foreign=await app.seedWorkspace('merge-foreign')
  const visitor=await app.ok('/api/identity/widget/session',{headers:{Origin:foreign.allowedOrigin},body:{widgetKey:foreign.widgetKey,name:'Foreign customer'}})
  const foreignTicket=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:foreign.projectId}})
  const foreignPath=`/api/dashboard/projects/${foreign.projectId}/conversations/${foreignTicket.id}`
  const foreignState=(await app.ok(foreignPath+'/ticket',{token:foreign.tokens.owner})).data
  for(const suffix of ['/merge/preview','/merge']){
   await rejected(ticket(target)+suffix,{source_id:foreignTicket.id,source_version:foreignState.ticket_version,target_version:(await state(target)).ticket_version},404)
   await rejected(foreignPath+suffix,{source_id:target,source_version:(await state(target)).ticket_version,target_version:foreignState.ticket_version},404)
  }
  assert.deepEqual((await app.ok(foreignPath+'/merges',{token:foreign.tokens.owner})).data,[])
  assert.deepEqual((await app.ok(foreignPath+'/ticket',{token:foreign.tokens.owner})).data,foreignState)

  const forward={recipient:'partner@example.net',subject:'Review duplicate return',note:'Please inspect this selected evidence.',message_ids:[targetMessage.id],idempotencyKey:'merge-partner-once',expected_version:(await state(target)).ticket_version}
  const forwardPreview=await read(ticket(target)+'/partner-forwards/preview',forward)
  assert.equal(forwardPreview.private_notes_included,false);assert.equal(forwardPreview.external_participant,true)
  assert.equal(forwardPreview.reply_visibility,'private');assert.equal(forwardPreview.customer_notified,false)
  assert.equal(forwardPreview.channel,'email');assert.equal(forwardPreview.customer_identity.email,'customer@example.com')
  assert.deepEqual(forwardPreview.messages.map(msg=>msg.id),[targetMessage.id])
  await rejected(ticket(target)+'/partner-forwards/preview',{...forward,message_ids:[notes[1].id]},400)
  await rejected(ticket(target)+'/partner-forwards',{...forward,message_ids:[notes[1].id]},400)
  const beforeForward=mail.sent.length,beforeSend=mail.attempts
  const sent=await read(ticket(target)+'/partner-forwards',forward)
  assert.equal(sent.state,'sent')
  assert.equal((await read(ticket(target)+'/partner-forwards',forward)).id,sent.id)
  await app.scheduled()
  assert.equal(mail.attempts,beforeSend+1)
  const outbound=mail.sent.slice(beforeForward)
  assert.equal(outbound.length,1);assert.deepEqual(recipients(outbound[0].body),['partner@example.net'])
  assert.match(outbound[0].body.text,/Selected customer evidence/)
  for(const forbidden of ['Unselected customer evidence','Source customer evidence',...notes.map(note=>note.content)])assert.ok(!JSON.stringify(outbound).includes(forbidden),`outbound excludes ${forbidden}`)
  const unsafe=await rejected(ticket(target)+`/merges/${active.id}/undo`,{},409)
  assert.match(JSON.stringify(unsafe),/Unsafe undo/)
  const incomingReply={messageId:'merge-partner-reply',to:replyTo(outbound[0].body),from:'partner@example.net',text:'Partner confirmed the replacement privately'}
  assert.equal((await m.gateway({...incomingReply,from:'attacker@example.net'})).status,403)
  assert.equal((await m.gateway(incomingReply)).status,201)
  assert.equal((await m.gateway(incomingReply)).status,200)
  await app.configure({})
  assert.equal((await m.gateway(incomingReply)).status,200,'partner reply remains deduplicated after restart')
  const privateThread=await read(ticket(target)+'/partner-forwards')
  assert.equal(privateThread.visibility,'private');assert.equal(privateThread.forwards.length,1)
  assert.equal(privateThread.forwards[0].id,sent.id);assert.equal(privateThread.forwards[0].recipient,'partner@example.net')
  assert.deepEqual(JSON.parse(privateThread.forwards[0].message_ids_json),[targetMessage.id])
  assert.equal(privateThread.replies.length,1);assert.equal(privateThread.replies[0].forward_id,sent.id)
  assert.equal(privateThread.replies[0].content,incomingReply.text);assert.equal(privateThread.replies[0].conversation_id,target)
  const customerThread=await read(`/api/conversations/${target}/messages`)
  assert.ok(!JSON.stringify(customerThread).includes(incomingReply.text))
  const participants=(await read(ticket(target))).participants
  assert.ok(!participants.some(participant=>participant.email==='partner@example.net'))
  await app.scheduled();assert.equal(mail.attempts,beforeSend+1,'partner activity never sends to either customer')
  assert.equal((await journal(target)).find(row=>row.id===active.id).undone_at,null)
  assert.deepEqual(await reports(),mergedReport)
  await preserved()
 }finally{await m.close()}
}
