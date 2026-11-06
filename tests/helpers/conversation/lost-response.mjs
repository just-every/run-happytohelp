import assert from 'node:assert/strict'
import {holdLostResponse} from './response-loss.mjs'
import {startApp} from '../../journeys/kit/app.mjs'
import {client} from '../../journeys/kit/http.mjs'

// Forward the actual HTTP command and consume the actual response, then lose
// only its delivery. Nothing in the application, storage or admission is faked.
export async function lostFinalReplyResponse(){
 const app=await startApp({listen:true,captureQueue:true})
 let loss
 try{
  const workspace=await app.seedWorkspace('lost-final'),token=workspace.tokens.owner
  await app.presenceAwayOff(workspace.projectId)
  const visitor=(await app.call('/api/identity/widget/session',{headers:{Origin:workspace.allowedOrigin},body:{widgetKey:workspace.widgetKey},status:201})).data
  const conversation=(await app.call('/api/conversations',{token:visitor.token,body:{projectId:workspace.projectId},status:201})).data
  const path=`/api/conversations/${conversation.id}/messages`,http=client(app.url)
  const initial=(await http.call(path,{token:visitor.token,body:{localId:'question',content:'Can you help?',expectedRevision:0},status:200})).data.message
  const media=(await http.call(`/api/conversations/${conversation.id}/media`,{token,raw:true,body:'reply attachment',headers:{'Content-Type':'text/plain','X-Filename':'reply.txt'},status:201})).data
  const command={localId:'lost-final',content:'Your order is refunded',expectedRevision:1,expectedLastMessageId:initial.id,mediaIds:[media.id],resolve:true}
  assert.equal((await http.call(path,{token:workspace.tokens.admin,body:{...command,localId:'attachment-theft'},status:409})).data.accepted,false,'another actor cannot claim the staged attachment even at the current frontier')
  loss=await holdLostResponse(app.url,path,{token,body:command})
  const {committed}=loss
  assert.equal(committed.status,200);assert.equal(committed.data.accepted,true);assert.equal(committed.data.duplicate,false)
  // While the original caller still awaits its response, a second operator
  // final and two exact retries compete at the captured frontier.
  const [incompatible,...replays]=await Promise.all([
   http.call(path,{token:workspace.tokens.admin,body:{...command,localId:'other-final',content:'Your order cannot be refunded'},status:409}),
   ...Array.from({length:2},()=>http.call(path,{token,body:command,status:200})),
  ])
  assert.equal(incompatible.data.accepted,false)
  for(const replay of replays){assert.equal(replay.data.duplicate,true);assert.deepEqual(replay.data.message,committed.data.message)}
  await loss.close();loss=null
  assert.equal((await http.call(path,{token,body:{...command,content:'Changed refund decision'},status:409})).data.accepted,false)
  const transcript=(await http.call(path,{token:visitor.token,status:200})).data
  assert.equal(transcript.revision,2);assert.equal(transcript.lastMessageId,committed.data.message.id)
  assert.deepEqual(transcript.messages.map(m=>[m.id,m.local_id,m.content,m.revision]),[
   [initial.id,'question','Can you help?',1],[committed.data.message.id,command.localId,command.content,2],
  ])
  assert.deepEqual(transcript.messages[1].media.map(m=>m.id),[media.id],'the winner keeps its one attachment through lost-response retries')
  const download=await http.request(`/api/conversations/${conversation.id}/media/${media.id}`,{token:visitor.token})
  assert.equal(download.status,200);assert.equal(await download.text(),'reply attachment')
  const detail=(await http.call(`/api/dashboard/projects/${workspace.projectId}/conversations/${conversation.id}`,{token,status:200})).data.data
  assert.equal(detail.status_category,'solved')
 }finally{
  if(loss)await loss.close()
  await app.close()
 }
}
