import assert from 'node:assert/strict'
import {nativeHarness} from './harness.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {root,json,encode,review,apply,undo,state,rows} from './journey-kit.mjs'
import {zip} from './zip.mjs'

const dashboard='/api/dashboard/projects/p',management='/api/management/projects/p'
const stamp='2024-01-01T00:00:00Z'
const person=(id,role,name,email)=>({user:{id,role,name,email,created_at:stamp}})
const ticket=(id,fields)=>({ticket:{id,subject:`synthetic-hh-${id}`,status:'open',via:{channel:'email'},created_at:stamp,updated_at:stamp,comments:[{id:id*10,author_id:91,public:true,body:`synthetic-hh-${id} historical answer`,created_at:stamp}],...fields}})
const decision=(run,id)=>{const found=run.plan.decisions.find(row=>row.kind==='ticket'&&row.sourceId===String(id));assert.ok(found,`ticket ${id} has a review decision`);assert.equal(found.rejection,undefined);return found}
const target=(run,id)=>{const found=decision(run,id).targets.find(row=>row.kind==='conversation');assert.ok(found,`ticket ${id} can be imported`);return found.id}
const omission=(run,id,reason)=>assert.ok(decision(run,id).omissions.some(row=>row.reason===reason),`ticket ${id} explains ${reason}`)
const detail=async(h,id)=>(await h.call(`${dashboard}/conversations/${id}`)).data
const noAccessOrDelivery=(initial,snapshot)=>{
 for(const table of ['portal_links','portal_identities','portal_session_proofs','email_deliveries','conversation_outbox','workflow_notifications','notification_triggers']){assert.ok(Object.hasOwn(snapshot,table));assert.ok(Object.hasOwn(initial,table));assert.deepEqual(snapshot[table],initial[table],`${table} stays inert`)}
}

async function excludedCustomer(h,system,customers){
 for(const base of [management,dashboard]){
  const listed=await h.call(`${base}/contacts?sort=name&direction=asc`)
  assert.equal(listed.pagination.total,customers)
  assert.equal(listed.data.length,customers)
  assert.ok(listed.data.every(row=>row.id!==system))
  for(const total of ['', '&total=none']){
   const searched=await h.call(`${base}/contacts?search=No%20requester${total}`)
   assert.deepEqual(searched.data,[],'system identity never appears as a customer search result')
   if(!total)assert.equal(searched.pagination.total,0)
  }
 }
 assert.deepEqual((await h.call(`${dashboard}/tickets/requesters?q=No%20requester`)).data,[],'operator requester selector excludes the system identity')
 assert.equal((await h.raw(`${management}/contacts/${encodeURIComponent(system)}`)).response.status,404,'system identity has no customer record page')
}

async function noRequester(h,run,id,system){
 const conversationId=target(run,id),thread=await detail(h,conversationId)
 assert.equal(thread.contact.id,system)
 assert.equal(thread.contact.email,null)
 assert.equal(thread.contact_id,null)
 assert.equal(thread.requester_id,null)
 assert.equal(thread.requester_status,'none')
 const fields=(await h.call(`${dashboard}/conversations/${conversationId}/ticket`)).data
 assert.equal(fields.contact_id,null)
 assert.equal(fields.requester_id,null)
 assert.equal(fields.requester_status,'none')
 const buckets=(await h.call(`${dashboard}/conversations/${conversationId}/buckets`)).data
 assert.ok(buckets.flatMap(row=>row.messages).some(row=>row.content===`synthetic-hh-${id} historical answer`),'history remains visible without a requester')
 omission(run,id,'requester_absent_system_contact')
 return thread
}

// An extension of the existing import admission registration: retain historical
// ticket identity, reuse it in a later export, and reverse only owned data.
export async function ticketIdentityJourney(){
 const h=await nativeHarness()
 try{
  const initial=await h.snapshot(),records=[
   person(1,'end-user','synthetic-hh-1','synthetic-hh-1@example.test'),
   person(91,'agent','synthetic-hh-91','owner@example.test'),
   // A matching name and a foreign-workspace email must grant no assignment.
   person(92,'agent','owner','synthetic-hh-unmapped@example.test'),
   person(93,'admin','synthetic-hh-93','foreign@example.test'),
   ...['urgent','high','normal','low'].map((priority,index)=>ticket(101+index,{requester_id:1,assignee_id:91,priority})),
   ticket(105,{requester_id:1,assignee_id:92,priority:'critical'}),
   ticket(106,{requester_id:1,assignee_id:93}),
   ticket(107,{assignee_id:91,priority:'high'}),
   ticket(108,{requester_id:null,priority:null}),
   // An explicit staff requester keeps its own inert imported identity.
   ticket(109,{requester_id:91,priority:'normal'}),
  ],body=encode(records),ready=await review(h,'zendesk',body,'synthetic-hh-ticket-identity.ndjson')
  for(const id of [105,106])omission(ready,id,'historical_assignment_not_matched')
  omission(ready,105,'priority_not_mapped_default_normal')
  for(const id of [106,108])omission(ready,id,'priority_unrecorded_default_normal')
  // Admission creates workspace infrastructure before publication. It is allowed
  // to survive undo; every business row is compared with this admitted baseline.
  const admitted=await h.snapshot()
  await apply(h,ready)
  for(const [index,priority] of ['urgent','high','normal','low'].entries()){
   const thread=await detail(h,target(ready,101+index))
   assert.equal(thread.assigned_to,'owner','exact staff email resolves to the current workspace member')
   assert.equal(thread.agent.id,'owner')
   assert.equal(thread.priority,priority)
  }
  for(const id of [105,106]){const thread=await detail(h,target(ready,id));assert.equal(thread.assigned_to,null);assert.equal(thread.priority,'normal')}
  const absent=await detail(h,target(ready,107)),system=absent.contact.id
  await noRequester(h,ready,107,system);await noRequester(h,ready,108,system)
  const systemRows=await rows(h,'SELECT * FROM contacts WHERE id=? AND project_id=?',system,'p')
  assert.equal(systemRows.length,1)
  assert.equal(systemRows[0].email,null);assert.equal(systemRows[0].is_verified,0)
  assert.equal(JSON.parse(systemRows[0].metadata_json).system_contact,'no_requester')
  const staff=await detail(h,target(ready,109))
  assert.notEqual(staff.contact.id,system)
  assert.equal(staff.requester_id,staff.contact.id,'an explicit source agent requester is not treated as absent')
  assert.equal(staff.contact.name,'synthetic-hh-91');assert.equal(staff.contact.email,null)
  assert.equal(staff.assigned_to,null)
  assert.equal((await h.call(`${management}/contacts/${staff.contact.id}`)).data.external_id,'import:zendesk:91')
  await excludedCustomer(h,system,2)
  assert.deepEqual((await rows(h,'SELECT id,email FROM users ORDER BY id')),initial.users.map(({id,email})=>({id,email})).sort((a,b)=>a.id.localeCompare(b.id)),'historical staff receive no native account')
  const rawListed=(await h.call('/api/conversations')).conversations
  for(const id of [107,108]){const raw=await h.call(`/api/conversations/${target(ready,id)}`),listedRaw=rawListed.find(row=>row.id===raw.id);assert.equal(raw.contact_id,null);assert.equal(listedRaw.contact_id,null);assert.equal(raw.requester_id,null);assert.equal(raw.requester_status,'none');assert.equal(listedRaw.requester_id,null);assert.equal(listedRaw.requester_status,'none')}
  const listed=(await h.call(`${dashboard}/conversations`)).data
  for(const id of [107,108]){const thread=listed.find(row=>row.id===target(ready,id));assert.ok(thread);assert.equal(thread.contact_id,null);assert.equal(thread.requester_id,null);assert.equal(thread.requester_status,'none')}
  const landed=await h.snapshot()
  noAccessOrDelivery(initial,landed)
  const repeated=await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-ticket-identity.ndjson'},body})
  assert.equal(repeated.alreadyImported,true);assert.equal(repeated.writes,0);assert.equal(h.lastWrites,0)
  assertBusinessEquality(landed,await h.snapshot())
  const repacked=await review(h,'zendesk',zip([{name:'nested/source.jsonl',body}]),'synthetic-hh-repacked.zip')
  await apply(h,repacked);assertBusinessEquality(landed,await h.snapshot())
  const catchup=await review(h,'zendesk',encode([...records,ticket(110,{requester_id:null,priority:'urgent'})]),'synthetic-hh-catchup.ndjson')
  await apply(h,catchup)
  await noRequester(h,catchup,110,system)
  assert.equal((await rows(h,'SELECT count(*) n FROM contacts WHERE id=?',system))[0].n,1,'later imports reuse the same workspace identity')
  await excludedCustomer(h,system,2)
  noAccessOrDelivery(initial,await h.snapshot())
  await undo(h,catchup);assertBusinessEquality(landed,await h.snapshot())
  await undo(h,repacked);assertBusinessEquality(landed,await h.snapshot())
  await undo(h,ready);assertBusinessEquality(admitted,await h.snapshot())
  assert.deepEqual((await h.call(`${management}/contacts`)).data,[],'undo leaves no imported customers')
  await excludedCustomer(h,system,0)
  // Inspect durable effects as well as immediate network calls: an imported
  // system identity never schedules email or acquires portal authority.
  noAccessOrDelivery(initial,await h.snapshot())
  const editedRun=await review(h,'zendesk',encode([records[0],records[1],ticket(101,{requester_id:1,assignee_id:91,priority:'urgent'})]),'synthetic-hh-edit-priority.ndjson')
  await apply(h,editedRun)
  const editedId=target(editedRun,101),beforeEdit=(await h.call(`${dashboard}/conversations/${editedId}/ticket`)).data
  await h.call(`${dashboard}/conversations/${editedId}/ticket`,{...json({expected_version:beforeEdit.ticket_version,priority:'low'}),method:'PATCH'})
  const edited=await h.snapshot()
  await h.call(`${root}/${editedRun.id}/undo`,json({}));await h.drain()
  assert.equal((await state(h,editedRun)).error,'NATIVE_EDIT_CONFLICT','priority is import-owned and a later operator change blocks destructive undo')
  assert.equal((await detail(h,editedId)).priority,'low')
  assertBusinessEquality(edited,await h.snapshot())
  const machine=await h.call(`${management}/connections/tokens`,json({name:'Ticket identity reader',scopes:['conversations:read']}))
  const absentRun=await review(h,'zendesk',encode([records[1],ticket(111,{requester_id:null,priority:'high'})]),'synthetic-hh-api-identity.ndjson')
  await apply(h,absentRun)
  const apiRead=path=>h.call(path,{headers:{Authorization:`Bearer ${machine.token}`}}),absentId=target(absentRun,111),apiList=(await apiRead('/api/v1/conversations')).data
  for(const row of [apiList.find(row=>row.id===absentId),(await apiRead('/api/v1/conversations/'+absentId)).data]){assert.ok(row);assert.equal(row.contact_id,null);assert.equal(row.requester_id,null);assert.equal(row.requester_status,'none')}
  const real=(await apiRead('/api/v1/conversations/'+editedId)).data
  assert.equal(real.contact_id,real.requester_id);assert.notEqual(real.contact_id,null,'a real customer retains a resolvable contact id')
  assert.equal(h.outbound,0,'review, import, catchup, repeat, undo and native priority editing contact no provider')
 }finally{await h.close()}
}
