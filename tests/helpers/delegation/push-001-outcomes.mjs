import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {customerFixture} from '../delegation-journey/fixture.mjs'
import {client,newVisitor} from '../delegation-journey/case.mjs'
import {connector} from '../delegation-journey/connector.mjs'
import {push001RestartOutcomes} from './push-001-restart.mjs'

// Real conversation and connector doors; only the CLI provider and disposable
// customer system are network fixtures. No result or context is planted in D1.
async function recoveryCase({app,api,actor,directory},run){
 const fixture=await customerFixture(),origin=app.url,projectId=actor.projectId
 const visitor=await newVisitor({origin,api,projectId}),conversationId=visitor.session.conversationId
 const path=`/api/projects/${projectId}/conversations/${conversationId}/delegations`
 const dashboard=`/api/dashboard/projects/${projectId}/conversations/${conversationId}`
 await api(dashboard,{agent_id:actor.id},{method:'PUT'})
 const triage=(await api(dashboard+'/ticket')).data
 await api(dashboard+'/ticket',{status_id:'open',expected_version:triage.ticket_version},{method:'PATCH'})
 const code=(await api(`/api/projects/${projectId}/local-agents/pairings`,{})).data.code
 const worker=await connector({origin,directory,code}),device=client(origin,worker.token)
 const jobs=async()=>(await api(path)).data,job=async id=>(await jobs()).find(j=>j.id===id)
 const task=phase=>({phase,fixture:fixture.origin,projectId,conversationId})
 const delegate=async()=>(await api(path,{device_id:worker.deviceId,mode:'investigate',instructions:'Read only the Spanish fixture. Propose any change for my explicit approval; do not send.',request_id:randomUUID()})).data
 const investigate=async()=>{const j=await delegate();await worker.run(task('investigate'));return job(j.id)}
 const approve=async parent=>{const child=(await api(`${path}/${parent.id}/result/follow-up-actions/enable`,{})).data.child_delegation_id;assert.equal((await job(child)).operator_id,actor.id);return child}
 const fix=async()=>{const parent=await investigate(),child=await approve(parent);const before=fixture.events.filter(e=>e.method==='POST').length;await worker.run(task('resolve'));assert.equal(fixture.events.filter(e=>e.method==='POST').length,before+1);return job(child)}
 const observe=async()=>{const j=await delegate(),before=fixture.events.length;await worker.run(task('observe'));assert.deepEqual(fixture.events.slice(before).map(e=>e.method),['GET']);const result=await job(j.id);assert.equal(result.result.verified,true);return result}
 const counts=async()=>({jobs:(await jobs()).length,messages:(await visitor.transcript()).messages.length,reads:fixture.events.filter(e=>e.method==='GET').length,writes:fixture.events.filter(e=>e.method==='POST').length})
 const ticket=async()=>(await api(dashboard)).data
 const notes=async()=>(await api(dashboard+'/buckets/'+conversationId)).data.events.filter(e=>e.type==='INTERNAL_NOTE')
 const ownedOpen=async()=>{const t=await ticket();assert.equal(t.status_category,'open');assert.equal(t.resolved_at,null);assert.equal(t.agent_id,actor.id)}
 const failedRead=async()=>{
  const j=await delegate(),before=await counts();await worker.unverified(task('unverified'))
  const failed=await job(j.id);assert.equal(failed.status,'needs_input');assert.equal(failed.result.verified,false);assert.match(failed.result.actions[0].evidence,/enabled=false; observation=/);assert.equal(failed.operator_id,actor.id)
  await api(`${path}/${j.id}/result/replies/unsafe/send`,{},{status:409})
  const frontier=await visitor.transcript()
  await api(`${path}/${j.id}/result/draft`,{proposal_id:'unsafe',expected_revision:frontier.revision,expected_last_message_id:frontier.lastMessageId},{status:409})
  assert.deepEqual(await counts(),{...before,reads:before.reads+1});await ownedOpen()
  // Cancellation is requested by the person and acknowledged by the host; it
  // is never inferred from the unsuccessful observation.
  await api(`${path}/${j.id}/cancel`,{})
  await device(`/api/local-agents/jobs/${j.id}/result`,{run_id:failed.run_id,event_id:randomUUID(),status:'cancelled',result:{summary:'Operator cancelled pending review; a fresh investigation is required.',actions:[],verified:false}})
  return failed
 }
 try{await run({fixture,visitor,conversationId,path,dashboard,worker,device,jobs,job,task,delegate,investigate,approve,fix,observe,counts,ticket,notes,ownedOpen,failedRead})}
 finally{await worker.close();await fixture.close()}
}

export async function push001Outcomes(options){
 await recoveryCase({...options,directory:join(options.directory,'recurrence')},async t=>{
  assert.deepEqual(await t.counts(),{jobs:0,messages:1,reads:0,writes:0})
  const changed=await t.fix();assert.match(changed.result.summary,/independent investigation is still required/);await t.ownedOpen()
  assert.deepEqual(await t.counts(),{jobs:2,messages:1,reads:2,writes:1})
  // A failure after the approved change is a new observation, not its command's
  // successful receipt. reset is a fault at the customer-system boundary.
  t.fixture.reset();const failed=await t.failedRead()
  assert.deepEqual(await t.counts(),{jobs:3,messages:1,reads:1,writes:0})
  console.log(JSON.stringify({proof:'PUSH-001 failed post-change observation',fix:changed.id,observation:failed.id,verified:false,send:409,draft:409,counts:await t.counts(),owner:options.actor.id}))
  await t.fix();const confirmed=await t.observe();assert.notEqual(confirmed.id,changed.id)
  const frontier=await t.visitor.transcript(),draft=(await options.api(`${t.path}/${confirmed.id}/result/draft`,{proposal_id:'confirmed',expected_revision:frontier.revision,expected_last_message_id:frontier.lastMessageId})).data
  const command={localId:randomUUID(),content:draft.body,resolve:true,expectedRevision:frontier.revision,expectedLastMessageId:frontier.lastMessageId,authoring:draft.authoring}
  const sent=await options.api(`/api/conversations/${t.conversationId}/messages`,command);assert.equal(sent.accepted,true);assert.equal(sent.message.actor_id,options.actor.id)
  assert.equal((await options.api(`/api/conversations/${t.conversationId}/messages`,command)).message.id,sent.message.id)
  const solved=await t.ticket();assert.equal(solved.status_category,'solved');assert.ok(solved.resolved_at);assert.equal(solved.agent_id,options.actor.id)
  assert.deepEqual(await t.counts(),{jobs:6,messages:2,reads:4,writes:1})
  // Proposal presentation adds current delivery receipts; compare the stored
  // report evidence separately from those expected receipt-state changes.
  const evidence=j=>({...j,result:{...j.result,replies:j.result.replies?.map(({id,title,body,attachment_ids})=>({id,title,body,attachment_ids}))}})
  const firstCycle=(await t.visitor.transcript()).resolution,earlierJobs=(await t.jobs()).map(evidence),earlierNotes=await t.notes()
  assert.equal(earlierNotes.length,5)
  t.fixture.reset();const recurrence='Spanish is broken again after the fix. Please investigate this recurrence.'
  const incoming=await t.visitor.say(recurrence);assert.equal(incoming.accepted,true);await t.ownedOpen()
  const reopened=await t.ticket();assert.equal(reopened.resolutionHistory.length,1);assert.equal(reopened.resolutionHistory[0].id,firstCycle.id);assert.ok(reopened.resolutionHistory[0].reopenedAt)
  assert.deepEqual((await t.jobs()).map(evidence),earlierJobs);assert.deepEqual(await t.notes(),earlierNotes)
  const oldSend=`${t.path}/${confirmed.id}/result/replies/confirmed/send`,receipt=(await options.api(oldSend,{})).data
  assert.equal(receipt.status,'needs_review');assert.deepEqual((await options.api(oldSend,{})).data,receipt)
  assert.equal((await t.visitor.transcript()).messages.length,3,'old proposal cannot publish after recurrence')
  const recurrenceRead=await t.failedRead();assert.ok(recurrenceRead.context.messages.some(m=>m.content===recurrence))
  for(const note of earlierNotes)assert.ok(recurrenceRead.context.internal_notes.some(n=>n.id===note.id&&n.content===note.content))
  assert.deepEqual((await t.jobs()).filter(j=>j.id!==recurrenceRead.id).map(evidence),earlierJobs);assert.deepEqual(await t.notes(),earlierNotes)
  const repaired=await t.fix();assert.match(repaired.result.summary,/independent investigation is still required/);await t.ownedOpen()
  const writes=t.fixture.events.filter(e=>e.method==='POST').length,verified=await t.observe();assert.notEqual(verified.id,repaired.id);assert.equal(verified.result.verified,true)
  assert.equal(t.fixture.events.filter(e=>e.method==='POST').length,writes);await t.ownedOpen()
  assert.deepEqual(await t.counts(),{jobs:10,messages:3,reads:4,writes:1})
  console.log(JSON.stringify({proof:'PUSH-001 recurrence',firstCycle:firstCycle.id,reopenedAt:reopened.resolutionHistory[0].reopenedAt,oldJobs:earlierJobs.length,oldNotes:earlierNotes.length,failedRead:recurrenceRead.id,distinctRead:verified.id,counts:await t.counts(),owner:options.actor.id}))
 })
 await recoveryCase({...options,directory:join(options.directory,'uncertain-change')},async t=>{
  // Hold the customer system's POST acknowledgement after its real effect.
  // Kill the connector process group while the scripted CLI waits: no report
  // is created or admitted, exactly as for a laptop dying during a change.
  const edge=createServer(async(req,res)=>{const upstream=await fetch(t.fixture.origin+req.url,{method:req.method});if(req.method==='POST')return;res.setHeader('Content-Type','application/json');res.end(await upstream.text())})
  await new Promise(resolve=>edge.listen(0,'127.0.0.1',resolve))
  try{
   const parent=await t.investigate(),child=await t.approve(parent)
   const execution=await t.worker.run({...t.task('resolve'),fixture:`http://127.0.0.1:${edge.address().port}`},{background:true})
   await options.app.until(()=>t.fixture.events.filter(e=>e.method==='POST').length===1,{message:'customer effect before lost acknowledgement'})
   process.kill(-execution.child.pid,'SIGKILL');await execution.done
   const started=await t.job(child);assert.equal(started.status,'running');assert.equal(started.result,null);assert.equal(started.cancel_requested,false)
   assert.deepEqual(await t.counts(),{jobs:2,messages:1,reads:2,writes:1})
   await options.app.configure({});await options.app.scheduled();await options.app.drainJobs()
   assert.deepEqual(await t.job(child),started)
   await t.worker.run(t.task('resolve'),{expected:1});assert.deepEqual(await t.job(child),started)
   assert.deepEqual(await t.counts(),{jobs:2,messages:1,reads:2,writes:1})
   await options.api(`${t.path}/${child}/cancel`,{});const requested=await t.job(child)
   assert.equal(requested.status,'running');assert.equal(requested.cancel_requested,true);assert.equal(requested.result,null)
   await t.worker.run(t.task('resolve'));assert.equal((await t.job(child)).status,'cancelled')
   assert.deepEqual(await t.counts(),{jobs:2,messages:1,reads:2,writes:1})
   const observation=await t.observe();assert.equal(observation.result.verified,true);await t.ownedOpen()
   assert.deepEqual(await t.counts(),{jobs:3,messages:1,reads:3,writes:1})
   console.log(JSON.stringify({proof:'PUSH-001 started change across restart',job:child,afterRestart:'running',report:null,cancellation:'requested then host acknowledged',observation:observation.id,counts:await t.counts()}))
  }finally{edge.closeAllConnections();await new Promise(resolve=>edge.close(resolve))}
 })
 await push001RestartOutcomes()
}
