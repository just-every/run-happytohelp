import test from 'node:test'
import assert from 'node:assert/strict'
import {computersApp,completed} from '../helpers/delegation/computers.mjs'
import {adoptionJourney} from '../helpers/delegation/adoption.mjs'

test('a person authorizes a task session, verifies and sends its result once, and revokes started work without pretending the computer stopped',async()=>{
 const t=await computersApp({conversations:['c','next','queued']})
 const {request,grantDevice,delegate,claimed,report,job,app}=t
 try{
  const worker=await grantDevice('synthetic-support-session')
  const id=await delegate('c',worker.id,'synthetic-computer-fix','operator','resolve_reply')
  const claim=await claimed(worker,'synthetic-fix-claim',id)
  assert.equal((await request('/api/local-agents/claim',{claim_id:'synthetic-fix-claim'},worker.token)).data.run_id,claim.run_id)
  assert.equal((await request(`/api/local-agents/jobs/${id}/context?run_id=wrong`,undefined,worker.token)).status,409)
  const result={...completed('The account setting is repaired'),replies:[{id:'review',title:'Review reply',body:'Your account is ready.'}]}
  // Lose an acknowledgement after the durable report; replay settles the same result.
  await t.fault('report_ack','conversation_notes',`NEW.id='delegation:${id}'`)
  assert.equal((await report(id,claim,'synthetic-report',result,worker.token)).status,500)
  await t.clear('report_ack')
  assert.equal((await report(id,claim,'synthetic-report',result,worker.token)).status,200)
  assert.equal((await report(id,claim,'synthetic-report',result,worker.token)).status,200)
  assert.equal((await app.first("SELECT COUNT(*) n FROM messages WHERE conversation_id='c'")).n,0)
  const send=`/api/projects/p/conversations/c/delegations/${id}/result/replies/review/send`
  const sent=await request(send,{})
  assert.equal(sent.status,200);assert.equal(sent.data.status,'sent')
  assert.equal((await request(send,{})).data.message_id,sent.data.message_id)
  assert.equal((await app.first("SELECT COUNT(*) n FROM messages WHERE conversation_id='c'")).n,1)
  const next=await delegate('next',worker.id,'synthetic-next-work'),active=await claimed(worker,'synthetic-next-claim',next)
  const queued=await delegate('queued',worker.id,'synthetic-not-started')
  assert.equal((await request('/api/projects/p/local-agent-grants/'+worker.grantId,undefined,'operator','DELETE')).status,200)
  assert.equal((await job(next)).status,'revoked');assert.equal((await job(next)).delivery_state,'authority_revoked')
  assert.equal((await job(next)).result,null)
  assert.equal((await job(queued)).status,'cancelled')
  assert.equal((await report(next,active,'synthetic-late-report',completed('Late'),worker.token)).status,401)
  assert.equal((await request('/api/local-agents/heartbeat',{},worker.token)).status,401)
 }finally{await t.close()}
})

test('Use adopts only the current authorized verified result and its files into an editable draft; ordinary Send admits it once',adoptionJourney)
