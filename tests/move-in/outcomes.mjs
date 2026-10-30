import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {nativeHarness} from './harness.mjs'
import {generate} from './generator.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {root,json,encode,review,apply,undo,state} from './journey-kit.mjs'

// Observe the actual route, queue and paid/network edges, including durable work
// that might otherwise send later. Fixture setup never replaces a product writer.
async function inert(h,label,operation){
 const before=await h.snapshot(),requests=h.outbound
 const call=h.call
 h.call=async(path,options)=>{const {response,data}=await h.raw(path,options);assert.ok(response.ok,JSON.stringify({status:response.status,data}));if(path.startsWith('/api/move-in/'))assert.equal(response.headers.get('X-Test-Widget-Effects'),'0',`${label}: zero widget edge calls`);return data}
 let result
 try{result=await operation()}finally{h.call=call}
 const after=await h.snapshot()
 assert.equal(h.outbound,requests,`${label}: zero external requests`)
 assert.deepEqual(h.outboundRequests,[],`${label}: no attempted provider request, even if swallowed`)
 for(const table of ['conversation_outbox','email_deliveries','ai_generations','context_jobs','conversation_ai','operator_notification_activity','operator_notifications','notification_triggers','notification_trigger_claims','notification_inbox','workflow_notifications']){
  assert.ok(Object.hasOwn(before,table),`${table} is observed`)
  assert.deepEqual(after[table],before[table],`${label}: no mail, widget, model, assignment or connection notice work`)
 }
 assert.ok(h.queued.every(job=>job.type==='move-in'),`${label}: only import continuation may be queued`)
 return result
}

async function publicReadback(h,run){
 const decisions=run.plan.decisions,targets=kind=>decisions.flatMap(row=>row.targets.filter(target=>target.kind===kind).map(target=>({source:row.sourceId,...target})))
 assert.deepEqual([...new Set(decisions.flatMap(row=>row.targets.map(target=>target.kind)))].sort(),['article','contact','conversation','macro','tag'])
 for(const target of targets('conversation')){
  const thread=(await h.call(`/api/dashboard/projects/p/conversations/${target.id}`)).data
  assert.equal(thread.imported.source_id,target.source);assert.equal(thread.imported.vendor,'zendesk')
  assert.equal(Date.parse(thread.created_at),1704067260000);assert.equal(Date.parse(thread.updated_at),1704067380000)
  assert.equal(thread.assigned_to,null);assert.deepEqual(thread.tags.map(tag=>tag.name).sort(),['Billing','Priority'])
  const buckets=(await h.call(`/api/dashboard/projects/p/conversations/${target.id}/buckets`)).data
  const messages=buckets.flatMap(bucket=>bucket.messages),notes=buckets.flatMap(bucket=>bucket.events).filter(event=>event.type==='INTERNAL_NOTE')
  assert.deepEqual(messages.map(message=>[message.local_id,Date.parse(message.created_at)]),[['import:11',1704067260000],['import:13',1704067380000]])
  assert.equal(notes.length,1);assert.equal(notes[0].content,'Private note 1');assert.equal(Date.parse(notes[0].created_at),1704067290000);assert.equal(notes[0].agent_id,'import:900001')
  await h.contactSession('customer','p',thread.contact.id)
  const customer=await h.call(`/api/conversations/${target.id}/messages`,{actor:'customer'})
  assert.ok(!JSON.stringify(customer).includes('Private note 1'),'private notes never reach an authenticated customer')
 }
 const contacts=(await h.call('/api/management/projects/p/contacts')).data
 assert.equal(contacts.length,1)
 for(const target of targets('contact')){
  const contact=(await h.call(`/api/management/projects/p/contacts/${target.id}`)).data
  assert.equal(contact.external_id,`import:zendesk:${target.source}`);assert.equal(contact.email,'person1@example.test');assert.equal(contact.created_at,1704067200000)
 }
 const tags=(await h.call('/api/dashboard/projects/p/tags')).data
 assert.deepEqual(tags.map(tag=>tag.name).sort(),['Billing','Priority'])
 assert.deepEqual(tags.map(tag=>tag.id).sort(),targets('tag').map(tag=>tag.id).sort(),'source tag identities resolve through the workspace door')
 for(const target of targets('macro')){
  const macro=(await h.call(`/api/management/projects/p/macros/${target.id}`)).data
  assert.equal(target.source,'50001');assert.equal(macro.title,'Greeting');assert.equal(macro.content,'Hello, how can we help?');assert.equal(macro.created_at,1704067200000)
  assert.equal((await h.call(`/api/management/projects/p/macros/${target.id}/versions`)).data[0].created_at,1704067230000)
  assert.equal(macro.scope.visibility,'shared');assert.equal(macro.actions.reply_type,'public')
 }
 const articles=await h.call('/api/knowledge/p/articles'),published=await h.call('/api/knowledge/public/p/articles')
 assert.equal(articles.length,2);assert.equal(published.length,1)
 for(const target of targets('article')){
  const article=articles.find(row=>row.id===target.id)
  assert.ok(article);assert.equal(article.updated_at,1704067230000)
  assert.equal(article.status,target.source==='60001'?'published':'draft');assert.equal(article.is_published,target.source==='60001')
  assert.ok(article.slug.includes(`zendesk-${target.source}-`))
  assert.equal(published.some(row=>row.id===target.id),article.status==='published')
 }
 assert.equal((await h.call('/api/dashboard/projects/p/reports?period=7')).volume,0)
}

async function custodyAndRows(h,source,run){
 const files=await h.files,original=(await files.list({prefix:`move-in/p/${run.id}/`})).objects.find(row=>row.key.endsWith('/original'))
 assert.ok(original);const bytes=Buffer.from(await (await files.get(original.key)).arrayBuffer())
 assert.deepEqual(bytes,Buffer.from(source))
 const changed=JSON.parse(source.trim().split('\n').find(line=>JSON.parse(line).user?.role==='end-user'))
 changed.user.name='Changed source name'
 const changedBody=encode([changed]),before=await h.snapshot(),other=await review(h,'zendesk',changedBody,'history.jsonl')
 assert.notEqual(other.id,run.id,'changed source receives new custody under the same filename')
 assert.ok((await h.call(root)).data.some(row=>row.id===run.id))
 const conflict=other.plan.decisions.find(row=>row.sourceId==='1')
 assert.equal(conflict.rejection,'source_changed_conflict');assert.deepEqual(conflict.location,{artifact:'history.jsonl',row:1})
 assert.equal((await h.raw(`${root}/${other.id}/apply`,json({fingerprint:other.plan.fingerprint}))).response.status,409)
 assertBusinessEquality(before,await h.snapshot())
 assert.deepEqual(Buffer.from(await (await files.get(original.key)).arrayBuffer()),bytes,'new review never overwrites earlier source bytes')
 assert.equal((await files.head(original.key)).etag,original.etag)
 const next=(await files.list({prefix:`move-in/p/${other.id}/`})).objects.find(row=>row.key.endsWith('/original'))
 assert.notEqual(next.key,original.key);assert.deepEqual(Buffer.from(await (await files.get(next.key)).arrayBuffer()),Buffer.from(changedBody))
 const records=[{...changed,user:{...changed.user,id:70001,email:'omitted@example.test',user_fields:{legacy:'retained'}}},{macro:{id:70002,title:'Restricted',restriction:{type:'Group',id:1},created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-01T00:00:00Z',actions:[{field:'comment_value',value:'Private'}]}}]
 const explained=await review(h,'zendesk',encode(records),'decisions.jsonl')
 const omission=explained.plan.decisions.find(row=>row.sourceId==='70001'),rejection=explained.plan.decisions.find(row=>row.sourceId==='70002')
 assert.ok(omission.omissions.some(item=>item.reason==='custom_fields_retained_in_original_only'))
 assert.equal(omission.location.artifact,'decisions.jsonl');assert.equal(omission.location.row,1)
 assert.equal(rejection.rejection,'restricted_macro_not_imported');assert.equal(rejection.location.artifact,'decisions.jsonl');assert.equal(rejection.location.row,2)
}

async function roleDenials(){
 const h=await nativeHarness(),password=randomBytes(24).toString('base64url'),body=generate('zendesk',1)
 const role=async value=>h.call('/api/management/projects/p/agents/operator',{...json({role:value}),method:'PUT'})
 try{
  await h.call('/api/identity/password',{...json({password}),actor:'operator'})
  await role('admin');await h.login('operator',password)
  const run=await review(h,'zendesk',body,'role.jsonl','operator')
  async function denied(label){
   const before=await h.snapshot(),pending=h.queued.length
   for(const [path,options] of [[`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'role.jsonl'},body}],...[['apply',{fingerprint:run.plan.fingerprint}],['resume',{}],['undo',{}]].map(([step,payload])=>[`${root}/${run.id}/${step}`,json(payload)])]){
    const response=await h.raw(path,{...options,actor:'operator'})
    assert.ok([401,403,404].includes(response.response.status),`${label}: refused ${path}, got ${response.response.status}`)
    assert.equal(h.lastWrites,0,`${label}: denied request writes nothing`)
   }
   assert.equal(h.queued.length,pending);assertBusinessEquality(before,await h.snapshot())
  }
  await role('operator');await denied('revoked admin session');await h.login('operator',password);await denied('current ordinary member')
  await role('admin');await h.login('operator',password)
  await inert(h,'apply',()=>h.call(`${root}/${run.id}/apply`,{...json({fingerprint:run.plan.fingerprint}),actor:'operator'}))
  await role('operator');await denied('authority revoked during publication')
  assert.deepEqual((await h.step()).retried,[0]);assert.equal((await h.call('/api/management/projects/p/contacts')).data.length,0)
  assert.equal(h.queued.length,0,'denied queue delivery leaves publication stopped until explicit resume')
  await role('admin');await h.login('operator',password)
  await inert(h,'resume stopped publication',async()=>{await h.call(`${root}/${run.id}/resume`,{...json({}),actor:'operator'});await h.drain();assert.equal((await state(h,run,'operator')).state,'completed')})
  await role('operator');await h.login('operator',password);await denied('ordinary member after publication')
  await role('admin');await h.login('operator',password)
  await inert(h,'whole-import undo',()=>undo(h,run,'operator'))
  await h.call('/api/management/projects/p/agents/operator',{method:'DELETE'});await denied('removed member')
 }finally{await h.close()}
}

export async function outcomesJourney(){
 const h=await nativeHarness(),source=generate('zendesk',1)
 try{
  const run=await review(h,'zendesk',source)
  await inert(h,'approved five-kind apply',()=>apply(h,run));await publicReadback(h,run)
  await inert(h,'identical repeat',async()=>{const repeat=await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'history.jsonl'},body:source});assert.equal(repeat.alreadyImported,true);assert.equal(h.lastWrites,0)})
  await custodyAndRows(h,source,run)
  const accessed=await h.snapshot()
  await inert(h,'undo with later customer access',async()=>{
   await h.call(`${root}/${run.id}/undo`,json({}));await h.drain()
   assert.equal((await state(h,run)).error,'NATIVE_EDIT_CONFLICT')
   assertBusinessEquality(accessed,await h.snapshot())
  })
  const conversation=(await h.call('/api/dashboard/projects/p/conversations')).data[0]
  assert.equal((await h.raw(`/api/conversations/${conversation.id}/messages`,{actor:'customer'})).response.status,200,'refused reversal preserves the customer session and transcript')
  // Close only the synthetic session fixture installed for customer readback.
  // No product/native record is edited to make reversal succeed.
  await h.db.prepare("DELETE FROM sessions WHERE project_id='p' AND contact_id=? AND role='contact'").bind(conversation.contact.id).run()
  await inert(h,'resume whole-import undo',async()=>{await h.call(`${root}/${run.id}/resume`,json({}));await h.drain();assert.equal((await state(h,run)).state,'undone')})
  assert.equal((await h.call('/api/management/projects/p/contacts')).data.length,0)
  // Exact undo equality is asserted in reviewImportJourney/capacityJourney.
  // This flow also creates/closes a separate authentication fixture, whose
  // authority-epoch counter deliberately survives its session's removal.
 }finally{await h.close()}
 await roleDenials()
}
