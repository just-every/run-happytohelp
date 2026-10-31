import assert from 'node:assert/strict'
import {recipients} from '../email/app.mjs'

export async function teammateOutcomes(m,brands){
 const {app,mail}=m,[b,foreign]=brands,{w,base,desk,req,visitor,widget}=b,id=widget.id,user=w.users.operator,address=`operator-notify-alpha@example.test`
 const kinds=['assignment','customer_updated','group','follower','mention']
 const inbox=async(token=w.tokens.operator)=>(await app.ok(base+'/notification-inbox',{token})).data
 const preferences=(entries,token=w.tokens.operator)=>app.ok(base+'/notification-preferences',{token,method:'PUT',body:{preferences:entries}})
 const allOff=()=>preferences(kinds.map(kind=>({kind,inbox:false,email:false})))
 const patch=async changes=>req(`${desk}/conversations/${id}/ticket`,{expected_version:(await req(`${desk}/conversations/${id}/ticket`)).data.ticket_version,...changes},'PATCH')
 const followers=user_ids=>req(`${desk}/conversations/${id}/followers`,{user_ids},'PUT')
 const group=(await req(desk+'/ticket-groups',{name:'Notification team',members:[user]})).data
 let serial=0
 const customer=async()=>{const ticket=(await req(`${desk}/conversations/${id}/ticket`)).data;return app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'notify-update-'+(++serial),content:'Customer update '+serial,expectedRevision:ticket.revision,expectedLastMessageId:ticket.last_message_id}})}
 const mention=()=>req(`${desk}/conversations/${id}/notes`,{content:`Please review @[Agent](user:${user}) ${++serial}`,mention_ids:[user]})
 const settle=async()=>{await app.scheduled();await app.scheduled(undefined,{after:61000})}
 await settle()
 // Exercise both delivery choices independently for every native audience.
 for(const kind of kinds)for(const [wantInbox,wantEmail] of [[true,true],[true,false],[false,true],[false,false]]){
  await allOff();await followers([]);await patch({assigned_to:null,group_id:null})
  if(kind==='customer_updated')await patch({assigned_to:user})
  if(kind==='follower')await followers([user])
  if(kind==='group')await patch({group_id:group.id})
  await settle()
  await preferences([{kind,inbox:wantInbox,email:wantEmail}])
  const beforeInbox=new Set((await inbox()).map(n=>n.id)),beforeMail=mail.sent.length
  if(kind==='assignment')await patch({assigned_to:user})
  else if(kind==='mention')await mention()
  else await customer()
  await settle()
  const added=(await inbox()).filter(n=>!beforeInbox.has(n.id)&&n.conversation_id===id)
  assert.deepEqual(added.map(n=>n.kind),wantInbox?[kind]:[],`${kind}: inbox=${wantInbox}, email=${wantEmail}`)
  const delivered=mail.sent.slice(beforeMail).filter(e=>recipients(e.body).includes(address))
  assert.equal(delivered.length,wantEmail?1:0,`${kind} follows its personal email preference`)
  for(const entry of delivered)assert.deepEqual(recipients(entry.body),[address],'teammate mail has one current intended recipient')
  if(wantInbox)assert.ok(added.every(n=>!['pending','awaiting_provider'].includes(n.state)),'inbox exposes the terminal delivery outcome')
 }
 await allOff();await followers([]);await patch({assigned_to:null,group_id:null})
 await preferences([{kind:'mention',inbox:true,email:true}])
 // Provider uncertainty for a native teammate notice is terminal as well.
 mail.respond=entry=>{if(recipients(entry.body).includes(address))throw new Error('accepted teammate notice; response lost')}
 const beforeLost=new Set((await inbox()).map(n=>n.id)),lostAt=mail.sent.length
 await mention();await settle()
 const lost=(await inbox()).find(n=>!beforeLost.has(n.id))
 assert.equal(lost.state,'uncertain')
 assert.equal(mail.sent.slice(lostAt).filter(e=>recipients(e.body).includes(address)).length,1)
 mail.respond=null;await app.configure({});await settle()
 assert.equal((await inbox()).find(n=>n.id===lost.id).state,'uncertain')
 assert.equal(mail.sent.slice(lostAt).filter(e=>recipients(e.body).includes(address)).length,1,'restart never repeats an uncertain teammate send')
 // An unrelated brand/workspace cannot select this teammate, even by a known ID.
 const foreignTicket=foreign.widget.id,foreignPath=`${foreign.desk}/conversations/${foreignTicket}`
 const foreignBefore=mail.sent.length
 assert.equal((await app.call(foreignPath+'/followers',{token:foreign.w.tokens.owner,method:'PUT',body:{user_ids:[user]}})).status,403)
 assert.equal((await app.call(foreignPath+'/notes',{token:foreign.w.tokens.owner,body:{content:`Foreign @[Agent](user:${user})`,mention_ids:[user]}})).status,403,'a mention cannot select a foreign teammate')
 await settle()
 assert.equal(mail.sent.slice(foreignBefore).filter(e=>recipients(e.body).includes(address)).length,0,'another brand grants no notification authority')
 assert.equal((await app.call(`${foreign.desk}/conversations/${foreignTicket}/ticket`,{token:w.tokens.operator})).status,404)
 assert.equal((await app.call(`${foreign.base}/notification-inbox`,{token:w.tokens.operator})).status,403)
 // Removing live brand membership retires pending audiences and old inbox reads.
 await preferences(kinds.map(kind=>({kind,inbox:true,email:true})))
 await followers([user]);await patch({assigned_to:user});await settle()
 await req(`${base}/agents/${user}`,undefined,'DELETE')
 const beforeRevoke=mail.sent.length
 await customer()
 assert.equal((await app.call(`${desk}/conversations/${id}/notes`,{token:w.tokens.owner,body:{content:`Revoked @[Agent](user:${user})`,mention_ids:[user]}})).status,403,'a mention refuses a revoked recipient')
 await settle()
 assert.equal(mail.sent.slice(beforeRevoke).filter(e=>recipients(e.body).includes(address)).length,0,'revoked members receive neither customer updates nor mentions')
 assert.equal((await app.call(base+'/notification-inbox',{token:w.tokens.operator})).status,401,'revoked members cannot read old ticket notices')
 assert.equal((await app.call(`${desk}/conversations/${id}/ticket`,{token:w.tokens.operator})).status,401,'the same current membership gates the ticket')
}
