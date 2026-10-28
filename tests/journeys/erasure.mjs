import test from 'node:test'
import assert from 'node:assert/strict'
import {startApp} from './kit/app.mjs'
import {managedEdge} from '../helpers/email/rer-edge.mjs'
import {seedCustomer} from '../helpers/erasure/seed.mjs'
import {storageViews} from '../helpers/erasure/storage.mjs'
import {customerMail} from '../helpers/erasure/mail.mjs'
import {erasedCustomer} from '../helpers/erasure/assertions.mjs'

// A single customer, one application and one resumable erasure across all custody.
test('customer erasure lifecycle: authorized resumable removal, redacted transcripts and mail replay fences preserve other customers',async()=>{
 const edge=managedEdge(),bindings=edge.add('erasure'),deletionRequests=[]
 const app=await startApp({captureQueue:true,bindings,outbound:async(request,entry)=>{
  if(new URL(request.url).hostname==='hooks.crm-example.com'){
   deletionRequests.push(JSON.parse(entry.body));return new Response('ok')
  }
  return edge.outbound(request,entry)
 }})
 try{
  const tokens=await seedCustomer(app),mail=await customerMail(app,bindings)
  const {outsideScope,erasedScope}=storageViews(app),outside=await outsideScope(),populated=await erasedScope()
  const base='/api/management/projects/p',path='/api/conversations/conv1/messages'
  const erase=(token,options={})=>app.call(base+'/contacts/ct/erase',{token,body:{},...options})
  const transcript=token=>app.ok(path,{token})
  const original=await transcript(tokens.contact)
  assert.ok(original.messages.some(message=>message.content.includes('4471')))
  assert.ok(populated.objects.every(Boolean))

  // Refused callers cannot start deletion or reveal another workspace's customer.
  for(const token of [tokens.operator,tokens.contact,tokens.qOwner])assert.equal((await erase(token)).status,403)
  assert.equal((await app.call('/api/management/projects/q/contacts/ct/erase',{token:tokens.qOwner,body:{}})).status,404)
  assert.equal((await app.call(base+'/contacts/qct/erase',{token:tokens.owner,body:{}})).status,404)
  assert.deepEqual(await erasedScope(),populated)
  assert.deepEqual(await outsideScope(),outside)

  const hook=await app.ok(base+'/connections/webhooks',{token:tokens.owner,body:{name:'CRM',url:'https://hooks.crm-example.com/erasure',events:['conversation.created']}})
  // Fail the real request after object deletion and before its atomic content
  // removal. The same public command resumes; no product internals perform work.
  const interrupted=await erase(tokens.admin,{headers:{'x-test-fault':'db-once','x-test-statement':'INSERT INTO contact_erasures'}})
  assert.ok(interrupted.status>=500)
  assert.ok((await app.sql('SELECT * FROM contact_erasure_objects')).length>0)
  assert.ok((await erasedScope()).objects.every(object=>object===null))
  assert.ok((await erasedScope()).messages.some(message=>message.content.includes('4471')))
  assert.equal((await app.call(path,{token:tokens.contact})).status,401)
  assert.equal((await app.call(path,{token:tokens.contact2})).status,401)

  const result=await erase(tokens.admin);assert.equal(result.status,200)
  const first=result.data.data,state=await erasedScope()
  erasedCustomer(state);await mail.verify()
  assert.ok(first.erased_at);assert.equal(first.erased_by,'admin')
  assert.equal(first.messages,populated.messages.length)
  assert.equal(first.sessions,populated.sessions.length)
  assert.equal(first.attachments,populated.objects.length+mail.keys.length)
  assert.ok(first.context_records>0&&first.tracked_events>0)
  assert.deepEqual(state.messages.map(({id,actor_id,actor_role,revision})=>({id,actor_id,actor_role,revision})),populated.messages.map(({id,actor_id,actor_role,revision})=>({id,actor_id,actor_role,revision})))
  assert.deepEqual(state.legacy.map(({source_id,row_digest})=>({source_id,row_digest})),populated.legacy.map(({source_id,row_digest})=>({source_id,row_digest})))
  assert.deepEqual(await app.sql("SELECT * FROM email_reply_grants WHERE token_hash IN ('reply-alice','reply-alias')"),[])
  assert.deepEqual(await outsideScope(),outside)

  // Connected-provider outcomes are separate from native completion. A delivered
  // deletion request does not claim that AI, mailbox or offline copies vanished.
  const providers=first.providers.requests
  assert.ok(providers.some(row=>row.store==='webhook'&&row.state==='pending'))
  for(const store of ['ai_provider','local_computers','email_provider'])assert.ok(providers.some(row=>row.store===store&&row.state==='unsupported'&&row.detail))
  await app.ok(base+`/connections/webhooks/${hook.id}/test`,{token:tokens.owner,body:{}})
  assert.deepEqual(deletionRequests.find(body=>body.event==='contact.erased').data,{contact_id:'ct',external_id:'crm-alice'})
  const settled=(await app.ok(base+'/contacts/ct/erasure',{token:tokens.admin})).data
  assert.equal(settled.providers.counts.completed,1);assert.equal(settled.providers.counts.pending,0)
  const audit=(await app.ok(base+'/audit?limit=200',{token:tokens.owner})).data
  const recorded=audit.find(row=>row.action==='contact.erased'&&row.target_id==='ct')
  assert.ok(recorded);assert.equal(recorded.actor_id,'admin')

  const redacted=await transcript(tokens.operator)
  assert.equal(redacted.revision,original.revision);assert.equal(redacted.lastMessageId,original.lastMessageId)
  assert.deepEqual(redacted.messages.map(message=>[message.id,message.revision]),original.messages.map(message=>[message.id,message.revision]))
  assert.ok(redacted.messages.every(message=>message.erased_at&&message.content===''&&message.media.length===0))
  assert.deepEqual(redacted.messages.map(message=>message.origin),original.messages.map(message=>message.origin),'classifier provenance survives without the original sender or subject')
  assert.equal((await app.call('/api/conversations/conv1/media/md1',{token:tokens.operator})).status,404)
  assert.equal((await app.call('/api/conversations/conv2/media/md2',{token:tokens.operator})).status,404)
  const buckets=(await app.ok('/api/dashboard/projects/p/conversations/conv1/buckets',{token:tokens.operator})).data
  assert.ok(buckets.flatMap(bucket=>bucket.messages).every(message=>message.erased_at&&message.content===''))
  const detail=(await app.ok('/api/dashboard/projects/p/conversations/conv1',{token:tokens.operator})).data
  assert.equal(detail.contact.name,null);assert.equal(detail.contact.email,null)
  const exported=await app.ok('/api/dashboard/projects/p/reports?format=transcripts.json',{token:tokens.owner})
  for(const fragment of ['Alice','alice','4471','4242','passport.png','invoice.pdf'])assert.equal(JSON.stringify(exported).includes(fragment),false,`${fragment} remains in exported transcripts`)

  // Stale client commands and old signed mail cannot recreate erased content.
  const replay=await app.call(path,{token:tokens.operator,body:{localId:'op-1',content:'Thanks Alice, checking order 4471',expectedRevision:1,expectedLastMessageId:'m1a'}})
  assert.equal(replay.status,409);assert.equal(replay.data.accepted,false)
  assert.equal((await app.call(base+'/contacts/ct',{token:tokens.owner,method:'PUT',body:{name:'Alice again'}})).status,409)
  assert.ok(!(await app.ok(base+'/contacts',{token:tokens.operator})).data.some(contact=>contact.id==='ct'))
  await mail.replay()
  assert.equal((await app.call('/api/conversations/convOther/messages',{token:tokens.otherContact})).status,200)

  // An operator can finish the retained thread. Repeating erasure removes that
  // fresh content, keeps the original tombstone and then becomes a storage no-op.
  const followup=await app.ok(path,{token:tokens.operator,body:{localId:'synthetic-after-erasure',content:'Closing this conversation',expectedRevision:redacted.revision,expectedLastMessageId:redacted.lastMessageId}})
  assert.equal(followup.accepted,true)
  const second=(await erase(tokens.owner)).data.data
  assert.equal(second.erased_at,first.erased_at);assert.equal(second.erased_by,first.erased_by)
  assert.equal(second.runs,first.runs+1);assert.equal(second.messages,first.messages+1)
  const after=await erasedScope();erasedCustomer(after)
  const third=(await erase(tokens.owner)).data.data
  assert.equal(third.runs,second.runs+1);assert.equal(third.messages,second.messages)
  assert.equal(third.erased_at,first.erased_at)
  assert.deepEqual(await erasedScope(),after)
  assert.deepEqual(await outsideScope(),outside)
  await mail.verify()
 }finally{await app.close()}
})
