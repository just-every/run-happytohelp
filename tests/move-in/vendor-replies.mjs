import assert from 'node:assert/strict'
import {vendors,methods,vendorSource,evidence,replyContext,importedCases,delta} from './vendor-reply-kit.mjs'

// Public import review/apply, explicit ownership, inbound gateway, ticket and
// transcript routes. The only provider fakes are mail, model and DNS at the edge.
export async function vendorRepliesJourney(){
 for(const vendor of vendors){
  const source=vendorSource(vendor),c=await replyContext(source)
  try{
   const empty=await c.counts(),ready=await c.review();assert.deepEqual(await c.counts(),empty)
   await c.apply(ready);await c.quiet()
   let cases=await importedCases(c,source),originalKeys=await c.keys()
   assert.ok(originalKeys.length>source.cases.length)
   for(const item of cases){assert.equal(item.before.assigned_to,null);assert.equal(item.before.group_id,null)}
   assert.equal((await c.counts()).widget,0,'import creates no widget delivery')
   const landed=await c.counts(),repeat=await c.upload()
   assert.equal(repeat.alreadyImported,true);assert.equal(repeat.writes,0)
   assert.deepEqual(await c.counts(),landed);assert.deepEqual(await c.keys(),originalKeys)
   // Reverse the inert import, before native work that correctly fences undo.
   await c.call(`${c.root}/${ready.id}/undo`,{});await c.app.drainJobs()
   assert.equal((await c.run(ready.id)).state,'undone');assert.deepEqual(await c.keys(),[])
   assert.deepEqual(await c.counts(),empty)
   // Repackage the same logical export after undo, then repeat exact bytes.
   const restored=await c.review({reimport:true});await c.apply(restored);cases=await importedCases(c,source)
   assert.deepEqual(await c.keys(),originalKeys,'reimport restores every inert key exactly')
   const restoredCounts=await c.counts();assert.equal((await c.upload()).alreadyImported,true)
   assert.deepEqual(await c.counts(),restoredCounts);assert.deepEqual(await c.keys(),originalKeys)
   const ownership=`${c.root}/${restored.id}/ownership`,options=await c.call(ownership)
   assert.equal(options.total,cases.length)
   const bindings={owners:{},groups:{}}
   for(const item of options.tickets){if(item.source.ownerId)bindings.owners[item.source.ownerId]=c.workspace.users.operator;if(item.source.groupId)bindings.groups[item.source.groupId]=c.group.id}
   const preview=()=>c.call(ownership+'/preview',bindings)
   const activate=plan=>c.call(ownership+'/apply',{bindings,fingerprint:plan.fingerprint})
   const initial=await preview(),activationCounts=await c.counts()
   // Current group membership and the importing actor's current role, not the
   // preview or a session's old role, decide activation.
   if(vendor==='helpscout')await c.call(`${c.dashboard}/ticket-groups/${c.group.id}`,undefined,'DELETE')
   else await c.call(`${c.dashboard}/ticket-groups/${c.group.id}`,{members:[]},'PATCH')
   const staleGroup=await c.app.call(ownership+'/apply',{token:c.token,body:{bindings,fingerprint:initial.fingerprint}})
   assert.ok([400,409].includes(staleGroup.status),JSON.stringify(staleGroup));assert.deepEqual(await c.counts(),activationCounts)
   if(vendor==='helpscout'){
    c.group=(await c.call(`${c.dashboard}/ticket-groups`,{name:'Migration team',members:[c.workspace.users.operator]})).data
    for(const key of Object.keys(bindings.groups))bindings.groups[key]=c.group.id
   }else await c.call(`${c.dashboard}/ticket-groups/${c.group.id}`,{members:[c.workspace.users.operator]},'PATCH')
   for(const item of cases){const current=await c.ticket(item.id);assert.equal(current.assigned_to,null);assert.equal(current.group_id,null)}
   const fresh=await preview()
   await c.app.ok(`${c.management}/agents/${c.workspace.users.admin}`,{token:c.workspace.tokens.owner,method:'PUT',body:{role:'operator'}})
   assert.ok([401,403].includes((await c.app.call(ownership+'/apply',{token:c.token,body:{bindings,fingerprint:fresh.fingerprint}})).status))
   await c.app.ok(`${c.management}/agents/${c.workspace.users.admin}`,{token:c.workspace.tokens.owner,method:'PUT',body:{role:'admin'}})
   await c.login()
   assert.deepEqual(await c.counts(),activationCounts)
   for(const item of cases){const current=await c.ticket(item.id);assert.equal(current.assigned_to,null);assert.equal(current.group_id,null)}
   assert.equal((await activate(await preview())).applied,cases.length);await c.quiet()
   assert.deepEqual(await c.counts(),activationCounts,'activation sends nothing and admits no messages')
   for(const item of cases){
    const current=await c.ticket(item.id)
    assert.equal(current.assigned_to,item.team?null:c.workspace.users.operator)
    assert.equal(current.group_id,vendor==='helpscout'&&!item.team?null:c.group.id)
    assert.equal(current.requester_id,item.before.requester_id);assert.equal(current.status_category,item.before.status_category)
    if(item.state==='closed'&&['helpscout','intercom'].includes(vendor))await c.call(`${c.dashboard}/conversations/${item.id}/ticket`,{expected_version:current.ticket_version,status_id:'closed'},'PATCH')
    item.before=await c.ticket(item.id)
   }
   for(const item of cases.filter(row=>!row.negative)){
    const oldMessages=(await c.transcript(item.id)).messages,received=await c.receive(item),target=received.result.conversationId
    assert.equal(received.result.state,'delivered',`${vendor} ${item.method} ${item.state}`)
    delta(received.before,received.after,item.state==='closed'?1:0,1)
    const original=await c.ticket(item.id),current=await c.ticket(target)
    assert.equal(current.requester_id,item.before.requester_id);assert.equal(current.contact_id,item.before.contact_id)
    assert.equal(original.assigned_to,item.before.assigned_to);assert.equal(original.group_id,item.before.group_id)
    const messages=(await c.transcript(target)).messages
    assert.equal(messages.length,item.state==='closed'?1:oldMessages.length+1)
    assert.equal(messages.filter(row=>row.content===received.text).length,1)
    if(item.state==='closed'){
     assert.notEqual(target,item.id);assert.equal(original.status_category,'closed')
     assert.deepEqual((await c.transcript(item.id)).messages,oldMessages)
     assert.equal(current.group_id,item.before.group_id)
     const links=await c.call(`${c.management}/conversations/${item.id}/email-followups`)
     assert.ok(links.data.some(row=>row.parent_id===item.id&&row.conversation_id===target),'the follow-up is linked through the public door')
    }else{
     assert.equal(target,item.id);assert.equal(current.assigned_to,item.before.assigned_to);assert.equal(current.group_id,item.before.group_id)
     assert.equal(current.status_category,'open','Open remains Open and Solved reopens')
    }
   }
   // All source Message-ID, In-Reply-To and References entries independently
   // locate the same imported conversation, without a subject or reply address.
   const header=cases.find(row=>row.method==='headers'&&row.state==='open')
   for(const variant of [0,1]){const received=await c.receive(header,evidence(header,variant));assert.equal(received.result.conversationId,header.id);delta(received.before,received.after,0,1)}
   const [a,b]=cases.filter(row=>row.negative),unchanged=await c.transcript(a.id),unchangedB=await c.transcript(b.id)
   const other=await c.receive(a,{from:'another-customer@example.test',headers:{},subject:'A different customer'})
   delta(other.before,other.after,1,1)
   const otherBefore=await c.transcript(other.result.conversationId)
   const wrong=await c.receive(a,{from:'another-customer@example.test'})
   assert.equal(wrong.result.state,'suspended');delta(wrong.before,wrong.after,0,0)
   assert.deepEqual(await c.transcript(a.id),unchanged)
   assert.deepEqual(await c.transcript(other.result.conversationId),otherBefore)
   const held=await c.call(c.management+'/suspended')
   assert.ok(held.data.some(row=>row.reason==='thread_identity_mismatch'&&row.candidate_conversation_id===a.id))
   // A single imported key belonging to two records is ambiguous.
   const ambiguous=await c.receive(a,{headers:{'In-Reply-To':`<shared-${vendor}@example.test>`}})
   assert.equal(ambiguous.result.state,'suspended');delta(ambiguous.before,ambiguous.after,0,0)
   assert.ok((await c.call(c.management+'/suspended')).data.some(row=>row.reason==='conflicting_thread_keys'))
   assert.deepEqual(await c.transcript(a.id),unchanged)
   assert.deepEqual(await c.transcript(b.id),unchangedB)
   // Stronger source headers beat a lower-priority subject/address for another
   // ticket. A source number beats a reply address when no header key matches.
   const lower=cases.find(row=>row.method!=='headers'),preferred=await c.receive(a,{...evidence(lower),headers:{'In-Reply-To':a.chain[2]}})
   assert.equal(preferred.result.conversationId,a.id);delta(preferred.before,preferred.after,0,1)
   if(vendor!=='intercom'){
    const subject=cases.find(row=>row.method==='number'),other=cases.find(row=>row.method==='address')
    if(other){const received=await c.receive(subject,{to:[subject.mailbox,other.address]});assert.equal(received.result.conversationId,subject.id);delta(received.before,received.after,0,1)}
   }
   const unmatched=await c.receive(a,{subject:vendor==='zendesk'?'Re: [Ticket #999999]':vendor==='intercom'?'Old conversation': 'Re: [#999999]',headers:vendor==='intercom'?{'X-Intercom-Conversation-Id':'missing'}:{}})
   assert.equal(unmatched.result.state,'delivered');delta(unmatched.before,unmatched.after,1,1)
   assert.ok((await c.ticket(unmatched.result.conversationId)).tags.length===1)
   // ERASURE-001 removes all four vendors' keys and fences the original export.
   await c.call(`${c.management}/contacts/${a.before.contact_id}/erase`,{})
   assert.deepEqual(await c.keys(),[])
   assert.equal((await c.app.call(`${c.root}?vendor=${vendor}`,{token:c.token,raw:true,body:source.body,headers:{'X-Import-Filename':'erased.jsonl','X-Import-Schema':'2.16'}})).status,410)
   await c.quiet()
   console.log(`MOVE-IN-003 ${vendor}: ${methods(vendor).join(', ')}; lifecycle, custody, refusal, undo/reimport and quiet effects asserted`)
  }finally{await c.close()}
  await undoneReplies(source)
 }
}

async function undoneReplies(source){
 const c=await replyContext(source)
 try{
  const ready=await c.review();await c.apply(ready);const cases=await importedCases(c,source)
  // A prior-storage fixture: earlier imports did not store ownership snapshots.
  // Exercise their real ownership door without inventing an activation mapping.
  const origins=await c.app.sql("SELECT target_id,source_json FROM move_in_origins WHERE project_id=? AND target_kind='conversation'",c.project),before=await c.counts()
  await c.app.db.prepare("UPDATE move_in_origins SET source_json=json_remove(source_json,'$.ownership') WHERE project_id=? AND target_kind='conversation'").bind(c.project).run()
  const ownership=`${c.root}/${ready.id}/ownership`,options=await c.call(ownership)
  assert.equal(options.total,0);assert.deepEqual(options.tickets,[])
  const preview=await c.call(ownership+'/preview',{owners:{},groups:{}})
  assert.equal((await c.app.call(ownership+'/apply',{token:c.token,body:{bindings:{owners:{},groups:{}},fingerprint:preview.fingerprint}})).status,409)
  for(const item of cases){const current=await c.ticket(item.id);assert.equal(current.assigned_to,null);assert.equal(current.group_id,null)}
  await c.quiet();assert.deepEqual(await c.counts(),before)
  // Return from the prior-storage fixture to the byte-exact imported image.
  await c.app.db.batch(origins.map(row=>c.app.db.prepare("UPDATE move_in_origins SET source_json=? WHERE project_id=? AND target_kind='conversation' AND target_id=?").bind(row.source_json,c.project,row.target_id)))
  await c.call(`${c.root}/${ready.id}/undo`,{});await c.app.drainJobs()
  assert.equal((await c.run(ready.id)).state,'undone');assert.deepEqual(await c.keys(),[])
  for(const item of cases.filter(row=>!row.negative)){
   const received=await c.receive(item)
   assert.equal(received.result.state,'delivered',`${source.vendor} undone ${item.method} ${item.state}`);delta(received.before,received.after,1,1)
   assert.ok(!cases.some(row=>row.id===received.result.conversationId))
   assert.equal((await c.ticket(received.result.conversationId)).tags.length,1,'unmatched old reply has the hint')
  }
 }finally{await c.close()}
}
