import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {campaignsJourney} from './campaigns.mjs'
import {socketClient} from './sockets.mjs'

// Conversation sockets on the real application: scoped REST and socket admission by token, origin and membership,
// durable replay without operator-only data, the operator project stream, private notes live only to operators,
// first-read receipts live to teammates, and a revoked session closing its socket.
export async function socketJourney(){
 const app=await startApp({origin:'https://app.example'})
 const socketTo=socketClient(app)
 try{
  const workspace=await app.seedWorkspace('socket',{allowedOrigin:'https://widget.example'}),p=workspace.projectId,owner=workspace.tokens.owner,teammate=workspace.tokens.operator
  await app.presenceAwayOff(p)
  const session=async()=>(await app.call('/api/identity/widget/session',{body:{widgetKey:workspace.widgetKey},headers:{Origin:'https://widget.example'},status:201})).data
  const contact=await session(),other=await session()
  const conversation=(await app.call('/api/conversations',{token:contact.token,body:{projectId:p},status:201})).data
  const finishVisit=await campaignsJourney({app,workspace,contact,conversation,owner,socketTo})
  const first=(await app.call(`/api/conversations/${conversation.id}/messages`,{token:contact.token,body:{localId:'one',content:'Persistent message',expectedRevision:0},status:200})).data
  await app.db.prepare("UPDATE messages SET content_raw='Private original email body' WHERE id=?").bind(first.message.id).run()
  assert.equal((await app.call(`/api/conversations/${conversation.id}/messages`,{token:other.token})).status,404,'another visitor cannot read the conversation')
  const path=`/api/conversations/${conversation.id}/socket`
  assert.equal((await socketTo(`${path}?token=${contact.token}`,{Origin:'https://foreign.example'})).status,403,'a foreign origin cannot open the socket')
  const visitor=await socketTo(`${path}?token=${contact.token}`,{Origin:'https://widget.example'});assert.equal(visitor.status,101)
  const replay=await visitor.next();assert.equal(replay.type,'message');assert.equal(replay.message.content,'Persistent message');assert.equal('content_raw' in replay.message,false,'the original email body is operator-only')
  assert.equal((await socketTo(`${path}?token=${other.token}&after=${replay.eventId}`,{Origin:'https://widget.example'})).status,404,'a durable cursor conveys no replay authority to another visitor')
  // The operator project stream announces conversation activity; a visitor token cannot open it.
  const project=await socketTo(`/api/projects/${p}/socket`,{Cookie:`h2h_session=${owner}`,Origin:'https://app.example'});assert.equal(project.status,101)
  const projectFrame=await project.next();assert.equal(projectFrame.type,'conversation');assert.equal(projectFrame.conversationId,conversation.id);project.socket.close()
  assert.equal((await socketTo(`/api/projects/${p}/socket?token=${contact.token}`,{Origin:'https://app.example'})).status,403)
  const cookie=await socketTo(`${path}?after=${replay.eventId}`,{Cookie:`h2h_session=${owner}`,Origin:'https://app.example'});assert.equal(cookie.status,101);cookie.socket.close()
  // A private note reaches the teammate's socket at once, never the visitor's; its content stays behind the bucket route.
  const observer=await socketTo(`${path}?after=${replay.eventId}`,{Authorization:`Bearer ${teammate}`,Origin:'https://app.example'});assert.equal(observer.status,101)
  const privateContent='Customer is waiting for the ChargeDesk webhook trace; Morgan will follow up.'
  assert.equal((await app.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}/notes`,{token:owner,body:{content:privateContent}})).status,201)
  assert.equal((await observer.next(frame=>frame.type==='activity')).kind,'note')
  const retained=(await app.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}/buckets`,{token:teammate,status:200})).data
  assert.ok(retained.data.flatMap(bucket=>bucket.events).some(event=>event.content===privateContent))
  const reply=(await app.call(`/api/conversations/${conversation.id}/messages`,{token:owner,body:{localId:'support-reply',content:'The webhook trace is ready for you.',expectedRevision:1},status:200})).data
  const seen=[];const visitorNext=await visitor.next(frame=>{seen.push(frame);return frame.type==='message'});assert.equal(visitorNext.message.id,reply.message.id)
  assert.ok(![...seen,...visitor.frames].some(frame=>frame.type==='activity'||JSON.stringify(frame).includes('ChargeDesk')),'private note activity never reaches the visitor')
  // The visitor's first read reaches the teammate live with the server's timestamp; a second read keeps it.
  const before=Date.now();assert.equal((await app.call(`/api/conversations/${conversation.id}/widget-events`,{token:contact.token,body:{action:'markAsRead',data:{ids:[reply.message.id]}}})).status,200)
  const readRow=()=>app.first("SELECT created_at read_at FROM context_tracked_events WHERE type='MESSAGE_READ' AND json_extract(payload,'$.message_id')=? AND json_extract(payload,'$.reader_id')=?",reply.message.id,contact.contactId)
  const read=await readRow();assert.ok(read.read_at>=before&&read.read_at<=Date.now())
  assert.deepEqual((await observer.next(frame=>frame.type==='activity'&&frame.kind==='read')).reads,[{messageId:reply.message.id,readerId:contact.contactId,readerRole:'contact',readAt:new Date(read.read_at).toISOString()}])
  observer.socket.close()
  await app.call(`/api/conversations/${conversation.id}/widget-events`,{token:contact.token,body:{action:'markAsRead',data:{ids:[reply.message.id]}}});assert.equal((await readRow()).read_at,read.read_at)
  const projection=(await app.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}/buckets`,{token:teammate,status:200})).data
  assert.equal(projection.data.flatMap(bucket=>bucket.messages).find(row=>row.id===reply.message.id).read_by_contacts[contact.contactId],new Date(read.read_at).toISOString())
  // An operator's read acknowledgement carries the committed timestamp; their reply wrote attributed handoff history.
  const ack=(await app.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}/actions`,{token:owner,body:{action:'markAsRead',ids:[first.message.id]},status:200})).data
  assert.equal(ack.receipts.length,1);assert.equal(ack.receipts[0].messageId,first.message.id);assert.equal(ack.receipts[0].readerId,workspace.users.owner);assert.equal(ack.receipts[0].readerRole,'operator');assert.ok(Number.isFinite(ack.counts.unread))
  const acknowledged=(await app.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}/buckets`,{token:owner,status:200})).data
  assert.equal(acknowledged.data.flatMap(bucket=>bucket.messages).find(row=>row.id===first.message.id).read_by_agents[workspace.users.owner],ack.receipts[0].readAt)
  assert.ok(projection.data.flatMap(bucket=>bucket.events).some(event=>event.type==='AGENT_ASSIGNED'&&event.payload.name==='owner socket'),'operator takeover writes attributed handoff history')
  // Full replay and cursor-only catch-up belong to this socket journey, not a
  // second broad first-release installation.
  const full=await socketTo(`${path}?token=${contact.token}`,{Origin:'https://widget.example'}),frames=[await full.next(frame=>frame.type==='message'),await full.next(frame=>frame.type==='message')]
  assert.deepEqual(frames.map(frame=>frame.message.id),[first.message.id,reply.message.id]);assert.deepEqual(frames.map(frame=>frame.message.revision),[1,2]);assert.ok(Number(frames[1].eventId)>Number(frames[0].eventId));assert.equal(frames[1].conversationId,conversation.id);full.socket.close()
  const offline=(await app.call(`/api/conversations/${conversation.id}/messages`,{token:owner,body:{localId:'offline-reply',content:'Corrected invoice sent while offline.',expectedRevision:2,expectedLastMessageId:reply.message.id},status:200})).data
  const resumed=await socketTo(`${path}?token=${contact.token}&after=${frames[1].eventId}`,{Origin:'https://widget.example'}),caught=await resumed.next(frame=>frame.type==='message');assert.equal(caught.message.id,offline.message.id);assert.equal(caught.message.revision,3);assert.ok(Number(caught.eventId)>Number(frames[1].eventId));assert.equal(resumed.frames.filter(frame=>frame.type==='message').length,0);resumed.socket.close()
  const transcript=(await app.call(`/api/conversations/${conversation.id}/messages`,{token:contact.token,status:200})).data;assert.deepEqual(transcript.messages.map(message=>message.revision),[1,2,3]);assert.equal(transcript.lastMessageId,offline.message.id)
  await finishVisit()
  // A revoked visitor session closes its socket and cannot open another.
  await app.call('/api/identity/session',{token:contact.token,method:'DELETE',status:200})
  assert.equal((await app.call(`/api/conversations/${conversation.id}/messages`,{token:contact.token})).status,401)
  const closed=new Promise(resolve=>visitor.socket.addEventListener('close',resolve,{once:true}));visitor.socket.send(JSON.stringify({type:'ping'}));await closed
  assert.equal((await socketTo(`${path}?token=${contact.token}&after=${caught.eventId}`,{Origin:'https://widget.example'})).status,401,'a revoked visitor cannot resume a durable replay cursor')
 }finally{await app.close()}
}
