import assert from 'node:assert/strict'
import {socketClient} from '../widget/sockets.mjs'

// Read the owner's completed erasure through the same transcript door used by
// operators; no storage inspection supplies these acceptance results.
export async function erasedTranscript(app,token,expectedIds){
 const response=await app.call('/api/conversations/conv1/messages',{token,status:200}),transcript=response.data
 assert.equal(transcript.revision,expectedIds.length)
 assert.equal(transcript.lastMessageId,expectedIds.at(-1))
 assert.deepEqual(transcript.messages.map(m=>[m.id,m.revision,m.content,m.media.length]),expectedIds.map((id,i)=>[id,i+1,'',0]))
 assert.ok(transcript.messages.every(m=>m.erased_at),'every retained identity is visibly redacted')
 const replay=await socketClient(app)('/api/conversations/conv1/socket',{Authorization:`Bearer ${token}`,Origin:'https://app.example'})
 assert.equal(replay.status,101)
 try{
  const frames=[]
  for(const id of expectedIds){const frame=await replay.next(frame=>frame.type==='message');frames.push(frame);assert.equal(frame.message.id,id);assert.equal(frame.message.content,'');assert.equal(frame.message.content_raw,null);assert.deepEqual(frame.message.media,[]);assert.ok(frame.message.erased_at)}
  assert.deepEqual(frames.map(frame=>frame.message.revision),expectedIds.map((_,i)=>i+1),'durable replay keeps the same redacted transcript order')
 }finally{replay.socket.close()}
}
