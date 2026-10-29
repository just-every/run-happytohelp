import assert from 'node:assert/strict'
import {queueCollaboration} from './queue-collaboration.mjs'

// Teammates collaborate on, merge and forward the same active replacement.
export async function deskCollaboration(f){
 const {app,w,foreign,id,ok,call,get,visitor}=f,sockets=[]
 const connect=async token=>{const response=await app.request(`/api/conversations/${id}/socket?token=${token}`,{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);const ws=response.webSocket,frames=[];ws.accept();ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)));sockets.push(ws);return {ws,frames}}
 try{
  const owner=await connect(w.tokens.owner),teammate=await connect(w.tokens.operator),customer=await connect(visitor.token)
  owner.ws.send(JSON.stringify({type:'presence',typing:true,draft:true}));teammate.ws.send(JSON.stringify({type:'presence',typing:true,draft:true,content:'Private draft content'}))
  const presence=await app.until(()=>owner.frames.find(frame=>frame.type==='presence'&&frame.peers.some(peer=>peer.id===w.users.operator&&peer.typing&&peer.draft)))
  assert.ok(!JSON.stringify(presence).includes('Private draft content'));assert.ok(!customer.frames.some(frame=>frame.type==='presence'))
  const reciprocal=await app.until(()=>teammate.frames.find(frame=>frame.type==='presence'&&frame.peers.some(peer=>peer.id===w.users.owner&&peer.typing&&peer.draft)))
  assert.ok(reciprocal,'both operators receive collision indicators before sending')
  teammate.ws.send(JSON.stringify({type:'presence',typing:false,draft:true}))
  assert.ok(await app.until(()=>owner.frames.find(frame=>frame.type==='presence'&&frame.peers.some(peer=>peer.id===w.users.operator&&!peer.typing&&peer.draft))),'an unsent draft still warns after typing stops')
  await queueCollaboration(f,{owner,customer})
  await ok(`/conversations/${id}/followers`,{user_ids:[w.users.operator]},'owner','PUT')
  const note=await ok(`/conversations/${id}/notes`,{content:`Private @[Operator](user:${w.users.operator}) review`,mention_ids:[w.users.operator]})
  assert.ok(await app.first("SELECT id FROM notification_inbox WHERE conversation_id=? AND user_id=? AND kind='mention'",id,w.users.operator))
  assert.ok(!(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).messages.some(message=>message.content===note.content))
  assert.equal((await call(`/conversations/${id}/followers`,{user_ids:[foreign.users.owner]},'owner','PUT')).status,403)
  const frontier=await get(id),beforeMessages=(await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n
  const competing=await Promise.all([w.tokens.owner,w.tokens.operator].map((token,index)=>app.call(`/api/conversations/${id}/messages`,{token,body:{localId:'collision-'+index,content:'The replacement is being reviewed '+index,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}})))
  assert.equal(competing.filter(result=>result.data.accepted).length,1)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n,beforeMessages+1)
  assert.ok(competing.some(result=>result.data.accepted===false||result.status===409))
  const admitted=competing.find(result=>result.data.accepted),reloaded=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
  assert.equal(reloaded.messages.filter(message=>message.content.startsWith('The replacement is being reviewed ')).length,1,'reload shows exactly one admitted final reply')
  assert.equal(reloaded.messages.at(-1).id,admitted.data.message.id)
  assert.equal((await get(id)).revision,frontier.revision+1)
  teammate.ws.close();await app.until(()=>owner.frames.findLast(frame=>frame.type==='presence')?.peers.every(peer=>peer.id!==w.users.operator))

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
