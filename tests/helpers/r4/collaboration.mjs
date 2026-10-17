import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'

/** Two operators and a visitor through the real router, D1 and conversation Durable Object. */
export async function collaborationJourney({onStep=()=>{}}={}){
 onStep('starting app')
 const app=await startApp({captureQueue:true})
 onStep('app started')
 const sockets=[]
 try{
  const workspace=await app.seedWorkspace('collaboration'),foreign=await app.seedWorkspace('foreign-collaboration')
  const {projectId,tokens,users}=workspace
  await app.db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,1)').bind(projectId,users.admin,'collaborator').run()
  // Collaborator is represented by an operator membership plus the effective role assignment.
  await app.db.batch([
   app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(projectId,users.admin),
   app.db.prepare("UPDATE sessions SET role='operator' WHERE actor_id=?").bind(users.admin),
  ])
  onStep('workspace seeded')
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:workspace.widgetKey,name:'Visitor'}})
  const ticket=await app.ok('/api/conversations',{token:visitor.token,body:{projectId}})
  const path=`/api/dashboard/projects/${projectId}/conversations/${ticket.id}`
  const call=(suffix,token=tokens.owner,body,method=body===undefined?'GET':'POST',headers={})=>app.call(path+suffix,{token,body,method,headers})
  const connect=async token=>{
   const response=await app.request(`/api/conversations/${ticket.id}/socket?token=${token}`,{headers:{Upgrade:'websocket'}})
   assert.equal(response.status,101)
   const ws=response.webSocket,frames=[];ws.accept();ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)))
   const socket={ws,frames,closed:false};ws.addEventListener('close',()=>{socket.closed=true});sockets.push(socket);return socket
  }
  onStep('opening sockets')
  const owner=await connect(tokens.owner),operator=await connect(tokens.operator),contact=await connect(visitor.token)
  onStep('sockets open')
  owner.ws.send(JSON.stringify({type:'presence',typing:false,draft:false}))
  operator.ws.send(JSON.stringify({type:'presence',typing:true,draft:true,content:'must never be transmitted'}))
  onStep('awaiting active presence')
  const active=await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence'&&frame.peers.some(peer=>peer.id===users.operator&&peer.typing&&peer.draft)))
  assert.ok(active.peers.some(peer=>peer.id===users.owner),'two current operators see each other')
  assert.ok(!JSON.stringify(active).includes('must never be transmitted'),'presence carries flags only')
  assert.ok(!contact.frames.some(frame=>frame.type==='presence'),'visitor never receives operator presence')
  assert.equal((await call('/collaboration',visitor.token)).status,403)
  onStep('presence received, checking mutations')
  assert.equal((await call('/followers',tokens.owner,{user_ids:[foreign.users.owner]},'PUT')).status,403)
  assert.equal((await call('/followers',tokens.admin,{user_ids:[users.operator]},'PUT')).status,403,'collaborators cannot change internal CC')
  assert.equal((await call('/followers',tokens.owner,{user_ids:[users.operator]},'PUT')).status,200)
  const followed=(await call('/followers')).data.data
  assert.ok(followed.followers.some(row=>row.id===users.operator))
  assert.equal((await call('/follow',tokens.admin,{},'POST')).status,200,'collaborators may follow themselves')
  assert.equal((await call('/notes',tokens.admin,{content:`Please review @[Owner](user:${users.owner})`,mention_ids:[users.owner]})).status,201)
  const notesBefore=await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',ticket.id)
  assert.equal((await call('/notes',tokens.owner,{content:`Foreign @[Person](user:${foreign.users.owner})`})).status,403)
  assert.equal((await call('/notes',tokens.owner,{content:'No visible mention',mention_ids:[users.operator]})).status,400)
  assert.deepEqual(await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',ticket.id),notesBefore)
  const privateUpload=await app.ok(`/api/conversations/${ticket.id}/media`,{token:tokens.owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'private-review.txt'},body:'Private attachment bytes'})
  assert.equal((await app.call(`/api/conversations/${ticket.id}/media/${privateUpload.id}`,{token:visitor.token})).status,404,'unused operator uploads stay private')
  assert.equal((await call('/notes',tokens.operator,{content:'Cannot take another operator upload',media_ids:[privateUpload.id]})).status,403)
  assert.equal((await call('/notes',tokens.owner,{content:'Resolve {{ticket.custom.missing}}',media_ids:[privateUpload.id]})).status,422)
  const note=await call('/notes',tokens.owner,{content:`Private @[Operator](user:${users.operator})`,mention_ids:[users.operator],media_ids:[privateUpload.id]})
  assert.equal(note.status,201)
  assert.equal(note.data.data.media.length,1)
  assert.equal((await app.call(note.data.data.media[0].url,{token:tokens.owner})).status,200)
  assert.equal((await app.call(note.data.data.media[0].url,{token:visitor.token})).status,404,'private note bytes never become visitor attachments')
  assert.equal((await app.call(`/api/conversations/${ticket.id}/messages`,{token:tokens.owner,body:{localId:'cannot-publish-private-attachment',content:'Public',mediaIds:[privateUpload.id],expectedRevision:0}})).data.accepted,false,'private note media cannot be rebound to a public message')
  assert.equal((await call('/notes',tokens.owner,{content:'Cannot reuse committed attachment',media_ids:[privateUpload.id]})).status,403)
  assert.deepEqual((await app.sql('SELECT user_id FROM conversation_note_mentions WHERE note_id=?',note.data.data.id)).map(row=>row.user_id),[users.operator])
  assert.ok(await app.first("SELECT 1 FROM notification_inbox WHERE project_id=? AND user_id=? AND kind='mention'",projectId,users.operator),'mention reaches teammate notification inbox')
  assert.ok(await app.first("SELECT 1 FROM notification_inbox WHERE project_id=? AND user_id=? AND kind='follower'",projectId,users.operator),'new follower gets teammate notification')
  assert.equal((await app.call(`/api/conversations/${ticket.id}/messages`,{token:tokens.admin,body:{content:'Public reply forbidden',localId:'collaborator-denied',expectedRevision:0}})).status,403)
  const memberRace=await call('/notes',tokens.owner,{content:`Do not write @[Collaborator](user:${users.admin})`},'POST',{'x-test-before-batch':`DELETE FROM memberships WHERE project_id='${projectId}' AND user_id='${users.admin}'`})
  assert.equal(memberRace.status,409,'recipient membership is guarded at commit')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',ticket.id)).n,notesBefore.n+1)
  await app.db.prepare("INSERT INTO memberships VALUES(?,?,'operator')").bind(projectId,users.admin).run()
  onStep('mutation checks done')
  // Disconnect removes a peer immediately; reconnect starts with flags cleared.
  operator.ws.close(1000,'done')
  await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==users.operator))
  const reconnect=await connect(tokens.operator)
  reconnect.ws.send(JSON.stringify({type:'presence',typing:true,draft:true}))
  await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.some(peer=>peer.id===users.operator&&peer.typing))
  await app.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),sha(tokens.operator)).run()
  await app.until(()=>reconnect.closed,{timeout:12000,message:'revoked operator socket closes without sending a command'})
  await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==users.operator))
  onStep('revocation checks done')
  const latest=await connect(tokens.admin)
  latest.ws.send(JSON.stringify({type:'presence',typing:true,draft:true}))
  await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.some(peer=>peer.id===users.admin&&peer.draft))
  // Keep only the observing operator alive. A quiet tab's flags expire, including after hibernation.
  const heartbeat=setInterval(()=>owner.ws.send(JSON.stringify({type:'presence',typing:false,draft:false})),10000)
  try{await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==users.admin),{timeout:40000,interval:50,message:'silent presence expires'})}finally{clearInterval(heartbeat)}
  onStep('expiry checks done')
  assert.ok(!contact.frames.some(frame=>frame.type==='presence'||frame.kind==='note'||frame.kind==='followers'),'internal collaboration never reaches visitor socket')
  assert.deepEqual((await app.ok(`/api/conversations/${ticket.id}/messages`,{token:visitor.token})).messages,[],'internal notes never enter the customer transcript')
  assert.equal((await call(`/notes/${note.data.data.id}`,tokens.owner,undefined,'DELETE')).status,200)
  assert.deepEqual(await app.sql('SELECT * FROM conversation_note_media WHERE note_id=?',note.data.data.id),[],'note deletion cleans attachment links')
  assert.deepEqual(await app.sql('SELECT * FROM conversation_note_mentions WHERE note_id=?',note.data.data.id),[],'note deletion cleans mention identities')
 }catch(error){onStep(error.stack);throw error}finally{onStep('closing app');for(const {ws} of sockets)try{ws.close(1000,'test complete')}catch{}await app.close()}
}
