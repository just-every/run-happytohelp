import assert from 'node:assert/strict'
import {managedEdge,mime} from './rer-edge.mjs'
import {managedInstallation} from './rer-mail.mjs'

// A MAIL_API_KEY rotation stops the old key at once; the platform rebuilds the app
// with the new one. A conversation, problem or scheduled reply refused at
// authenticate in between claimed no relay send row, so it is held and the
// conversation outbox sends it once from the rebuilt release; its problem attempt or
// schedule settles from that outcome, even after its recovery stops. Only the relay is
// faked: queued `answers` replace its next sends.
export async function rerMailHoldJourney(){
 const edge=managedEdge(),relay=edge.outbound,answers=[]
 edge.outbound=async(request,entry)=>request.method==='POST'&&new URL(entry.url).pathname.endsWith('/send')&&answers.length?answers.shift()():relay(request,entry)
 const i=await managedInstallation('hold',{edge}),{app,owner}=i
 try{
  assert.equal((await i.settings()).managed.routeActive,true)
  const received=await i.ingress(mime());assert.equal(received.status,200,JSON.stringify(received.data))
  const conversationId=received.data.conversationId
  await app.scheduled()
  const sends=(text='')=>app.requests.filter(request=>request.method==='POST'&&new URL(request.url).pathname.endsWith('/send')).map(request=>({authority:request.headers.authorization,...JSON.parse(request.body)})).filter(send=>send.text.includes(text))
  const delivery=id=>app.first('SELECT state,error,updated_at FROM email_deliveries WHERE id=?',id)
  const mailStatus=async id=>(await app.ok(`/api/dashboard/projects/${owner.projectId}/conversations/${conversationId}/buckets/${conversationId}`,{token:owner.token})).data.messages.find(message=>`message:${message.id}:notification`===id).email_status.state
  const audit=async id=>(await app.sql("SELECT action FROM audit_events WHERE target_id=? AND action LIKE 'managed_mail.%' ORDER BY rowid",id)).map(row=>row.action)
  let replies=0
  const reply=async content=>{
   const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',conversationId)
   const {message}=await app.ok(`/api/conversations/${conversationId}/messages`,{token:owner.token,body:{localId:`synthetic-hold-${++replies}`,content,expectedRevision:head.revision,expectedLastMessageId:head.last_message_id}})
   const id=`message:${message.id}:notification`
   await app.until(async()=>{const row=await delivery(id);return row&&(row.state!=='sending'||row.error)},{message:'managed send answer'})
   return id
  }
  const rotate=()=>{const key=`synthetic-relay-authority-rotated-${replies}`;edge.installations.set(key,edge.installations.get(app.bindings.MAIL_API_KEY));edge.installations.delete(app.bindings.MAIL_API_KEY);return key}
  const refusal=code=>()=>Response.json({code},{status:401})

  // (d) 403, 402 and a 401 without a credential code fail at once and are never sent again.
  const refused=[]
  for(const answer of [()=>Response.json({code:'mailbox_unavailable'},{status:403}),()=>Response.json({code:'payment_required'},{status:402}),()=>new Response(null,{status:401}),refusal('credential_unknown')]){
   answers.push(answer);const id=await reply(`Refused answer ${refused.length+1}.`);refused.push(id)
   assert.equal((await delivery(id)).state,'failed');assert.equal(await mailStatus(id),'failed')
  }
  const unavailable=(await delivery(refused[2])).error
  await app.scheduled();assert.equal(sends('Refused answer').length,refused.length,'a refused send is final')

  // A problem with two linked email incidents, and two tickets for scheduled replies.
  const problemPath=id=>`/api/dashboard/projects/${owner.projectId}/conversations/${id}/ticket/problem`
  const frontier=async id=>(await app.ok(problemPath(id),{token:owner.token})).data.ticket
  let intake=1
  const open=async from=>{const id=`synthetic-hold-intake-${++intake}`,received=await i.ingress(mime({id,from}),{deliveryId:id,envelopeFrom:from});assert.equal(received.status,200,JSON.stringify(received.data));return received.data.conversationId}
  const problem=await open('problem-requester@example.test'),incidents=[await open('first-incident@example.test'),await open('second-incident@example.test')],tickets=[await open('first-scheduled@example.test'),await open('second-scheduled@example.test')]
  await app.ok(problemPath(problem),{token:owner.token,method:'PATCH',body:{...await frontier(problem),is_problem:true}})
  await app.ok(problemPath(problem)+'/incidents/apply',{token:owner.token,body:{action:'link',tickets:await Promise.all(incidents.map(frontier))}})
  await app.scheduled()
  const solve=async(incident,reply)=>{
   const {preview_id}=(await app.ok(problemPath(problem)+'/solve/preview',{token:owner.token,body:{reply,solve_incidents:true,incident_ids:[incident]}})).data
   const applied=(await app.ok(problemPath(problem)+'/solve/apply',{token:owner.token,body:{preview_id}})).data.results[0]
   const {message_id}=await app.first('SELECT message_id FROM ticket_problem_attempts WHERE preview_id=?',preview_id)
   return {id:`message:${message_id}:notification`,applied,result:async()=>(await app.ok(`${problemPath(problem)}/solve/${preview_id}`,{token:owner.token})).data.results[0]}
  }
  const ownerId=(await app.first("SELECT user_id FROM memberships WHERE project_id=? AND role='owner'",owner.projectId)).user_id
  const schedule=async(ticket,body)=>{
   const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',ticket),due=Date.now()+1000
   const {id}=(await app.ok(`/api/management/projects/${owner.projectId}/workflow-schedules`,{token:owner.token,body:{kind:'reply',conversation_id:ticket,due_at:due,timezone:'UTC',body,owner_id:ownerId,expected_revision:head.revision,expected_last_message_id:head.last_message_id}})).data
   return {due:()=>app.until(async()=>Date.now()>due,{message:'scheduled reply due'}),read:async()=>(await app.ok(`/api/management/projects/${owner.projectId}/workflow-schedules?conversation_id=${ticket}`,{token:owner.token})).data.find(row=>row.id===id)}
  }
  const notification=async scheduled=>`message:${(await scheduled.read()).message_id}:notification`

  // (a) and (e): rotation; the old release's reply, a problem's reply to its incident and a
  // scheduled reply are held and survive a restart and a refused retry at the same first
  // refusal instant, then the rebuilt release sends each once.
  const scheduled=await schedule(tickets[0],'Your replacement ships on Monday.')
  let next=rotate()
  const held=await reply('Your refund is on its way.')
  let row=await delivery(held),firstRefusal=row.updated_at
  assert.equal(row.state,'sending');assert.equal(await mailStatus(held),'sending');assert.equal((await i.settings()).managed.outbound.state,'sending')
  const solved=await solve(incidents[0],'Checkout is working again.')
  assert.equal((await delivery(solved.id)).state,'sending');assert.equal(solved.applied.status,'sending','a held problem reply reads pending, not failed')
  await scheduled.due()
  await app.configure({})
  await app.scheduled();assert.equal(sends('Your refund is on its way.').length,2,'the outbox resends the held command')
  row=await delivery(held);assert.equal(row.state,'sending');assert.equal(row.updated_at,firstRefusal,'a restart and a refused retry keep the first refusal instant')
  const pending=await scheduled.read(),scheduledId=await notification(scheduled)
  assert.equal((await delivery(scheduledId)).state,'sending');assert.equal(pending.state,'sending','a held scheduled reply is pending');assert.notEqual(pending.reason,(await delivery(scheduledId)).error,'it records no resend promise')
  assert.equal((await solved.result()).status,'sending');assert.equal(sends('Checkout is working again.').length,2)
  await app.configure({MAIL_API_KEY:next})
  await app.scheduled()
  assert.equal((await delivery(held)).state,'sent');assert.equal(await mailStatus(held),'sent')
  const command=await app.first('SELECT message_key,accepted_at FROM rer_mail_commands WHERE command_id=?',held)
  const attempts=sends('Your refund is on its way.')
  assert.equal(attempts.length,3);assert.ok(attempts.every(send=>send.messageKey===command.message_key),'every request carries the same hashed messageKey')
  assert.deepEqual(attempts.map(send=>send.authority),[...Array(2).fill(attempts[0].authority),`Bearer ${next}`])
  assert.equal(edge.sends.filter(send=>send.payload.messageKey===command.message_key).length,1,'accepted exactly once');assert.ok(command.accepted_at)
  const resent=[['Checkout is working again.',solved.id],['Your replacement ships on Monday.',scheduledId]]
  for(const [text,id] of resent){
   const key=(await app.first('SELECT message_key FROM rer_mail_commands WHERE command_id=?',id)).message_key,tries=sends(text)
   assert.equal((await delivery(id)).state,'sent');assert.ok(tries.length>1&&tries.every(send=>send.messageKey===key),text)
   assert.equal(tries.at(-1).authority,`Bearer ${next}`);assert.equal(edge.sends.filter(send=>send.payload.messageKey===key).length,1,'accepted exactly once')
  }
  assert.equal((await solved.result()).status,'sent')
  const sent=await scheduled.read();assert.equal(sent.state,'sent');assert.equal(sent.reason,null)
  const accepted=resent.map(([text])=>sends(text).length)
  await app.scheduled();assert.equal(sends('Your refund is on its way.').length,3,'an accepted command is never sent again');assert.deepEqual(resent.map(([text])=>sends(text).length),accepted)
  assert.deepEqual(await audit(held),['managed_mail.send_started','managed_mail.send_held','managed_mail.send_held','managed_mail.send_accepted'])

  // (b) mail_credential_required holds the same way and the next pass sends it.
  answers.push(refusal('mail_credential_required'))
  const required=await reply('Your exchange label is attached.')
  assert.equal((await delivery(required)).state,'sending')
  await app.scheduled()
  assert.equal((await delivery(required)).state,'sent')
  const requiredKeys=new Set(sends('Your exchange label is attached.').map(send=>send.messageKey))
  assert.equal(requiredKeys.size,1);assert.equal(edge.sends.filter(send=>requiredKeys.has(send.payload.messageKey)).length,1)

  // (c) a hold older than about an hour fails as an unavailable authority, with no further
  // request; the problem attempt and the scheduled reply then read failed.
  const lapsing=await schedule(tickets[1],'Your exchange is approved.')
  next=rotate()
  const expired=await reply('Your order ships tomorrow.')
  firstRefusal=(await delivery(expired)).updated_at
  const lapsed=await solve(incidents[1],'Your order is back in stock.'),problemRefusal=(await delivery(lapsed.id)).updated_at
  await lapsing.due()
  await app.configure({});await app.scheduled()
  assert.equal((await delivery(expired)).updated_at,firstRefusal);assert.equal((await delivery(lapsed.id)).updated_at,problemRefusal)
  const lapsingId=await notification(lapsing);assert.equal((await lapsing.read()).state,'sending')
  const texts=['Your order ships tomorrow.','Your order is back in stock.','Your exchange is approved.'],tried=texts.map(text=>sends(text).length)
  await app.scheduled(undefined,{after:86400000})
  row=await delivery(expired);assert.equal(row.state,'failed');assert.equal(row.error,unavailable);assert.deepEqual(texts.map(text=>sends(text).length),tried)
  assert.equal(await mailStatus(expired),'failed');assert.equal((await audit(expired)).at(-1),'managed_mail.send_rejected')
  for(const id of [lapsed.id,lapsingId]){const failed=await delivery(id);assert.equal(failed.state,'failed');assert.equal(failed.error,unavailable)}
  assert.equal((await lapsed.result()).status,'failed')
  const lapsedSchedule=await lapsing.read();assert.equal(lapsedSchedule.state,'failed');assert.notEqual(lapsedSchedule.reason,pending.reason)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox WHERE delivered_at IS NULL')).n,0,'the outbox completes once no hold is open')

  // A held scheduled reply's own recovery fails once on its settle after the accepted resend, stops
  // right after the accepted resend is recorded, or stops between clearing the hold and the request.
  // The later doors settle each from its delivery (sent, or uncertain for the unknown send), never twice.
  await app.configure({MAIL_API_KEY:next})
  const stopped=[]
  for(const [fault,statement,accepted] of [['db-once','workflow_schedules SET state=CASE',1],['db-interrupt','email_deliveries SET state=.,provider_id=coalesce',1],['db-interrupt','SET error=NULL,updated_at=.',0]])stopped.push({fault,statement,accepted,ticket:await open(`stopped-${stopped.length}@example.test`)})
  await app.scheduled()
  for(const [index,entry] of stopped.entries())entry.scheduled=await schedule(entry.ticket,`Your exchange ${index} is confirmed.`)
  next=rotate()
  for(const entry of stopped)await entry.scheduled.due()
  for(let pass=0;pass<10&&(await Promise.all(stopped.map(entry=>entry.scheduled.read()))).some(row=>row.state==='pending');pass++)await app.scheduled()
  await app.configure({MAIL_API_KEY:next})
  for(const entry of stopped){
   const row=await entry.scheduled.read(),outbox=await app.first('SELECT id FROM conversation_outbox WHERE message_id=?',row.message_id)
   entry.id=`message:${row.message_id}:notification`;entry.job={type:'outbox.recover',id:row.message_id,projectId:owner.projectId,conversationId:entry.ticket,outboxId:outbox.id}
   assert.equal(row.state,'sending');assert.equal(row.reason,pending.reason);assert.equal((await delivery(entry.id)).state,'sending')
   entry.key=(await app.first('SELECT message_key FROM rer_mail_commands WHERE command_id=?',entry.id)).message_key
   assert.deepEqual((await app.runJobs([entry.job],{'x-test-fault':entry.fault,'x-test-statement':entry.statement})).retried,[0])
   assert.equal((await entry.scheduled.read()).state,'sending',entry.statement);assert.equal(edge.sends.filter(send=>send.payload.messageKey===entry.key).length,entry.accepted)
  }
  for(const entry of stopped)await app.runJobs([entry.job])
  await app.scheduled();await app.scheduled();await app.configure({});await app.scheduled();await app.scheduled(undefined,{after:86400000})
  for(const entry of stopped){
   const row=await entry.scheduled.read(),cancel=await app.call(`/api/management/projects/${owner.projectId}/workflow-schedules/${row.id}`,{token:owner.token,method:'PATCH',body:{action:'cancel',version:row.version}})
   assert.equal(row.state,entry.accepted?'sent':'uncertain',entry.statement);assert.notEqual(row.reason,pending.reason);assert.equal(cancel.status,409,'a settled schedule cannot be cancelled')
   assert.equal(edge.sends.filter(send=>send.payload.messageKey===entry.key).length,entry.accepted,'never sent twice')
   if(entry.accepted){assert.equal(row.reason,null);assert.equal((await delivery(entry.id)).state,'sent')}
  }
 }finally{await i.close()}
}
