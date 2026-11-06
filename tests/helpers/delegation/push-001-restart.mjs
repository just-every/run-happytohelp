import assert from 'node:assert/strict'
import {computersApp,completed} from './computers.mjs'

// Fault durable effect execution, then restart workerd with the same persisted
// D1. The only entry into recovery is the public scheduled Worker entry/queue.
export async function push001RestartOutcomes(){
 const counts=async(t,conversation)=>({jobs:(await t.app.first('SELECT count(*) n FROM local_jobs WHERE conversation_id=?',conversation)).n,notes:(await t.app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation)).n,messages:(await t.app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)).n,customerEvents:t.app.requests.length})
 for(const scenario of ['note','legacy','legacy_before','revoked','membership']){
  const t=await computersApp({operators:['u','admin'],conversations:[scenario]})
  try{
   const worker=await t.pair(),id=await t.delegate(scenario,worker.id,'restart-'+scenario,'operator',scenario==='note'?'investigate':'resolve_reply'),claim=await t.claimed(worker,'claim-'+scenario,id)
   const result=scenario==='note'?{...completed('Observation recorded'),replies:[]}:{...completed('Legacy observed recovery'),reply_draft:'Legacy approved report '+scenario}
   // Interrupt before reply admission or after it but before the note. Both
   // restart positions must settle on one message and one note in total.
   const blocked=['revoked','membership'].includes(scenario)
   const receiptFault=blocked||scenario==='legacy_before'
   await t.fault('pending_'+scenario,receiptFault?'local_receipts':'conversation_notes',receiptFault?`NEW.job_id='${id}'`:`NEW.id='delegation:${id}'`)
   assert.equal((await t.report(id,claim,'report-'+scenario,result,worker.token)).status,500)
   assert.equal(await t.effectState(id),'pending');assert.equal((await t.job(id)).status,'completed')
   const before=await counts(t,scenario);assert.deepEqual(before,{jobs:1,notes:0,messages:scenario==='legacy'?1:0,customerEvents:0})
   await t.clear('pending_'+scenario)
   if(scenario==='revoked')assert.equal((await t.request('/api/projects/p/local-agents/'+worker.id,undefined,'operator','DELETE')).status,200)
   if(scenario==='membership')await t.run("DELETE FROM memberships WHERE project_id='p' AND user_id='u'")
   const terminal=await t.job(id)
   await t.app.configure({});await t.app.scheduled();await t.app.drainJobs()
   const after=await counts(t,scenario)
   assert.equal(await t.effectState(id),blocked?'blocked':'completed')
   assert.equal((await t.job(id)).status,'completed');assert.equal((await t.job(id)).result,terminal.result)
   if(blocked)assert.equal((await t.job(id)).delivery_state,'authorization_lost')
   assert.deepEqual(after,{...before,notes:blocked?0:1,messages:scenario==='legacy_before'?1:before.messages})
   const visible=(await t.request(`/api/projects/p/conversations/${scenario}/delegations`,undefined,'operator2')).data.find(j=>j.id===id);assert.equal(visible.status,'completed')
   if(!blocked){const note=await t.app.first('SELECT * FROM conversation_notes WHERE id=?','delegation:'+id);assert.equal(note.user_id,'u');assert.ok(note.content.includes(result.summary))}
   await t.app.scheduled();await t.app.drainJobs();assert.deepEqual(await counts(t,scenario),after);assert.equal(await t.effectState(id),blocked?'blocked':'completed')
   console.log(JSON.stringify({proof:'PUSH-001 result effect restart',scenario,id,before,after,effect:await t.effectState(id),terminal:visible.status,deliveryState:visible.delivery_state}))
  }finally{await t.close()}
 }
 // The operator may still inspect the delegation after losing only reply
 // permission. Delivery itself must check that narrower live authority.
 for(const scenario of ['permission','departed']){
  const t=await computersApp({conversations:[scenario]})
  try{
   const worker=await t.pair(),id=await t.delegate(scenario,worker.id,'send-'+scenario),claim=await t.claimed(worker,'send-claim-'+scenario,id)
   const result={...completed('Observed setting'),replies:[{id:'report',title:'Observed report',body:'Observed recovery '+scenario}]}
   assert.equal((await t.report(id,claim,'send-report-'+scenario,result,worker.token)).status,200)
   const before=await counts(t,scenario);assert.deepEqual(before,{jobs:1,notes:1,messages:0,customerEvents:0})
   const path=`/api/projects/p/conversations/${scenario}/delegations/${id}/result/replies/report/send`
   // Withdraw authority at the durable receipt boundary, between route access
   // and actual delivery, as a concurrent role/membership change can do.
   await t.run(`CREATE TRIGGER withdraw_${scenario} AFTER INSERT ON local_receipts WHEN NEW.job_id='${id}' BEGIN ${scenario==='permission'?"UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='u'; INSERT INTO member_roles VALUES('p','u','collaborator',1);":"DELETE FROM memberships WHERE project_id='p' AND user_id='u';"} END`)
   const sent=await t.request(path,{});assert.equal(sent.status,200);assert.equal(sent.data.status,'needs_review');assert.match(sent.data.review_message,scenario==='permission'?/Reply permission lost/:/Operator membership lost/)
   assert.deepEqual(await counts(t,scenario),before);assert.equal((await t.job(id)).status,'completed')
   await t.run('DROP TRIGGER withdraw_'+scenario)
   if(scenario==='permission'){await t.run("DELETE FROM member_roles WHERE project_id='p' AND user_id='u'");await t.run("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='u'")}
   else await t.run("INSERT INTO memberships VALUES('p','u','owner')")
   assert.deepEqual((await t.request(path,{})).data,sent.data);assert.deepEqual(await counts(t,scenario),before)
   console.log(JSON.stringify({proof:'PUSH-001 Send authority lost at delivery',scenario,receipt:sent.data.status,reason:sent.data.review_message,before,after:await counts(t,scenario)}))
  }finally{await t.close()}
 }
}
