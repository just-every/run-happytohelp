import assert from 'node:assert/strict'

// Read the owner's completed erasure through the same transcript door used by
// operators; no storage inspection supplies these acceptance results.
export async function erasedTranscript(app,token,expectedIds){
 const response=await app.call('/api/conversations/conv1/messages',{token,status:200}),transcript=response.data
 assert.equal(transcript.revision,expectedIds.length)
 assert.equal(transcript.lastMessageId,expectedIds.at(-1))
 assert.deepEqual(transcript.messages.map(m=>[m.id,m.revision,m.content,m.media.length]),expectedIds.map((id,i)=>[id,i+1,'',0]))
 assert.ok(transcript.messages.every(m=>m.erased_at),'every retained identity is visibly redacted')
}
