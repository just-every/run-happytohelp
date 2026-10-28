import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {client,until} from './case.mjs'

// Continue the repaired customer's conversation on the same paired computer. A later message
// makes the first finding stale; each subsequent authority decision is explicit and durable.
export async function continueAuthority({origin,api,actor,fixture,worker,visitor,path,task,lookup,app}){
 const device=client(origin,worker.token),transcript=()=>visitor.transcript()
 const delegate=async(mode='investigate')=>(await api(path,{device_id:worker.deviceId,mode,instructions:'Inspect the Spanish setting; obey only this authorized mode.',request_id:randomUUID()})).data
 const claim=async()=>(await device('/api/local-agents/claim',{claim_id:randomUUID()})).data
 const report=(job,run,result,status='completed')=>device(`/api/local-agents/jobs/${job.id}/result`,{run_id:run.run_id,event_id:randomUUID(),status,result})
 const sent=async()=>(await transcript()).messages.filter(m=>m.actor_role!=='contact')
 const send=id=>api(`${path}/${id}/result/replies/confirmed/send`,{})
 const initialReplies=(await sent()).length
 const stale=await delegate();await worker.run(task('observe'));const before=await transcript()
 const draft=(await api(`${path}/${stale.id}/result/draft`,{proposal_id:'confirmed',expected_revision:before.revision,expected_last_message_id:before.lastMessageId})).data
 await visitor.say('Spanish works now. Can you confirm the remaining setup?')
 const staleCommand={localId:randomUUID(),content:draft.body,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,authoring:draft.authoring}
 await api(`/api/conversations/${visitor.session.conversationId}/messages`,staleCommand,{status:409})
 const refused=(await send(stale.id)).data;assert.equal(refused.status,'needs_review');assert.deepEqual((await send(stale.id)).data,refused)
 assert.equal((await sent()).length,initialReplies)

 const unverified=await delegate('resolve'),unverifiedRun=await claim()
 const reportBody={summary:'The remaining setup was not verified.',actions:[],verified:false,replies:[{id:'confirmed',title:'Unsafe',body:'This must never reach the customer.'}]}
 const held=(await report(unverified,unverifiedRun,reportBody)).data
 assert.equal(held.status,'needs_input');assert.equal(held.result.verified,false)
 await api(`${path}/${unverified.id}/result/replies/confirmed/send`,{},{status:409})
 await api(`${path}/${unverified.id}/cancel`,{})
 const cancelled=await report(unverified,unverifiedRun,{summary:'The worker observed cancellation.',actions:[],verified:false},'cancelled')
 assert.equal(cancelled.data.status,'cancelled','only a worker cancellation report establishes that outcome')

 const review=await delegate();await worker.run(task('observe'))
 // Delivery commits but its acknowledgement is lost. Clearing the network/storage fault is
 // insufficient authority to send again; the same public command stays reviewable.
 await app.db.prepare("CREATE TRIGGER journey_delivery_fault BEFORE UPDATE OF status ON local_receipts WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'synthetic acknowledgement outage'); END").run()
 let uncertain
 try{uncertain=(await send(review.id)).data}finally{await app.db.prepare('DROP TRIGGER journey_delivery_fault').run()}
 assert.equal(uncertain.status,'needs_review');assert.deepEqual((await send(review.id)).data,uncertain)
 assert.equal((await sent()).length,initialReplies+1)

 // Ordinary resolve retains a verified draft; only the explicitly selected resolve-and-reply
 // mode advances that same kind of draft to the customer without another human Send.
 for(const mode of ['resolve','resolve_reply']){
  const job=await delegate(mode),run=await claim(),count=(await sent()).length
  const result=await report(job,run,{summary:'Verified the current setting.',actions:[],verified:true,reply_draft:'The remaining setup is verified.'})
  assert.equal(result.data.status,'completed')
  assert.equal((await sent()).length,count+(mode==='resolve_reply'?1:0))
 }
 assert.equal(fixture.events.filter(e=>e.method==='POST').length,1,'continued inspection never repeats the approved repair')

 // Revocation while running ends authority without pretending the process stopped. The paired
 // computer becomes offline and cannot reconnect, claim, or report a result with its old token.
 const running=await delegate('resolve'),execution=await worker.run(task('hold'),{background:true})
 await until(()=>readFile(join(worker.directory,'started.json'),'utf8').then(JSON.parse).catch(()=>null),Boolean,'worker began authorized work')
 assert.equal((await lookup(running.id)).status,'running')
 await api(`/api/projects/${actor.projectId}/local-agents/${worker.deviceId}`,undefined,{method:'DELETE'})
 const withdrawn=await lookup(running.id)
 assert.equal(withdrawn.status,'revoked');assert.equal(withdrawn.delivery_state,'authority_revoked');assert.equal(withdrawn.result,null)
 await worker.close();await execution.done
 await worker.run(task('observe'),{expected:1})
 assert.equal((await lookup(running.id)).result,null)
 const devices=(await api(`/api/projects/${actor.projectId}/local-agents`)).data
 assert.equal(devices.find(d=>d.id===worker.deviceId).worker_ready,false)

 // A replacement task session requires the owner's native device approval and loses all
 // authority when its grant is revoked, including work which was queued while offline.
 const auth=await client(origin)('/api/local-agents/device-authorizations',{client_session_id:'replacement',name:'Replacement session',provider:'codex',capabilities:[]})
 await client(origin)('/api/local-agents/device-authorizations/token',{device_code:auth.data.device_code},{status:428})
 await api(`/api/projects/${actor.projectId}/local-agent-authorizations/decision`,{user_code:auth.data.user_code,decision:'approve'})
 const grant=await client(origin)('/api/local-agents/device-authorizations/token',{device_code:auth.data.device_code})
 const session=(await client(origin,grant.data.grant_token)('/api/local-agents/task-sessions',{client_session_id:'replacement',name:'Replacement session',capabilities:[]})).data
 const offline=(await api(path,{device_id:session.device.id,mode:'investigate',instructions:'Wait for the replacement computer.',request_id:randomUUID()})).data
 assert.equal(offline.started_at,null)
 await api(`/api/projects/${actor.projectId}/local-agent-grants/${session.device.grant_id}`,undefined,{method:'DELETE'})
 assert.equal((await lookup(offline.id)).status,'cancelled')
 await client(origin,session.token)('/api/local-agents/heartbeat',{}, {status:401})
}
