import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {client,newVisitor,until} from './case.mjs'
import {connector} from './connector.mjs'

export async function timeAuthorityJourney({origin,api,actor,fixture,directory,setExpiry,restart}){
 const projectId=actor.projectId,code=(await api(`/api/projects/${projectId}/local-agents/pairings`,{})).data.code
 const worker=await connector({origin,directory,code}),device=client(origin,worker.token)
 const create=async(mode='investigate',minutes=1)=>{
  const visitor=await newVisitor({origin,api,projectId}),conversationId=visitor.session.conversationId,path=`/api/projects/${projectId}/conversations/${conversationId}/delegations`,requestId=randomUUID()
  const command={device_id:worker.deviceId,mode,instructions:'Inspect only the disposable Spanish fixture within the granted time. No customer reply is authorized.',time_limit_minutes:minutes,request_id:requestId}
  const job=(await api(path,command)).data,jobs=async()=>(await api(path)).data
  return {visitor,conversationId,path,job,command,read:async()=>(await jobs()).find(row=>row.id===job.id),task:phase=>({phase,fixture:fixture.origin,customerPath:fixture.customerPath,conversationId,projectId})}
 }
 try{
  fixture.reset()
  const queued=await create()
  assert.equal(queued.job.authority.granted_by,actor.id);assert.equal(queued.job.authority.minutes,1)
  assert.equal(queued.job.authority.expires_at-queued.job.authority.granted_at,60000)
  for(const invalid of [0,16,1.5,'1'])await api(queued.path,{...queued.command,request_id:randomUUID(),time_limit_minutes:invalid},{status:422})
  const repeated=(await api(queued.path,{...queued.command,time_limit_minutes:15})).data
  assert.equal(repeated.id,queued.job.id)
  assert.equal((await queued.read()).authority.expires_at,queued.job.authority.expires_at,'request replay never extends a grant')
  await setExpiry(queued.job.id,Date.now()-1000)
  assert.equal((await device('/api/local-agents/claim',{claim_id:randomUUID()})).data,null)
  const neverStarted=await queued.read();assert.equal(neverStarted.status,'cancelled');assert.equal(neverStarted.started_at,null);assert.equal(neverStarted.delivery_state,'authority_expired')
  assert.equal(fixture.events.length,0)

  const running=await create('resolve')
  // The test-only storage edge shortens this real granted deadline so the owned
  // connector's actual timer can expire, without a minute-long blocking wait.
  await setExpiry(running.job.id,Date.now()+12000)
  const execution=await worker.run(running.task('hold'),{background:true})
  let exitCode;execution.done.then(code=>{exitCode=code})
  await until(async()=>{const started=await readFile(join(directory,'started.json'),'utf8').then(JSON.parse).catch(()=>null);if(started)return started;if(exitCode!==undefined){await worker.close();throw new Error('Connector exited before provider startup: '+exitCode+'; '+await readFile(join(directory,'connector.log'),'utf8'))}return null},Boolean,'bounded provider started')
  let deadline;try{await Promise.race([execution.done,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('The owned connector did not stop after its deadline')),20000)})])}finally{clearTimeout(deadline)}
  await device('/api/local-agents/heartbeat',{})
  const expired=await running.read();assert.equal(expired.status,'revoked');assert.equal(expired.delivery_state,'authority_expired');assert.equal(expired.result,null);assert.equal(expired.cancel_requested,true)
  assert.ok(expired.completed_at);assert.equal(fixture.events.filter(e=>e.method==='POST').length,0)
  await device(`/api/local-agents/jobs/${expired.id}/progress`,{run_id:expired.run_id,event_id:randomUUID(),message:'Late progress'},{status:409})
  await device(`/api/local-agents/jobs/${expired.id}/result`,{run_id:expired.run_id,event_id:randomUUID(),status:'completed',result:{summary:'Late result',actions:[],verified:true}},{status:409})

  const completed=await create()
  await worker.run(completed.task('investigate'))
  const report=await completed.read();assert.equal(report.status,'completed');assert.equal(report.authority.minutes,1)
  const before=await completed.visitor.transcript(),reply=report.result.replies[0]
  const draft=(await api(`${completed.path}/${report.id}/result/draft`,{proposal_id:reply.id,expected_revision:before.revision,expected_last_message_id:before.lastMessageId})).data
  await setExpiry(report.id,Date.now()-1000);await restart()
  assert.equal((await completed.read()).authority.expired,true,'the same deadline survives persisted application restart')
  await api(`${completed.path}/${report.id}/result/draft`,{proposal_id:reply.id,expected_revision:before.revision,expected_last_message_id:before.lastMessageId},{status:409})
  await api(`/api/conversations/${completed.conversationId}/messages`,{localId:randomUUID(),content:draft.body,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,authoring:draft.authoring},{status:409})
  await api(`${completed.path}/${report.id}/result/replies/${reply.id}/send`,{},{status:409})
  await api(`${completed.path}/${report.id}/result/follow-up-actions/enable`,{},{status:409})
  assert.equal((await completed.visitor.transcript()).messages.filter(m=>m.actor_role!=='contact').length,0)
  assert.equal((await api(completed.path)).data.length,1,'expired evidence creates no replacement repair')
 }finally{await worker.close()}
}
