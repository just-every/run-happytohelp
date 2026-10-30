import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {accessToken,autonomousPolicy} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'
import {memberExport} from './member-export.mjs'

/** Extend the existing member-erasure/signed-sync journey without registrations. */
export async function memberCopies({app,owner,project,native,person,context,call,rpc,adopt,settings,conversation,taylor,taylorSession,sub,email}){
 const root=`/api/dashboard/projects/${project}/conversations/${conversation.id}`,erase=`/api/management/projects/${project}/agents/${taylor.id}/erase`,cookie='h2h_session='+owner.token
 const member={id:sub,email,name:'Taylor Support',role:'member',invite:1}
 const other=(await app.sql('SELECT business_id id,email,business_role role,invite FROM bs_team WHERE operator_id<>?',taylor.id)).map(row=>({...row,name:'Unrelated teammate'}))
 // Preserve an unrelated active teammate in the managed roster.
 const survivor=(await native(`/api/management/projects/${project}/agents`,{body:{email:'synthetic-happytohelp-survivor@example.test'}})).data
 await app.ok('/api/identity/accept-token',{body:{token:new URL(survivor.invitationUrl).searchParams.get('token'),name:'Synthetic Survivor',password:'synthetic-happytohelp-survivor-password'}})
 const survivorSession=await app.ok('/api/identity/login',{body:{email:survivor.email,password:'synthetic-happytohelp-survivor-password'}})
 const live={id:randomUUID(),email:survivor.email,name:'Synthetic Survivor',role:'member',invite:1}
 assert.equal((await settings(5,[member,live,...other])).status,200)
 const unrelatedBefore=await app.first('SELECT * FROM bs_team WHERE business_id=?',live.id)
 assert.equal(unrelatedBefore.state,'active')
 // A retained pre-upgrade receipt has only the legacy assignee-name copy;
 // generate it through the real native door, then stage that older stored shape.
 await native(root,{method:'PUT',body:{assigned_to:taylor.id}})
 await app.db.prepare("UPDATE context_tracked_events SET payload=json_remove(payload,'$.assigned_to') WHERE project_id=? AND type='AGENT_ASSIGNED' AND json_extract(payload,'$.assigned_to')=?").bind(project,taylor.id).run()
 await native(root,{method:'PUT',body:{assigned_to:owner.userId}})
 await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'review'}],reviewers:['person:'+context.person.sub]})
 const ticket=(await call('happytohelp.conversations.read',{id:conversation.id})).result.ticket
 const assigned=await rpc('tools/call',{name:'happytohelp.conversations.assign',arguments:{id:conversation.id,version:ticket.ticket_version,user_id:taylor.id,idempotency_key:randomUUID()}})
 const reviewId=assigned.data.result._meta['com.runeditrun/review'].id
 const reviews=async()=>(await person('/agents/api/reviews',undefined,cookie)).data.reviews
 const before=(await reviews()).find(row=>row.id===reviewId)
 assert.ok(JSON.stringify(before.summary).includes('Assign to Taylor Support'),'owner review exposes the original assignment summary before erasure')
 // The erased teammate also assigned somebody else. That name must survive.
 assert.equal((await app.call(root,{token:taylorSession.token,method:'PUT',body:{assigned_to:owner.userId}})).status,200)
 const buckets=async()=>(await native(root+'/buckets')).data
 const beforeBuckets=await buckets()
 assert.ok(JSON.stringify(beforeBuckets).includes('Taylor Support'),'ordinary buckets expose the original assignee before erasure')
 const chronology=beforeBuckets.flatMap(bucket=>bucket.events).filter(event=>event.type==='AGENT_ASSIGNED').map(({id,created_at})=>({id,created_at}))
 for(const token of [taylorSession.token,survivorSession.token])assert.equal((await app.call(erase,{token,body:{}})).status,403,'non-owner member erasure denied')
 const stranger=await app.seedWorkspace('synthetic-happytohelp-cross-tenant')
 assert.equal((await app.call(erase,{token:stranger.tokens.owner,body:{}})).status,403,'cross-tenant member erasure denied')
 assert.equal((await app.call(`/api/management/projects/${project}/agents/${stranger.users.operator}/erase`,{token:owner.token,body:{}})).status,409,'an owner cannot erase another tenant account')
 assert.ok(await app.first('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',stranger.projectId,stranger.users.operator),'other tenant membership survives denied erasure')
 assert.equal((await app.first('SELECT email FROM users WHERE id=?',taylor.id)).email,email,'denied erasures leave personal data unchanged')
 return async()=>{
  await app.configure({})
  const afterBuckets=await buckets(),afterReviews=await reviews(),review=afterReviews.find(row=>row.id===reviewId)
  const exported=await memberExport(app)
  // Capture all three observations before assertions, including the source regression.
  console.log('PROBE E1/E2/E3',JSON.stringify({bucketLeaksName:JSON.stringify(afterBuckets).includes('Taylor Support'),reviewLeaksName:JSON.stringify(afterReviews).includes('Taylor Support'),exportLeaksName:exported.includes('Taylor Support'),exportLeaksEmail:exported.includes(email)}))
  assert.doesNotMatch(JSON.stringify(afterBuckets),/Taylor Support/,'E1 ordinary buckets redact erased assignees after restart')
  assert.deepEqual(afterBuckets.flatMap(bucket=>bucket.events).filter(event=>event.type==='AGENT_ASSIGNED').map(({id,created_at})=>({id,created_at})),chronology,'E1 nonpersonal assignment chronology survives')
  assert.ok(JSON.stringify(afterBuckets).includes('Morgan Support'),'E1 another teammate assigned by the erased actor survives')
  assert.ok(review,'E2 useful review history survives')
  assert.equal(review.state,before.state);assert.equal(review.tool,before.tool);assert.equal(review.decision_id,before.decision_id)
  assert.doesNotMatch(JSON.stringify(afterReviews),/Taylor Support/,'E2 ordinary owner reviews redact copied assignment summaries')
  assert.doesNotMatch(exported,/Taylor Support|taylor@example.test/,'E1 E2 E3 native D1 export contains no erased copied identity')
  assert.ok(exported.includes('agent_door_reviews')&&exported.includes(reviewId)&&exported.includes('AGENT_ASSIGNED'),'export retains real populated assignment and review history')
  assert.deepEqual(await app.first('SELECT * FROM bs_team WHERE business_id=?',live.id),unrelatedBefore,'E3 unrelated active roster survives erasure')
  assert.equal((await app.call(erase,{token:owner.token,body:{}})).status,409,'retry cannot recreate an erased membership')
  assert.equal((await native(`/api/management/projects/${project}/contacts/${(await native(root)).data.contact.id}`)).data.name,'Avery Buyer','unrelated customer identity survives teammate erasure')
  // Omitting the erased person does not discard their durable frontier.
  assert.equal((await settings(6,[live,...other])).status,200)
  assert.equal((await settings(7,null)).status,200,'a values-only sync leaves the erasure frontier intact')
  const erasedRoster=await app.sql('SELECT * FROM bs_team'),document=(await app.first('SELECT document FROM bs_settings')).document
  assert.doesNotMatch(JSON.stringify([erasedRoster,document]),/Taylor Support|taylor@example.test/,'E3 stored roster and document copies are anonymized')
  // Same revision, higher revision and changed address under the old Business id
  // all retain the erasure fence. A restart cannot turn it into an invitation.
  for(const [rev,entry] of [[7,member],[8,member],[9,{...member,email:'synthetic-happytohelp-renamed@example.test'}],[10,{...member,id:undefined}]]){
   const sync=await settings(rev,[entry,live,...other]);assert.equal(sync.status,409,'E3 stale signed sync cannot re-invite an erased identity')
   assert.equal(await app.first('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',project,taylor.id),null)
   assert.equal(await app.first('SELECT 1 FROM identity_tokens WHERE user_id=?',taylor.id),null)
   await app.configure({})
  }
  assert.deepEqual(await app.sql('SELECT * FROM bs_team'),erasedRoster,'E3 rejected sync cannot write a roster or personal copies')
  assert.equal((await app.first('SELECT document FROM bs_settings')).document,document)
  // Existing Business authority explicitly permits a larger invite counter.
  // It creates a fresh native account, never reanimates the anonymized one.
  const fresh=await settings(11,[{...member,invite:2},live,...other]);assert.equal(fresh.status,200,JSON.stringify(fresh.data))
  const invited=await app.first('SELECT operator_id,state FROM bs_team WHERE business_id=?',sub)
  assert.equal(invited.state,'invited');assert.notEqual(invited.operator_id,taylor.id)
  assert.equal(await app.first('SELECT 1 FROM memberships WHERE user_id=?',taylor.id),null)
  assert.equal((await app.first('SELECT email FROM users WHERE id=?',taylor.id)).email,'erased:'+taylor.id)
  assert.deepEqual(await app.first('SELECT * FROM bs_team WHERE business_id=?',live.id),unrelatedBefore,'normal fresh invitation preserves unrelated active teammate')
  // The fresh invitation is synthetic new authority; erase it too before the
  // incumbent custody journey checks all stores for the removed identity.
  assert.equal((await app.call(`/api/management/projects/${project}/agents/${invited.operator_id}/erase`,{token:owner.token,body:{}})).status,200)
  await app.configure({})
  assert.equal((await settings(12,[{...member,invite:2},live,...other])).status,409,'restart preserves the new erasure frontier too')
  assert.doesNotMatch(await memberExport(app),/Taylor Support|taylor@example.test/,'retry and restarted stale sync cannot restore exported identity')
  await adopt()
 }
}
