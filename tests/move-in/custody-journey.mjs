import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {nativeHarness} from './harness.mjs'
import {generate} from './generator.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {root,json,encode,review,state,rows} from './journey-kit.mjs'

export async function custodyJourney(){
 const h=await nativeHarness({withConversations:true})
 try{
  // Initial signed-in admin fixture; subsequent authority changes use Settings.
  await h.db.batch([h.db.prepare("UPDATE memberships SET role='admin' WHERE user_id='operator'"),h.db.prepare("UPDATE sessions SET role='admin' WHERE actor_id='operator'")])
  const password=randomBytes(24).toString('base64url')
  await h.call('/api/identity/password',{...json({password}),actor:'operator'})
  await h.login('operator',password)
  const people=Array.from({length:25},(_,i)=>({type:'contact',id:'part-'+i,name:'Customer '+i,email:`part-${i}@example.test`,created_at:1704067200}))
  const duplicate={type:'contact',id:'conflicted',email:'first@example.test',created_at:1704067200}
  const source=encode([...people,...generate('intercom',1).trim().split('\n').map(JSON.parse),duplicate,{...duplicate,email:'second@example.test'},{type:'macro',id:'restricted',name:'Private reply',body:'Private terms',visible_to:'team',available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}])
  const before=await h.snapshot(),ready=await review(h,'intercom',source,'custody.jsonl','operator')
  assert.ok(ready.plan.decisions.some(item=>item.rejection==='conflicting_duplicate_id'&&item.location.artifact==='custody.jsonl'))
  assert.ok(ready.plan.decisions.some(item=>item.rejection==='restricted_macro_not_imported'))
  assert.ok(ready.plan.diagnostics.some(item=>item.code==='conflicting_duplicate_id'&&item.location.row>25))
  assertBusinessEquality(before,await h.snapshot())
  assert.equal((await h.raw(`${root}/${ready.id}`)).response.status,404,'each reviewer retains private custody')
  assert.equal((await h.raw(`${root}/${ready.id}`,{actor:'foreign'})).response.status,404)
  await h.call(`${root}/${ready.id}/apply`,{...json({fingerprint:ready.plan.fingerprint}),actor:'operator'})
  await h.call('/api/management/projects/p/agents/operator',{...json({role:'operator'}),method:'PUT'})
  assert.ok([401,403].includes((await h.raw(`${root}/${ready.id}/resume`,{...json({}),actor:'operator'})).response.status))
  assert.deepEqual((await h.step()).retried,[0])
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n,0,'queued work rechecks the reviewer before publishing')
  await h.call('/api/management/projects/p/agents/operator',{...json({role:'admin'}),method:'PUT'})
  await h.login('operator',password)
  await h.call(`${root}/${ready.id}/resume`,{...json({}),actor:'operator'})
  await h.step();await h.crashDuringStep()
  await h.call(`${root}/${ready.id}/resume`,{...json({}),actor:'operator'});await h.drain()
  const complete=await state(h,ready,'operator')
  assert.equal(complete.state,'completed');assert.equal(complete.error,null)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n,26)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM conversations'))[0].n,1)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM messages'))[0].n,2,'resumed admission never duplicates history')
  const conversation=(await rows(h,'SELECT id FROM conversations'))[0]
  const tags=`/api/dashboard/projects/p/conversations/${conversation.id}/tags`
  const first=(await h.call(tags,json({name:' Review '}))).data,again=(await h.call(tags,json({name:'review'}))).data
  assert.equal(first.id,again.id,'native tag creation uses the workspace identity')
  await h.db.prepare("INSERT INTO workspace_tags VALUES('foreign-tag','q','Review','review')").run()
  assert.equal((await h.raw(tags,json({tagId:'foreign-tag'}))).response.status,404)
  assert.equal((await h.raw('/api/dashboard/projects/p/conversations?tag=foreign-tag')).response.status,404)
  await h.call(`${tags}/${first.id}`,{method:'DELETE'})
  await h.call(`/api/dashboard/projects/p/conversations/${conversation.id}/notes`,json({content:'Keep the operator follow-up'}))
  const nativeThread=await h.call(`/api/dashboard/projects/p/conversations/${conversation.id}/buckets`)
  await h.call(`${root}/${ready.id}/undo`,{...json({}),actor:'operator'});await h.drain()
  const stopped=await state(h,ready,'operator')
  assert.equal(stopped.state,'undoing');assert.equal(stopped.error,'NATIVE_EDIT_CONFLICT')
  assert.deepEqual(await h.call(`/api/dashboard/projects/p/conversations/${conversation.id}/buckets`),nativeThread,'conflict-safe reversal preserves the edited native thread')
  const buckets=await h.call(`/api/dashboard/projects/p/conversations/${conversation.id}/buckets`)
  assert.ok(JSON.stringify(buckets).includes('Keep the operator follow-up'))
  assert.equal(h.outbound,0,'resumption and refused undo remain inert')
 }finally{await h.close()}
}
