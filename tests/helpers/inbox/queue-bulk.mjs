import assert from 'node:assert/strict'
import {ticketFixture} from './ticket-fixture.mjs'
import {selfServiceFixture} from '../self-service-fixture.mjs'

// QUEUE-002 extends the existing tickets journey. Apart from fixture identity
// provisioning and provider-edge responses, every observation uses a public door.
export async function queueBulkJourney(){
 const f=await ticketFixture(),{app,w,foreign,id,ok,get,patch,visitor}=f
 try{
  const staleId=await f.create(1)
  const neighbour=await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey},headers:{Origin:foreign.allowedOrigin}})
  const foreignId=(await app.ok('/api/conversations',{token:neighbour.token,body:{projectId:foreign.projectId}})).id
  const foreignBase=`/api/dashboard/projects/${foreign.projectId}`
  const foreignTicket=async()=>(await app.ok(`${foreignBase}/conversations/${foreignId}/ticket`,{token:foreign.tokens.owner})).data
  const audit=async(project=w)=> (await app.ok(`/api/management/projects/${project.projectId}/audit?limit=200`,{token:project.tokens.owner})).data
  const transcript=(ticket,token)=>app.ok(`/api/conversations/${ticket}/messages`,{token})
  const foreignBefore=await foreignTicket(),foreignAuditBefore=await audit(foreign),foreignMessages=await transcript(foreignId,neighbour.token)
  const messages=new Map(await Promise.all([id,staleId].map(async ticket=>[ticket,await transcript(ticket,visitor.token)])))
  const removed=await ok(`/conversations/${id}/tags`,{name:'Needs triage'})
  const added=await ok(`/conversations/${staleId}/tags`,{name:'Reviewed queue'})
  await patch(id,{priority:'high'})
  const view=await ok('/ticket-views',{name:'High priority triage',visibility:'shared',filters:[{field:'priority',operator:'in',value:['normal','high','urgent']}],sort:[{field:'priority',direction:'desc'}]})
  const inbox=await ok('/conversations?view=open')
  assert.ok(inbox.some(ticket=>ticket.id===id));assert.ok(inbox.some(ticket=>ticket.id===staleId))
  const selection=await Promise.all([id,staleId].map(async ticket=>({id:ticket,expected_version:(await get(ticket)).ticket_version})))
  const batch={tickets:[...selection,{id:foreignId,expected_version:foreignBefore.ticket_version}],changes:{assigned_to:w.users.operator,priority:'urgent',status_id:'on_hold',add_tags:[added.id],remove_tags:[removed.id]}}
  const before=await get(id),beforeStale=await get(staleId)
  const preview=await ok('/tickets/bulk/preview',batch)
  assert.deepEqual(preview.results.map(result=>[result.id,result.status]),[[id,'ready'],[staleId,'ready'],[foreignId,'forbidden']])
  assert.deepEqual(preview.counts,{ready:2,forbidden:1})
  assert.deepEqual(await get(id),before);assert.deepEqual(await get(staleId),beforeStale)
  assert.deepEqual(await foreignTicket(),foreignBefore,'preview changes no foreign record')
  await patch(staleId,{subject:'Another operator updated this request'})
  const staleBefore=await get(staleId),applied=await ok('/tickets/bulk/apply',batch)
  assert.deepEqual(applied.results.map(result=>[result.id,result.status]),[[id,'applied'],[staleId,'stale'],[foreignId,'forbidden']])
  assert.deepEqual(applied.counts,{applied:1,stale:1,forbidden:1})
  assert.equal(applied.results[0].committed,true)
  assert.match(applied.results[1].reason,/changed.*reload/i)
  assert.equal(applied.results[2].reason,'Ticket is unavailable or your role cannot change it')
  assert.ok(!JSON.stringify(applied).includes(foreign.projectId),'refusal does not disclose foreign workspace data')

  // Reload the worker and the inbox, rather than relying on mutation receipts.
  await app.configure({})
  const saved=await get(id)
  assert.equal(saved.priority,'urgent');assert.equal(saved.status_id,'on_hold');assert.equal(saved.status_category,'on_hold')
  assert.equal(saved.assigned_to,w.users.operator)
  assert.deepEqual(saved.tags.map(tag=>tag.id),[added.id])
  assert.deepEqual(await get(staleId),staleBefore,'a stale record keeps every field, tag and history entry')
  assert.deepEqual(await foreignTicket(),foreignBefore,'foreign ticket, tags, fields and history remain exact')
  assert.deepEqual(await audit(foreign),foreignAuditBefore,'no foreign audit writes')
  const reloadedView=await ok(`/ticket-views/${view.id}`)
  assert.deepEqual(reloadedView.filters,view.filters);assert.deepEqual(reloadedView.sort,view.sort)
  assert.deepEqual((await ok(`/conversations?saved_view=${view.id}`)).map(ticket=>ticket.id),[id,staleId],'the reloaded view sorts urgent before normal priority')
  const events=(await audit()).filter(event=>event.action==='ticket.bulk.apply'&&event.detail.batch_id===applied.batch_id)
  assert.equal(events.length,3,'one public audit receipt per selected record, including refusals')
  for(const [ticket,result,outcome] of [[id,'applied','succeeded'],[staleId,'stale','refused'],[foreignId,'forbidden','refused']]){
   const matches=events.filter(event=>event.target_id===ticket)
   assert.equal(matches.length,1);const event=matches[0]
   assert.equal(event.detail.result,result);assert.equal(event.outcome,outcome)
   assert.equal(event.actor_id,w.users.owner);assert.equal(event.actor_type,'user');assert.equal(event.source,'dashboard')
   assert.equal(event.target_type,'conversation');assert.ok(event.at>0)
   assert.deepEqual(event.detail.fields.sort(),Object.keys(batch.changes).sort())
  }

  // The existing helper proves bulk macro application and editable drafts;
  // extend its isolation/no-send proof to both permitted records and the refusal.
  const field=await ok('/ticket-fields',{name:'Queue reference',type:'regex',validation:{pattern:'^QUEUE-[0-9]+$'}})
  const beforeInvalid=await get(id)
  for(const value of ['not-a-queue-reference',42]){
   assert.equal((await f.call(`/conversations/${id}/ticket`,{expected_version:beforeInvalid.ticket_version,fields:{[field.id]:value}},'owner','PATCH')).status,400)
   assert.deepEqual(await get(id),beforeInvalid,'typed field validation refuses invalid values without changes')
  }
  const macro=await ok('/macros',{title:'Queue follow-up',content:'Request {{ticket.id}} is being reviewed.',actions:{priority:'high',fields:{[field.id]:'QUEUE-42'}}})
  const tickets=[...await Promise.all([id,staleId].map(async ticket=>({id:ticket,expected_version:(await get(ticket)).ticket_version}))),{id:foreignId,expected_version:foreignBefore.ticket_version}]
  const macroResult=await ok(`/macros/${macro.id}/apply`,{version:macro.version,command_id:'queue-bulk-follow-up',tickets})
  assert.deepEqual(macroResult.results.map(result=>result.status),['applied','applied','forbidden'])
  await app.configure({})
  for(const ticket of [id,staleId]){
   const saved=await get(ticket),draft=await ok(`/conversations/${ticket}/macro-draft`)
   assert.equal(saved.fields[field.id],'QUEUE-42');assert.equal(saved.priority,'high')
   assert.equal(draft.content,`Request ${ticket} is being reviewed.`);assert.deepEqual(draft.unresolved,[])
   assert.deepEqual(await transcript(ticket,visitor.token),messages.get(ticket),'bulk edits and macros publish no reply')
  }
  assert.deepEqual(await foreignTicket(),foreignBefore)
  assert.deepEqual(await audit(foreign),foreignAuditBefore)
  assert.deepEqual(await transcript(foreignId,neighbour.token),foreignMessages)
  assert.equal((await app.ok(`${foreignBase}/conversations/${foreignId}/macro-draft`,{token:foreign.tokens.owner})).data,null)
 }finally{await app.close()}
 await formFieldQueue()
}

async function formFieldQueue(){
 const f=await selfServiceFixture(),{app,p,owner,api,form,valid,reason,order,signin}=f
 const base=`/api/dashboard/projects/${p}`
 const ok=async(path,body,method)=>(await app.ok(base+path,{...owner,...(body===undefined?{}:{body}),...(method?{method}:{})})).data
 try{
  const customer=await signin('queue-customer@example.test',`/help/${p}/requests/${form.id}`)
  const submit=async(localId,fields)=> (await app.ok(`${api}/${form.id}/submissions`,{...customer,body:{...valid,localId,fields}})).ticket.id
  const matching=await submit('queue-refund',valid.fields)
  const earlier=await submit('queue-earlier-refund',{[reason.id]:'refund',[order.id]:'NS-10480'})
  const open=await submit('queue-open-refund',{[reason.id]:'refund',[order.id]:'NS-10483'})
  const other=await submit('queue-question',{[reason.id]:'question'})
  for(const ticket of [matching,earlier,other]){
   const current=await ok(`/conversations/${ticket}/ticket`)
   await ok(`/conversations/${ticket}/ticket`,{expected_version:current.ticket_version,status_id:'pending'},'PATCH')
  }
  const view=await ok('/ticket-views',{name:'Pending refund forms',visibility:'shared',filters:[{field:'status_id',operator:'eq',value:'pending'},{field:'status_category',operator:'eq',value:'pending'},{field:`custom:${reason.id}`,operator:'eq',value:'refund'}],sort:[{field:`custom:${order.id}`,direction:'asc'}]})
  await app.configure({})
  const saved=await ok(`/conversations/${matching}/ticket`)
  assert.equal(saved.channel,'form');assert.equal(saved.fields[reason.id],'refund');assert.equal(saved.fields[order.id],'NS-10482')
  const definition=await ok(`/ticket-views/${view.id}`)
  assert.deepEqual(definition.filters,view.filters);assert.deepEqual(definition.sort,view.sort)
  const selected=await ok(`/conversations?saved_view=${view.id}`)
  assert.deepEqual(selected.map(ticket=>ticket.id),[earlier,matching],'the view sorts matching form answers and excludes the open refund and Pending non-refund')
  assert.ok(!selected.some(ticket=>[open,other].includes(ticket.id)))
 }finally{await app.close()}
}
