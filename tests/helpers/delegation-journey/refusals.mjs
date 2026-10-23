import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {client,newVisitor,until} from './case.mjs';
import {connector} from './connector.mjs';

export async function refusals({origin,api,actor,fixture,directory,deliveryFault}){
 const results=[];
 for(const scenario of ['stale','revoked','offline','unverified','failed_recovery']){
  fixture.reset();const visitor=await newVisitor({origin,api,projectId:actor.projectId}),conversationId=visitor.session.conversationId;
  const path=`/api/projects/${actor.projectId}/conversations/${conversationId}/delegations`;
  const jobs=async()=>(await api(path)).data,job=async id=>(await jobs()).find(j=>j.id===id);
  const code=(await api(`/api/projects/${actor.projectId}/local-agents/pairings`,{})).data.code;
  const worker=await connector({origin,directory:join(directory,scenario),code});
  const task=phase=>({phase,fixture:fixture.origin,customerPath:fixture.customerPath,conversationId,projectId:actor.projectId});
  const delegate=async(mode='investigate')=>(await api(path,{device_id:worker.deviceId,mode,instructions:'Inspect only the disposable Spanish setting fixture; do not send any reply.',request_id:randomUUID()})).data;
  try{
   const initial=await delegate(['revoked','unverified'].includes(scenario)?'resolve':'investigate');assert.equal(initial.status,'queued');
   if(scenario==='stale'){
    await worker.run(task('investigate'));const before=await visitor.transcript();
    const draft=(await api(`${path}/${initial.id}/result/draft`,{proposal_id:'finding',expected_revision:before.revision,expected_last_message_id:before.lastMessageId})).data;
    await visitor.say('Spanish still fails, and here is new information after your investigation.');
    const denied=await api(`/api/conversations/${conversationId}/messages`,{localId:randomUUID(),content:draft.body,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,authoring:draft.authoring},{status:409});assert.equal(denied.accepted,false);
    const receipt=(await api(`${path}/${initial.id}/result/replies/finding/send`,{})).data;assert.equal(receipt.status,'needs_review');assert.ok(receipt.review_message);
    const repeated=(await api(`${path}/${initial.id}/result/replies/finding/send`,{})).data;assert.deepEqual(repeated,receipt,'needs_review receipts never automatically replay');
    const readable=await job(initial.id);assert.equal(readable.result.replies[0].body,draft.body);assert.equal(readable.result.replies[0].status,'needs_review');
    const fresh=await delegate();await worker.run(task('investigate'));assert.equal((await job(fresh.id)).context.conversation.last_message_id,(await visitor.transcript()).lastMessageId);
    results.push({scenario,conversationId,jobId:initial.id,beforeRevision:before.revision,afterRevision:(await visitor.transcript()).revision,receipt,freshJobId:fresh.id});
   }else if(scenario==='revoked'){
    const execution=await worker.run(task('hold'),{background:true});
    await until(()=>readFile(join(worker.directory,'started.json'),'utf8').then(JSON.parse).catch(()=>null),Boolean,'provider began scoped local work');
    assert.equal((await job(initial.id)).status,'running');
    await api(`/api/projects/${actor.projectId}/local-agents/${worker.deviceId}`,undefined,{method:'DELETE'});
    const withdrawn=await job(initial.id);assert.equal(withdrawn.status,'revoked');assert.equal(withdrawn.delivery_state,'authority_revoked');assert.ok(withdrawn.completed_at);assert.equal(withdrawn.result,null);
    await api(`${path}/${initial.id}/result/replies/unsafe/send`,{},{status:404});
    await worker.close();await execution.done;
    assert.equal((await job(initial.id)).status,'revoked','stopping the test process does not invent a server cancellation receipt');
    results.push({scenario,conversationId,job:withdrawn,localOutcome:'unconfirmed'});
   }else if(scenario==='offline'){
    assert.equal(fixture.events.length,0);assert.equal((await job(initial.id)).started_at,null);
    const devices=(await api(`/api/projects/${actor.projectId}/local-agents`)).data;assert.equal(devices.find(d=>d.id===worker.deviceId).worker_ready,false);
    await api(`/api/projects/${actor.projectId}/local-agents/${worker.deviceId}`,undefined,{method:'DELETE'});
    assert.equal((await job(initial.id)).status,'cancelled');
    await worker.run(task('investigate'),{expected:1});
    assert.equal((await job(initial.id)).started_at,null);assert.equal(fixture.events.length,0);
    results.push({scenario,conversationId,job:await job(initial.id),reconnect:'revoked credential refused before provider execution'});
   }else if(scenario==='failed_recovery'){
    await worker.run(task('investigate'));
    const approval=(await api(`${path}/${initial.id}/result/follow-up-actions/enable`,{})).data;
    fixture.failCustomerPath();
    await worker.run(task('resolve'));
    const repair=await job(approval.child_delegation_id);assert.equal(repair.status,'completed');assert.equal(fixture.enabled,true);
    const healthy=await fetch(fixture.origin+'/stores/synthetic-happytohelp-2/es');assert.equal(healthy.status,200,'another customer succeeding is not recovery evidence for this customer');
    const observation=await delegate();const receipt=await worker.run(task('observe_failed'));
    assert.equal(receipt.customer.status,503);assert.equal(receipt.customer.available,false);
    assert.notEqual(observation.id,repair.id);
    const failed=await job(observation.id);assert.equal(failed.status,'needs_input');assert.equal(failed.result.verified,false);
    assert.ok(failed.result.actions.some(action=>action.evidence.includes(fixture.customerPath)));
    const conversation=await api('/api/conversations/'+conversationId);
    assert.equal(conversation.resolved_at,null);assert.equal(conversation.assigned_to,actor.id);
    const before=await visitor.transcript();
    await api(`${path}/${failed.id}/result/draft`,{proposal_id:'confirmed',expected_revision:before.revision,expected_last_message_id:before.lastMessageId},{status:409});
    await api(`${path}/${failed.id}/result/replies/confirmed/send`,{},{status:409});
    const writes=fixture.events.filter(event=>event.method==='POST');assert.equal(writes.length,1);
    await api(`${path}/${initial.id}/result/follow-up-actions/enable`,{});
    assert.equal((await jobs()).length,3,'an approved command replay creates no second repair after failed observation');
    assert.equal(fixture.events.filter(event=>event.method==='POST').length,1);
    results.push({scenario,conversationId,repair,observation:failed});
   }else{
    const submitted=await worker.unverified(task('unverified'));assert.equal(submitted.status,'needs_input');const uncertain=await job(initial.id);assert.equal(uncertain.status,'needs_input');assert.equal(uncertain.result.verified,false);
    await api(`${path}/${initial.id}/result/replies/unsafe/send`,{},{status:409});
    const before=await visitor.transcript();await api(`${path}/${initial.id}/result/draft`,{proposal_id:'unsafe',expected_revision:before.revision,expected_last_message_id:before.lastMessageId},{status:409});
    assert.equal(fixture.enabled,false);
    await api(`${path}/${initial.id}/cancel`,{});
    const device=client(origin,worker.token);await device(`/api/local-agents/jobs/${initial.id}/result`,{run_id:uncertain.run_id,event_id:randomUUID(),status:'cancelled',result:{summary:'Operator cancelled the unverified attempt.',actions:[],verified:false}});
    const review=await delegate();await worker.run(task('investigate'));
    // A real D1 write fault makes native delivery fail after a durable sending
    // receipt. Removing the fault must not make that uncertain command replay.
    await deliveryFault(true);let receipt;
    try{receipt=(await api(`${path}/${review.id}/result/replies/finding/send`,{})).data}finally{await deliveryFault(false)}
    assert.equal(receipt.status,'needs_review');assert.ok(receipt.review_message);
    const repeated=(await api(`${path}/${review.id}/result/replies/finding/send`,{})).data;assert.deepEqual(repeated,receipt);
    const inspectable=await job(review.id);assert.equal(inspectable.result.replies[0].status,'needs_review');assert.ok(inspectable.result.replies[0].body);
    const visible=(await visitor.transcript()).messages;assert.equal(visible.filter(m=>m.content===inspectable.result.replies[0].body).length,1,'admitted message survives uncertain receipt acknowledgement exactly once');assert.equal(visible.filter(m=>m.content===uncertain.result.replies[0].body).length,0);
    results.push({scenario,conversationId,job:uncertain,deliveryJobId:review.id,uncertainReceipt:receipt,afterFaultRemoved:repeated});
   }
   assert.equal((await visitor.transcript()).messages.filter(m=>m.actor_role!=='contact').length,scenario==='unverified'?1:0);assert.equal(fixture.events.filter(e=>e.method==='POST').length,scenario==='failed_recovery'?1:0);
  }finally{await worker.close()}
 }
 return results;
}
