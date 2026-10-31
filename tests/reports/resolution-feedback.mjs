import assert from 'node:assert/strict'
import {assistantApp} from '../helpers/ai/app.mjs'

// All feedback, lifecycle, revocation and erasure evidence uses native routes.
// The signed-in workspace is the only setup fixture; this flow calls no provider.
export async function resolutionFeedbackHistory(){
 const a=await assistantApp(),{app,p,owner}=a
 try{
  await app.ok(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'-',default_verified_user_ai_id:'-'}})
  const visitor=await a.visitor('Resolution history'),id=visitor.conversationId
  const detail=`/api/dashboard/projects/${p}/conversations/${id}`
  const read=async token=>(await app.ok(detail,{token:token??owner})).data
  const transition=resolved=>app.call(detail,{token:owner,method:'PUT',body:{resolved},status:200})
  const rate=(resolutionId,value,comment)=>app.call(`/api/conversations/${id}/widget-events`,{token:visitor.token,body:{action:'rateResolution',data:{resolutionId,value,comment}}})
  const reply=async content=>{
   const current=await visitor.transcript()
   await app.call(`/api/conversations/${id}/messages`,{token:owner,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,authoring:{kind:'human'}},status:200})
  }
  await visitor.say('Please explain the replacement.')
  await reply('The replacement arrives tomorrow.');await transition(true)
  const first=(await visitor.transcript()).resolution
  assert.equal((await rate(first.id,1,'Original private comment')).status,200)
  assert.equal((await rate(first.id,-1,'Corrected private comment')).status,200)
  await transition(false)
  assert.equal((await visitor.transcript()).resolution,null,'an open cycle has no eligible resolution')
  assert.equal((await rate(first.id,1,'Cannot rate while reopened')).status,409)
  const retained=(await read()).resolutionHistory
  assert.equal(retained.length,1);assert.equal(retained[0].id,first.id)
  assert.deepEqual(retained[0].ratingHistory.map(row=>[row.revision,row.value,row.comment]),[[1,1,'Original private comment'],[2,-1,'Corrected private comment']],'operators can inspect every retained rating revision')
  assert.deepEqual([retained[0].rating.revision,retained[0].rating.value,retained[0].rating.comment],[2,-1,'Corrected private comment'])
  for(const row of retained[0].ratingHistory)assert.ok(Number.isFinite(Date.parse(row.createdAt)))
  assert.equal('resolutionHistory' in await visitor.transcript(),false)
  await app.call(detail,{token:visitor.token,status:403})
  const outsider=await app.seedWorkspace('feedback-outsider')
  await app.call(detail,{token:outsider.tokens.owner,status:404})

  await reply('Here is the corrected delivery date.');await transition(true)
  const second=(await visitor.transcript()).resolution
  assert.notEqual(second.id,first.id);assert.equal(second.rating,null)
  assert.equal((await rate(second.id,1,'Second cycle private comment')).status,200)
  // Revoke an otherwise eligible session through sign-out, without also expiring
  // it or opting out: denial must be caused by revocation itself.
  await app.call('/api/identity/session',{token:visitor.token,method:'DELETE',status:200})
  assert.equal((await rate(second.id,-1,'Revoked session must not write')).status,401)
  assert.deepEqual([(await read()).resolution.rating.value,(await read()).resolution.rating.revision],[1,1])
  await transition(false)
  const before=(await read()).resolutionHistory
  assert.deepEqual(before.map(row=>[row.id,row.ratingHistory.length]),[[second.id,1],[first.id,2]],'both closed cycles retain their own history')
  await app.call(`/api/management/projects/${p}/contacts/${visitor.contactId}/erase`,{token:owner,body:{},status:200})
  const after=(await read()).resolutionHistory
  const redacted=before.map(row=>({...row,rating:{...row.rating,comment:''},ratingHistory:row.ratingHistory.map(rating=>({...rating,comment:''}))}))
  assert.deepEqual(after,redacted,'erasure redacts every historical comment through the operator door, retaining revisions and values')
  assert.doesNotMatch(JSON.stringify(after),/Original private|Corrected private|Second cycle private|Revoked session/)


  // A stale or revoked transition must change neither status nor assignment,
  // and must not cancel queued work as a side effect of its rejected write.
  await app.ok(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'ai',default_verified_user_ai_id:'ai'}})
  const pending=await a.visitor('Pending answer');await pending.say('Please check this delivery.')
  const pendingDetail=`/api/dashboard/projects/${p}/conversations/${pending.conversationId}`
  const pendingRead=async()=>(await app.ok(pendingDetail,{token:owner})).data
  const trace=async()=>(await app.ok(`/api/ai-support/projects/${p}/conversations/${pending.conversationId}/trace`,{token:owner})).generations.map(row=>[row.id,row.state])
  const queued=await trace();assert.equal(queued.length,1);assert.equal(queued[0][1],'queued')
  const snapshot=row=>({assigned:row.assigned_to,ai:row.ai_id,resolved:row.resolved_at,version:row.ticket_version})
  const unchanged=snapshot(await pendingRead())
  await app.call('/api/identity/session',{token:a.workspace.tokens.operator,method:'DELETE',status:200})
  await app.call(detail,{token:a.workspace.tokens.operator,status:401})

  const change={resolved:true,agent_id:a.workspace.users.owner,ai_id:null}
  await app.call(pendingDetail,{token:a.workspace.tokens.operator,method:'PUT',body:change,status:401})
  await app.call(pendingDetail+'/ticket',{token:owner,method:'PATCH',body:{status_id:'solved',agent_id:a.workspace.users.owner,ai_id:null,expected_version:unchanged.version-1},status:409})
  assert.deepEqual(snapshot(await pendingRead()),unchanged)
  assert.deepEqual(await trace(),queued,'rejected transitions cannot cancel the queued answer')
  await app.call(pendingDetail,{token:owner,method:'PUT',body:change,status:200})
  const committed=await pendingRead()
  assert.equal(committed.assigned_to,a.workspace.users.owner);assert.equal(committed.ai_id,null);assert.ok(committed.resolved_at)
  assert.deepEqual(await trace(),[[queued[0][0],'cancelled']],'the accepted status and assignment change cancels queued work together')
  assert.equal(a.providerCalls(),0)
 }finally{await a.close()}
}
