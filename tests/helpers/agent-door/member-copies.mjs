import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {accessToken,autonomousPolicy} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'
import {memberExport} from './member-export.mjs'
import {emailDigest,idDigest} from '../../../src/vendor/agent-base/modules/business-settings/retire.ts'

const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('')

/** Extend the existing member-erasure/signed-sync journey without registrations. */
export async function memberCopies({app,owner,project,native,person,context,call,rpc,adopt,settings,conversation,taylor,taylorSession,sub,email}){
 const root=`/api/dashboard/projects/${project}/conversations/${conversation.id}`,erase=`/api/management/projects/${project}/agents/${taylor.id}/erase`,cookie='h2h_session='+owner.token
 const member={id:sub,email,name:'Taylor Support',role:'member',invite:1}
 // Earlier public-door steps erased a teammate. Erasure retired them from the Business roster (no bs_team row, no
 // entry in the stored document) and left only value-free bs_retired digests: never an email to put back.
 const other=(await app.sql("SELECT b.business_id id,b.email,b.business_role role,b.invite FROM bs_team b JOIN users u ON u.id=b.operator_id WHERE b.operator_id<>? AND u.email<>'erased:'||u.id",taylor.id)).map(row=>({...row,name:'Unrelated teammate'}))
 const erasedRoster=()=>app.sql("SELECT b.* FROM bs_team b JOIN users u ON u.id=b.operator_id WHERE u.email='erased:'||u.id")
 const priorTombstones=await app.sql('SELECT * FROM bs_retired ORDER BY digest')
 assert.deepEqual(await erasedRoster(),[],'an erased teammate leaves the Business roster')
 assert.ok(priorTombstones.length,'the earlier member erasure left value-free Business tombstones')
 // Preserve an unrelated active teammate in the managed roster.
 const survivor=(await native(`/api/management/projects/${project}/agents`,{body:{email:'synthetic-happytohelp-survivor@example.test'}})).data
 await app.ok('/api/identity/accept-token',{body:{token:new URL(survivor.invitationUrl).searchParams.get('token'),name:'Synthetic Survivor',password:'synthetic-happytohelp-survivor-password'}})
 const survivorSession=await app.ok('/api/identity/login',{body:{email:survivor.email,password:'synthetic-happytohelp-survivor-password'}})
 const live={id:randomUUID(),email:survivor.email,name:'Synthetic Survivor',role:'member',invite:1}
 assert.equal((await settings(5,[member,live,...other])).status,200)
 assert.deepEqual(await erasedRoster(),[],'a signed roster never brings an erased teammate back')
 assert.deepEqual(await app.sql('SELECT * FROM bs_retired ORDER BY digest'),priorTombstones,'a revision that omits the erased leaves their tombstones as they were')
 const unrelatedBefore=await app.first('SELECT * FROM bs_team WHERE business_id=?',live.id)
 assert.equal(unrelatedBefore.state,'active')
 const listed=async id=>({row:await app.first('SELECT operator_id,state FROM bs_team WHERE business_id=?',id),entry:JSON.parse((await app.first('SELECT document FROM bs_settings')).document).team?.some(item=>item.id===id)??false})
 assert.equal((await listed(sub)).entry,true);assert.ok((await listed(sub)).row,'the teammate is on the Business roster before erasure')
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
  assert.deepEqual(await listed(sub),{row:null,entry:false},'erasing a teammate retires them from the Business roster and its stored document')
  const afterBuckets=await buckets(),afterReviews=await reviews(),review=afterReviews.find(row=>row.id===reviewId)
  const exported=await memberExport(app)
  // Capture all three observations before assertions, including the source regression.
  console.log('PROBE E1/E2/E3',JSON.stringify({bucketLeaksName:JSON.stringify(afterBuckets).includes('Taylor Support'),reviewLeaksName:JSON.stringify(afterReviews).includes('Taylor Support'),exportLeaksName:exported.includes('Taylor Support'),exportLeaksEmail:exported.includes(email)}))
  assert.doesNotMatch(JSON.stringify(afterBuckets),/Taylor Support/,'E1 ordinary buckets redact erased assignees after restart')
  assert.deepEqual(afterBuckets.flatMap(bucket=>bucket.events).filter(event=>event.type==='AGENT_ASSIGNED').map(({id,created_at})=>({id,created_at})),chronology,'E1 nonpersonal assignment chronology survives')
  assert.ok(JSON.stringify(afterBuckets).includes('Morgan Support'),'E1 another teammate assigned by the erased actor survives')
  assert.ok(review,'E2 useful review history survives')
  assert.equal(before.state,'open');assert.equal(review.state,'executed','E2 erased review retains its executed outcome as terminal history')
  assert.equal(review.tool,before.tool)
  assert.equal(review.outcome,'held','E2 a review without a saved execution result keeps the conservative tombstone outcome')
  assert.deepEqual(review.classes,before.classes.map(item=>item.class))
  assert.equal(review.decision_id,undefined,'E2 erased review strips its saved decision handle')
  assert.ok(review.tombstone.erasure_id);assert.ok(Number.isFinite(Date.parse(review.tombstone.at)),'E2 retained review records a dated erasure tombstone')
  assert.equal(review.summary,undefined);assert.equal(review.undo,undefined)
  const undo=await person(`/agents/api/reviews/${reviewId}/undo`,{},cookie)
  assert.equal(undo.status,409);assert.equal(undo.data.code,'subject_erased','E2 erased review cannot undo the assignment')
  assert.doesNotMatch(JSON.stringify(afterReviews),/Taylor Support/,'E2 ordinary owner reviews redact copied assignment summaries')
  assert.doesNotMatch(exported,/Taylor Support|taylor@example.test/,'E1 E2 E3 native D1 export contains no erased copied identity')
  assert.ok(exported.includes('agent_door_reviews')&&exported.includes(reviewId)&&exported.includes('AGENT_ASSIGNED'),'export retains real populated assignment and review history')
  assert.deepEqual(await app.first('SELECT * FROM bs_team WHERE business_id=?',live.id),unrelatedBefore,'E3 unrelated active roster survives erasure')
  assert.equal((await app.call(erase,{token:owner.token,body:{}})).status,409,'retry cannot recreate an erased membership')
  assert.equal((await native(`/api/management/projects/${project}/contacts/${(await native(root)).data.contact.id}`)).data.name,'Avery Buyer','unrelated customer identity survives teammate erasure')
  // Omitting the erased person does not discard their durable frontier.
  assert.equal((await settings(6,[live,...other])).status,200)
  assert.equal((await settings(7,null)).status,200,'a values-only sync leaves the erasure frontier intact')
  const roster=await app.sql('SELECT * FROM bs_team ORDER BY email'),document=(await app.first('SELECT document FROM bs_settings')).document
  assert.doesNotMatch(JSON.stringify([roster,document]),/Taylor Support|taylor@example.test/,'E3 stored roster and document copies hold nothing of the erased teammate')
  // Erasure retired the teammate from the Business roster: no row, no document entry, and a value-free tombstone
  // (the address and Business id digests with the invite number they had) in bs_retired.
  const tombstones=await app.sql('SELECT digest,invite FROM bs_retired WHERE digest IN (?,?)',await emailDigest(email),await idDigest(sub))
  assert.deepEqual(tombstones.map(row=>row.invite),[1,1],'the tombstone keeps the invite number the teammate had')
  assert.doesNotMatch(JSON.stringify(await app.sql('SELECT * FROM bs_retired')),/taylor|Taylor/)
  // The Business keeps listing the erased teammate: same invite, a later revision, a changed address under the old
  // Business id and a listing without the id all apply as retired. Everyone else applies, nothing of the
  // teammate is created, and a restart cannot turn the listing into an invitation.
  for(const [rev,entry] of [[8,member],[9,{...member,email:'synthetic-happytohelp-renamed@example.test'}],[10,{...member,id:undefined}]]){
   const sync=await settings(rev,[entry,live,...other]);assert.equal(sync.status,200,JSON.stringify(sync.data))
   assert.deepEqual(sync.data.retired,[entry.email],'E3 a signed roster that still lists an erased teammate applies them as retired')
   assert.equal(await app.first('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',project,taylor.id),null)
   assert.equal(await app.first('SELECT 1 FROM identity_tokens WHERE user_id=?',taylor.id),null)
   assert.equal(await app.first('SELECT 1 FROM users WHERE lower(email)=?',entry.email),null,'no native account is created for a retired listing')
   await app.configure({})
  }
  assert.deepEqual(await app.sql('SELECT * FROM bs_team ORDER BY email'),roster,'E3 retired listings write no roster row and no personal copy')
  assert.doesNotMatch((await app.first('SELECT document FROM bs_settings')).document,/Taylor Support|taylor@example.test|renamed@example.test/)
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
  const relisted=await settings(12,[{...member,invite:2},live,...other])
  assert.equal(relisted.status,200,JSON.stringify(relisted.data));assert.deepEqual(relisted.data.retired,[email],'restart preserves the new erasure frontier too')
  assert.equal(await app.first('SELECT 1 FROM bs_team WHERE business_id=?',sub),null)
  // A teammate erased by a release before bs_retired left a hash-named, inactive roster row and no tombstone. The
  // Business's next revision retires them, listed or not; a larger invite admits them as someone new.
  const olderErasure=async(operatorId,invite)=>{
   await app.db.prepare('DELETE FROM bs_retired WHERE digest IN (?,?)').bind(await emailDigest(email),await idDigest(sub)).run()
   await app.db.prepare("INSERT INTO bs_team(email,operator_id,invite,state,business_id,business_role) VALUES(?,?,?,'inactive',?,'member')").bind('erased:'+await sha256(email),operatorId,invite,sub).run()
  }
  await olderErasure(invited.operator_id,2)
  const upgraded=await settings(13,[live,...other]);assert.equal(upgraded.status,200,JSON.stringify(upgraded.data))
  assert.equal(await app.first('SELECT 1 FROM bs_team WHERE operator_id=?',invited.operator_id),null,'the next Business revision retires a teammate an older release erased')
  assert.deepEqual((await app.sql('SELECT invite FROM bs_retired WHERE digest=?',await idDigest(sub))).map(row=>row.invite),[2],'the older erasure is tombstoned with the invite it had')
  const stillRetired=await settings(14,[{...member,invite:2},live,...other]);assert.equal(stillRetired.status,200)
  assert.deepEqual(stillRetired.data.retired,[email],'a retired teammate stays retired at the invite they had')
  // The roster corner: the Business keeps listing the person by their real address and no member id. The older
  // release stored only the hash-named address, so the team adapter's `retiredForms` is what ties the listing to
  // that tombstone. A teammate the installation never erased, listed the same way, is invited as usual.
  const hire={email:'synthetic-happytohelp-newhire@example.test',name:'Synthetic New Hire',role:'member',invite:1}
  const byAddress=await settings(15,[{...member,id:undefined,invite:2},hire,live,...other]);assert.equal(byAddress.status,200,JSON.stringify(byAddress.data))
  assert.deepEqual(byAddress.data.retired,[email],'a roster that lists an erased teammate by address alone applies as retired')
  assert.equal(await app.first('SELECT 1 FROM users WHERE lower(email)=?',email),null,'no fresh account for the retired listing')
  assert.equal(await app.first('SELECT 1 FROM bs_team WHERE business_id=? OR email=?',sub,email),null,'no roster row for the retired listing')
  assert.equal((await app.first('SELECT state FROM bs_team WHERE email=?',hire.email)).state,'invited','a person never erased is invited as before')
  await olderErasure(invited.operator_id,2)
  const readmitted=await settings(16,[{...member,invite:3},live,...other]);assert.equal(readmitted.status,200,JSON.stringify(readmitted.data))
  const again=await app.first('SELECT operator_id,state FROM bs_team WHERE business_id=?',sub)
  assert.equal(again.state,'invited');assert.notEqual(again.operator_id,invited.operator_id,'a larger invite creates a new account for a teammate an older release erased')
  assert.equal(readmitted.data.retired,undefined)
  assert.equal((await app.call(`/api/management/projects/${project}/agents/${again.operator_id}/erase`,{token:owner.token,body:{}})).status,200)
  await app.configure({})
  assert.doesNotMatch(await memberExport(app),/Taylor Support|taylor@example.test/,'retry and restarted stale sync cannot restore exported identity')
  await adopt()
 }
}
