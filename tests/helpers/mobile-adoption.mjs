import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// Extends the existing public Use -> editable draft -> Send flow with the same
// real computer uploads, D1 transaction and R2 bytes through the mobile door.
export async function mobileAdoption(runtime){
 const {request,fixture,noAdoption,app}=runtime,root='/api/mobile/v1',f=await fixture({count:2})
 const pair=async(scopes=['read','approval','reply','attachments'])=>{
  const response=await request(root+'/devices',{platform:'android',scopes},f.token)
  assert.equal(response.status,201,JSON.stringify(response));return response.body
 }
 const path=root+'/tickets/'+f.conversationId,device=await pair(),readonly=await pair(['read'])
 const read=async d=>{const response=await request(path,undefined,d.token);assert.equal(response.status,200);return response.body}
 const frontier=(await read(device)).frontier,adoptPath=path+'/approvals/'+f.jobId+'/draft'
 assert.equal((await request(adoptPath,{frontier,proposalId:'selected'},readonly.token)).status,403)
 const raced=await request(adoptPath,{frontier,proposalId:'selected'},device.token,{'x-test-before-batch':`UPDATE mobile_devices SET revoked_at=1 WHERE id='${device.id}'`})
 assert.equal(raced.status,409,JSON.stringify(raced));await noAdoption(f)
 const fresh=await pair(),snapshot=await read(fresh)
 const adopted=await request(adoptPath,{frontier:snapshot.frontier,proposalId:'selected'},fresh.token)
 assert.equal(adopted.status,200,JSON.stringify(adopted));const draft=adopted.body.draft
 assert.equal(draft.body,f.result.replies[0].body);assert.equal(draft.attachments.length,2)
 assert.deepEqual((await request(`/api/conversations/${f.conversationId}/messages`,undefined,f.token)).body.messages,[],'Use never sends')
 for(const attachment of draft.attachments){
  const downloaded=await app.request(attachment.url,{token:fresh.token})
  assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),runtime.png)
 }
 const command={frontier:snapshot.frontier,localId:randomUUID(),content:'Reviewed mobile reply with both screenshots.',mediaIds:draft.attachments.map(attachment=>attachment.id),authoring:draft.authoring}
 const sends=await Promise.all([1,2].map(()=>request(path+'/reply',command,fresh.token)))
 assert.ok(sends.every(response=>response.status===200),JSON.stringify(sends));assert.equal(sends.filter(response=>response.body.duplicate).length,1)
 const messages=(await request(`/api/conversations/${f.conversationId}/messages`,undefined,f.token)).body.messages
 assert.equal(messages.length,1);assert.equal(messages[0].content,command.content);assert.equal(messages[0].media.length,2)
 const latest=await read(fresh)
 assert.equal((await request(adoptPath,{frontier:latest.frontier,proposalId:'selected'},fresh.token)).status,409,'sent files cannot become a fresh draft')
 // Mobile approval never grants a future or background customer reply.
 const automatic=await fixture({count:0,followUpMode:'resolve_reply'}),autoPair=await request(root+'/devices',{platform:'ios',scopes:['read','approval']},automatic.token)
 assert.equal(autoPair.status,201)
 const autoPath=root+'/tickets/'+automatic.conversationId,autoState=await request(autoPath,undefined,autoPair.body.token)
 const proposals=await request(autoPath+'/approvals',undefined,autoPair.body.token)
 assert.equal(proposals.body.approvals.find(item=>item.jobId===automatic.jobId).followUpActions.length,0)
 assert.equal((await request(autoPath+'/approvals/'+automatic.jobId+'/follow-ups/automatic-reply',{frontier:autoState.body.frontier},autoPair.body.token)).status,403)
 const jobs=await request(`/api/projects/${automatic.projectId}/conversations/${automatic.conversationId}/delegations`,undefined,automatic.token)
 assert.equal(jobs.body.data.length,1);await noAdoption(automatic)
}
