import assert from 'node:assert/strict'
import {managedEdge,mime} from './rer-edge.mjs'
import {managedInstallation} from './rer-mail.mjs'

// A MAIL_API_KEY rotation stops the old key at once; the platform rebuilds the app
// with the new one. A reply refused at authenticate in between claimed no relay
// send row, so it is held and the conversation outbox sends it once from the
// rebuilt release. Only the relay is faked: queued `answers` replace its next sends.
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

  // (a) and (e): rotation; the old release's reply is held, survives a restart and a
  // refused retry at the same first refusal instant, then the rebuilt release sends it once.
  let next=rotate()
  const held=await reply('Your refund is on its way.')
  let row=await delivery(held),firstRefusal=row.updated_at
  assert.equal(row.state,'sending');assert.equal(await mailStatus(held),'sending');assert.equal((await i.settings()).managed.outbound.state,'sending')
  await app.configure({})
  await app.scheduled();assert.equal(sends('Your refund is on its way.').length,2,'the outbox resends the held command')
  row=await delivery(held);assert.equal(row.state,'sending');assert.equal(row.updated_at,firstRefusal,'a restart and a refused retry keep the first refusal instant')
  await app.configure({MAIL_API_KEY:next})
  await app.scheduled()
  assert.equal((await delivery(held)).state,'sent');assert.equal(await mailStatus(held),'sent')
  const command=await app.first('SELECT message_key,accepted_at FROM rer_mail_commands WHERE command_id=?',held)
  const attempts=sends('Your refund is on its way.')
  assert.equal(attempts.length,3);assert.ok(attempts.every(send=>send.messageKey===command.message_key),'every request carries the same hashed messageKey')
  assert.deepEqual(attempts.map(send=>send.authority),[...Array(2).fill(attempts[0].authority),`Bearer ${next}`])
  assert.equal(edge.sends.filter(send=>send.payload.messageKey===command.message_key).length,1,'accepted exactly once');assert.ok(command.accepted_at)
  await app.scheduled();assert.equal(sends('Your refund is on its way.').length,3,'an accepted command is never sent again')
  assert.deepEqual(await audit(held),['managed_mail.send_started','managed_mail.send_held','managed_mail.send_held','managed_mail.send_accepted'])

  // (b) mail_credential_required holds the same way and the next pass sends it.
  answers.push(refusal('mail_credential_required'))
  const required=await reply('Your exchange label is attached.')
  assert.equal((await delivery(required)).state,'sending')
  await app.scheduled()
  assert.equal((await delivery(required)).state,'sent')
  const requiredKeys=new Set(sends('Your exchange label is attached.').map(send=>send.messageKey))
  assert.equal(requiredKeys.size,1);assert.equal(edge.sends.filter(send=>requiredKeys.has(send.payload.messageKey)).length,1)

  // (c) a hold older than about an hour fails as an unavailable authority, with no further request.
  next=rotate()
  const expired=await reply('Your order ships tomorrow.')
  firstRefusal=(await delivery(expired)).updated_at
  await app.configure({});await app.scheduled()
  assert.equal((await delivery(expired)).updated_at,firstRefusal)
  const tried=sends('Your order ships tomorrow.').length;await app.scheduled(undefined,{after:86400000})
  row=await delivery(expired);assert.equal(row.state,'failed');assert.equal(row.error,unavailable);assert.equal(sends('Your order ships tomorrow.').length,tried)
  assert.equal(await mailStatus(expired),'failed');assert.equal((await audit(expired)).at(-1),'managed_mail.send_rejected')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox WHERE delivered_at IS NULL')).n,0,'the outbox completes once no hold is open')
 }finally{await i.close()}
}
