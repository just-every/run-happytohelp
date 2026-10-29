import assert from 'node:assert/strict'
import {loadClient} from './mobile-offline.mjs'

// Uses the actual packaged connector journey's findings and disposable customer
// system. Only the paid CLI at that journey's network edge is scripted.
export async function mobileApprovals({origin,api,actor,conversationId,jobId,visitor}){
 const {MobileClient}=await loadClient(),root='/api/mobile/v1',path=root+'/tickets/'+conversationId
 const pair=platform=>api(root+'/devices',{platform,scopes:['read','approval','reply','attachments']},{status:201})
 const device=await pair('ios'),android=await pair('android'),readonly=await api(root+'/devices',{platform:'android',scopes:['read']},{status:201})
 const call=async(device,path,body,{status=200,headers={},method=body===undefined?'GET':'POST'}={})=>{
  const response=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+device.token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${response.status}: ${JSON.stringify(data)}`);return data
 }
 const client=new MobileClient({origin,credential:{deviceId:device.id,projectId:actor.projectId,token:device.token,scopes:device.scopes,expiresAt:device.expiresAt}})
 try{
  await client.reconnect();await client.openTicket(conversationId)
  assert.ok((await client.approvals(conversationId)).approvals.some(item=>item.jobId===jobId&&item.followUpActions.some(proposal=>proposal.id==='enable')))
  await call(readonly,path+'/approvals',undefined,{status:403})
  await call(readonly,path+'/approvals/'+jobId+'/follow-ups/enable',{frontier:client.cachedTicket(conversationId).frontier},{status:403})
  // A customer update and a newly scheduled effect both invalidate approval.
  await visitor.say('Please check the Spanish setting before making the change.')
  await assert.rejects(()=>client.approveFollowUp(conversationId,jobId,'enable'),error=>error.status===409)
  await client.openTicket(conversationId)
  await api(`/api/dashboard/projects/${actor.projectId}/workflow-schedules`,{conversation_id:conversationId,kind:'reply',due_at:Date.now()+86400000,timezone:'UTC',body:'Review the Spanish setting tomorrow',owner_id:actor.id},{status:201})
  await assert.rejects(()=>client.approveFollowUp(conversationId,jobId,'enable'),error=>error.status===409)
  await client.openTicket(conversationId)
  const snapshot=await call(android,path)
  await call(android,path+'/approvals/'+jobId+'/follow-ups/enable',{frontier:snapshot.frontier},{status:[401,409],headers:{'x-test-before-batch':`UPDATE mobile_devices SET revoked_at=1 WHERE id='${android.id}'`}})
  assert.equal((await api(`/api/projects/${actor.projectId}/conversations/${conversationId}/delegations`)).data.length,1,'authority lost at commit creates no child')
  client.setOffline();await assert.rejects(()=>client.approveFollowUp(conversationId,jobId,'enable'));await client.reconnect()
  const receipts=await Promise.all([client.approveFollowUp(conversationId,jobId,'enable'),client.approveFollowUp(conversationId,jobId,'enable')])
  assert.equal(receipts[0].receipt.child_delegation_id,receipts[1].receipt.child_delegation_id)
  return {
   approval:receipts[0].receipt,
   async send(reply,observationId){
    await client.openTicket(conversationId)
    const before=await visitor.transcript(),draft=await client.adoptReply(conversationId,observationId,reply.id)
    assert.equal(draft.content,reply.body);assert.equal((await visitor.transcript()).messages.length,before.messages.length,'adoption never sends')
    await assert.rejects(()=>client.sendDraft(conversationId));client.reviewDraft(conversationId)
    const command={localId:draft.localId,frontier:draft.frontier,content:draft.content,mediaIds:draft.mediaIds,resolve:draft.resolve,authoring:draft.authoring}
    const sent=await client.sendDraft(conversationId),replay=await call(device,path+'/reply',command)
    assert.equal(replay.duplicate,true);assert.equal(replay.messageId,sent.messageId)
    const message=(await visitor.transcript()).messages.find(message=>message.id===sent.messageId)
    assert.ok(message)
    return {accepted:sent.accepted,message}
   },
   close:()=>client.signOut(),
  }
 }catch(error){client.dispose();throw error}
}
