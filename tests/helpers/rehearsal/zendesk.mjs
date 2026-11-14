import assert from 'node:assert/strict'
import {SUBDOMAIN,CLIENT_ID} from '../../move-in/zendesk-pull-fixture.mjs'

/** All preparation uses mounted native HTTP and the real queued importer. */
export async function drainZendesk(app){
 for(let tick=0;tick<2000;tick++){
  const jobs=await app.takeJobs()
  if(!jobs.length)return
  for(const job of jobs){
   const table=job.type==='move-in.zendesk'?'move_in_zendesk_pulls':job.type==='move-in.zendesk.attachments'?'move_in_zendesk_attachment_pulls':null
   if(table){const row=await app.first(`SELECT next_at FROM ${table} WHERE id=?`,job.id),wait=(row?.next_at??0)-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait+10))}
  }
  const outcome=await app.runJobs(jobs)
  assert.deepEqual(outcome.retried,[])
 }
 assert.fail('bounded Zendesk copy did not finish')
}
export async function prepareAcceptedZendesk(app,{setup,token,zendesk}){
 const native=`/api/move-in/projects/${setup}/zendesk`,connected=await app.call(native+'/connect',{token,body:{subdomain:SUBDOMAIN,clientId:CLIENT_ID},status:200})
 const consent=zendesk.consent(connected.data.url)
 await app.call('/api/move-in/zendesk/callback?'+new URLSearchParams({code:consent.code,state:consent.state}),{token,status:302})
 const started=(await app.call(native+'/pulls',{token,body:{},status:201})).data.data
 await drainZendesk(app)
 const ready=(await app.call(native+'/pulls/'+started.id,{token,status:200})).data.data
 assert.equal(ready.state,'ready',JSON.stringify(ready))
 await app.call(native+'/pulls/'+started.id+'/approve',{token,body:{fingerprint:ready.fingerprint},status:202})
 await drainZendesk(app)
 const applied=(await app.call(native+'/pulls/'+started.id,{token,status:200})).data.data
 assert.equal(applied.state,'applied',JSON.stringify(applied))
 return applied
}
export async function finishZendeskDay(app,{credential,root,day}){
 const base=root+'/copy/zendesk',accepted=(await app.call(base,{token:credential,status:200})).data.data
 const input={day,cursor:accepted.acceptedCursor},started=(await app.call(base+'/pulls',{token:credential,body:input,status:202})).data.data
 assert.equal((await app.call(base+'/pulls',{token:credential,body:input,status:202})).data.data.id,started.id,'day/cursor retry returns the same pull')
 await drainZendesk(app)
 const pull=(await app.call(base+'/pulls/'+started.id,{token:credential,status:200})).data.data
 assert.equal(pull.state,'applied',JSON.stringify(pull))
 assert.ok(pull.approvedAt,'consent covers the complete computed review without a caller fingerprint')
 await app.call(base+'/pulls/'+started.id+'/attachments',{token:credential,body:{},status:202})
 await drainZendesk(app)
 let result
 for(let tick=0;tick<200;tick++){
  result=(await app.call(base+'/pulls/'+started.id+'/verify',{token:credential,body:{},status:200})).data.data
  if(result.verified)break
 }
 assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.equality.complete,true);assert.equal(result.work.unchanged,true)
 assert.equal(result.attachments.state,'done');assert.equal(result.attachments.error,null)
 assert.equal('before' in result.work,false,'copy never discloses installation work counters')
 assert.equal((await app.call(base+'/pulls/'+started.id+'/result',{token:credential,status:200})).data.data.verified,true)
 assert.equal((await app.call(base+'/pulls',{token:credential,body:input,status:202})).data.data.id,started.id,'verified day retry remains idempotent after accepted cursor advances')
 return result
}
