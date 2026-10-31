import assert from 'node:assert/strict'
import {deskQueueProof} from './desk-proof.mjs'

const ids=rows=>rows.map(row=>row.id).sort()
function resultsFor(batch,selection,statuses){
 assert.deepEqual(batch.results.map(({id,status})=>({id,status})),selection.map((ticket,index)=>({id:ticket.id,status:statuses[index]})),'every selected ticket has exactly one ordered result')
 for(const row of batch.results){
  if(row.status==='stale')assert.match(row.reason,/changed.*reload/i,'a stale row explains how to recover')
  if(row.status==='forbidden'){
   assert.match(row.reason,/unavailable|permission|cannot/i,'an inaccessible row explains the refusal')
   assert.deepEqual(Object.keys(row).sort(),['id','reason','status'],'refused rows disclose only the selected id and a generic reason')
  }
 }
}
export async function securityLog(app,workspace){
 const events=[];let cursor
 do{
  const page=await app.ok(`/api/management/projects/${workspace.projectId}/audit?category=data&limit=200${cursor?'&cursor='+encodeURIComponent(cursor):''}`,{token:workspace.tokens.owner})
  events.push(...page.data);cursor=page.next
 }while(cursor)
 return events
}
async function bulkAudit(f,batch,action){
 const events=(await securityLog(f.app,f.w)).filter(event=>event.action===`ticket.bulk.${action}`&&event.detail.batch_id===batch.batch_id)
 assert.equal(events.length,batch.results.length,'the security log accounts for every row in this batch')
 for(const result of batch.results){
  const matches=events.filter(event=>event.target_id===result.id);assert.equal(matches.length,1)
  const event=matches[0]
  assert.equal(event.target_type,'conversation');assert.equal(event.actor_type,'user');assert.equal(event.actor_id,f.w.users.owner)
  assert.equal(event.source,'dashboard');assert.ok(Number.isFinite(event.at)&&event.at>0)
  assert.equal(event.detail.result,result.status);assert.equal(event.outcome,['ready','applied'].includes(result.status)?'succeeded':'refused')
  assert.deepEqual([...event.detail.fields].sort(),['add_tags','assigned_to','priority','remove_tags','status_id'].sort())
 }
}

// The same replacement queue carries customer-submitted typed answers, mixed
// bulk authority and editable macro drafts through the application's HTTP doors.
export async function queueWork(f,{field,pending,tag}){
 const {app,w,foreign,id,ok,call,get,patch,visitor}=f
 const [second,reason]=await Promise.all([f.create(1),ok('/ticket-fields',{name:'Replacement reason',type:'dropdown',options:['damaged','wrong_size']})])
 const foreignVisitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey},headers:{Origin:foreign.allowedOrigin}})
 const foreignTicket=await app.ok('/api/conversations',{token:foreignVisitor.token,body:{projectId:foreign.projectId}})
 await deskQueueProof(f,{second,tag,foreignVisitor,foreignTicket})
 const definition=(await ok('/ticket-fields')).find(item=>item.id===reason.id)
 assert.equal(definition.type,'dropdown');assert.deepEqual(definition.options,['damaged','wrong_size'])
 const beforeInvalid=await get(second)
 const invalid=await call(`/conversations/${second}/ticket`,{expected_version:beforeInvalid.ticket_version,fields:{[reason.id]:'not-an-option'}},'owner','PATCH')
 assert.equal(invalid.status,400);assert.match(invalid.data.error,/option/i)
 assert.deepEqual(await get(second),beforeInvalid,'a rejected typed value changes no ticket state')
 const [customer,form]=await Promise.all([f.portal(),app.ok(`/api/forms/projects/${w.projectId}/forms`,{token:w.tokens.owner,body:{title:'Request a replacement',enabled:true,fields:[{fieldId:reason.id,required:true}]}}).then(result=>result.data)])
 const publicForm=(await app.ok(`/api/forms/${w.projectId}/${form.id}`,customer)).data
 assert.equal(publicForm.verified,true);assert.equal(publicForm.fields.find(item=>item.id===reason.id).type,'dropdown')
 const submit=(localId,value)=>app.ok(`/api/forms/${w.projectId}/${form.id}/submissions`,{...customer,body:{localId,subject:'Replacement '+localId,message:'Please replace my order.',fields:{[reason.id]:value}}})
 const [submitted,differentAnswer]=await Promise.all([submit('damaged-order','damaged'),submit('wrong-size-order','wrong_size')])
 const formTicket=submitted.ticket.id,otherForm=differentAnswer.ticket.id
 assert.equal((await get(formTicket)).fields[reason.id],'damaged');assert.equal((await get(formTicket)).channel,'form')
 assert.equal((await get(otherForm)).fields[reason.id],'wrong_size')
 await patch(otherForm,{status_id:'on_hold'})

 const filters=[{field:'priority',operator:'eq',value:'high'}],view=await ok('/ticket-views',{name:'Replacement queue',visibility:'shared',filters,sort:[]})
 const reloadedView=await ok(`/ticket-views/${view.id}`,undefined,'operator')
 assert.deepEqual(reloadedView.filters,filters);assert.equal(reloadedView.visibility,'shared')
 assert.ok((await ok('/ticket-views',undefined,'operator')).some(item=>item.id===view.id))
 assert.deepEqual(ids(await ok(`/conversations?saved_view=${view.id}`,undefined,'operator')),[id])
 assert.ok((await ok('/conversations?search='+encodeURIComponent('TO-48200'))).some(ticket=>ticket.id===id))

 await app.ok(`/api/conversations/${foreignTicket.id}/messages`,{token:foreignVisitor.token,body:{localId:'foreign-order',content:'Private foreign replacement evidence',expectedRevision:1}})
 const foreignGet=async()=>(await app.ok(`/api/dashboard/projects/${foreign.projectId}/conversations/${foreignTicket.id}/ticket`,{token:foreign.tokens.owner})).data
 const messages=(ticket,token=visitor.token)=>app.ok(`/api/conversations/${ticket}/messages`,{token}).then(result=>result.messages)
 const [foreignBefore,foreignMessages,foreignAudit]=await Promise.all([foreignGet(),messages(foreignTicket.id,foreignVisitor.token),securityLog(app,foreign)])
 assert.equal((await call(`/conversations/${foreignTicket.id}/ticket`)).status,404)
 const queueTag=await ok(`/conversations/${id}/tags`,{name:'Replacement expedited'})
 // Leave the new tag unapplied so preview and commit prove its admission.
 await app.ok(`/api/dashboard/projects/${w.projectId}/conversations/${id}/tags/${queueTag.id}`,{token:w.tokens.owner,method:'DELETE'})
 const [selected,transcripts]=await Promise.all([Promise.all([id,formTicket,second].map(get)),Promise.all([id,second,formTicket].map(ticket=>messages(ticket)))])
 const batch={tickets:[...selected.map(ticket=>({id:ticket.id,expected_version:ticket.ticket_version})),{id:foreignTicket.id,expected_version:foreignBefore.ticket_version}],changes:{assigned_to:w.users.owner,add_tags:[queueTag.id],remove_tags:[tag.id],priority:'urgent',status_id:'on_hold'}}
 const preview=await ok('/tickets/bulk/preview',batch)
 resultsFor(preview,batch.tickets,['ready','ready','ready','forbidden']);assert.deepEqual(preview.counts,{ready:3,forbidden:1})
 for(const row of preview.results.filter(row=>row.status==='ready')){
  assert.equal(row.expected_version,batch.tickets.find(ticket=>ticket.id===row.id).expected_version)
  assert.equal(row.changes.priority,'urgent');assert.equal(row.changes.status_id,'on_hold');assert.equal(row.changes.agent_id,w.users.owner)
  assert.deepEqual(row.changes.tags_add,[queueTag.id]);assert.deepEqual(row.changes.tags_remove,[tag.id])
 }
 assert.deepEqual(await Promise.all([id,formTicket,second].map(get)),selected,'preview changes no selected ticket')
 await bulkAudit(f,preview,'preview')
 await patch(second,{subject:'Changed while preview was open'})
 const staleBefore=await get(second),mixedPreview=await ok('/tickets/bulk/preview',batch)
 resultsFor(mixedPreview,batch.tickets,['ready','ready','stale','forbidden']);assert.deepEqual(mixedPreview.counts,{ready:2,stale:1,forbidden:1})
 await bulkAudit(f,mixedPreview,'preview')
 const bulk=await ok('/tickets/bulk/apply',batch)
 resultsFor(bulk,batch.tickets,['applied','applied','stale','forbidden']);assert.deepEqual(bulk.counts,{applied:2,stale:1,forbidden:1})
 await app.configure({})
 for(const ticketId of [id,formTicket]){
  const ticket=await get(ticketId),result=bulk.results.find(row=>row.id===ticketId)
  assert.equal(result.committed,true);assert.equal(result.ticket_version,ticket.ticket_version)
  assert.equal(ticket.assigned_to,w.users.owner);assert.equal(ticket.priority,'urgent');assert.equal(ticket.status_id,'on_hold');assert.equal(ticket.status_category,'on_hold')
  assert.ok(ticket.tags.some(item=>item.id===queueTag.id));assert.ok(!ticket.tags.some(item=>item.id===tag.id))
  assert.deepEqual(ticket.fields,selected.find(item=>item.id===ticketId).fields,'bulk metadata preserves customer and private field values')
 }
 assert.deepEqual(await get(second),staleBefore,'the stale refusal preserves the intervening edit and all other ticket state')
 assert.deepEqual(await foreignGet(),foreignBefore,'foreign ticket fields, version and history remain unchanged')
 assert.deepEqual(await messages(foreignTicket.id,foreignVisitor.token),foreignMessages)
 assert.deepEqual(await securityLog(app,foreign),foreignAudit,'the foreign workspace has no new mutation audit')
 assert.deepEqual(await ok(`/ticket-views/${view.id}`),{...reloadedView},'the saved priority view survives restart')
 assert.deepEqual(await ok(`/conversations?saved_view=${view.id}`),[],'reloaded priority membership follows the committed edits')
 await bulkAudit(f,bulk,'apply')

 assert.deepEqual(await Promise.all([id,second,formTicket].map(ticket=>messages(ticket))),transcripts,'metadata bulk actions publish no customer replies')
 const beforePublish=await Promise.all([id,second,formTicket].map(get))
 const publish=await call('/tickets/bulk/apply',{...batch,changes:{priority:'high',content:'Publish an unreviewed replacement reply'}})
 assert.equal(publish.status,400,'bulk metadata changes cannot accept reply publishing')
 assert.deepEqual(await Promise.all([id,second,formTicket].map(get)),beforePublish,'a refused publishing request has no partial metadata effect')
 const bulkMacro=await ok('/macros',{title:'Replacement queue update',content:'Reference {{ticket.id}}',actions:{reply_type:'public',status_id:pending.id,priority:'urgent',fields:{[field.id]:'RMA-BULK',[reason.id]:'damaged'}},scope:{visibility:'shared',roles:['owner','operator'],groups:[],brands:[w.projectId]}})
 const macroTickets=await Promise.all([id,second].map(get)),macroSelection=[...macroTickets.map(ticket=>({id:ticket.id,expected_version:ticket.ticket_version})),{id:foreignTicket.id,expected_version:foreignBefore.ticket_version}]
 const macroInput={version:bulkMacro.version,command_id:'replacement-batch',tickets:macroSelection}
 const macroPreview=await ok(`/macros/${bulkMacro.id}/preview`,macroInput)
 resultsFor(macroPreview,macroSelection,['ready','ready','forbidden'])
 for(const row of macroPreview.results.filter(row=>row.status==='ready')){assert.equal(row.draft.reply_type,'public');assert.equal(row.draft.content,`Reference ${row.id}`);assert.deepEqual(row.draft.unresolved,[])}
 assert.deepEqual(await Promise.all([id,second].map(get)),macroTickets,'bulk macro preview changes no ticket')
 const macroBatch=await ok(`/macros/${bulkMacro.id}/apply`,macroInput)
 resultsFor(macroBatch,macroSelection,['applied','applied','forbidden'])
 await app.configure({})
 for(const ticketId of [id,second]){
  const ticket=await get(ticketId),result=macroBatch.results.find(row=>row.id===ticketId),draft=await ok(`/conversations/${ticketId}/macro-draft`)
  assert.equal(result.committed,true);assert.equal(ticket.priority,'urgent');assert.equal(ticket.fields[field.id],'RMA-BULK');assert.equal(ticket.fields[reason.id],'damaged')
  assert.equal(ticket.status_id,pending.id);assert.equal(ticket.status_category,'pending')
  assert.equal(draft.usage_id,result.usage_id);assert.equal(draft.content,result.draft.content);assert.equal(draft.reply_type,'public');assert.deepEqual(draft.unresolved,[])
 }
 assert.deepEqual(await Promise.all([id,second,formTicket].map(ticket=>messages(ticket))),transcripts,'preview, bulk refusal and applied public macros publish no customer replies')
 assert.equal(transcripts[1].length,1,'the second request still has only its customer message')
 const macroAudit=(await securityLog(app,w)).filter(event=>event.action==='macro.applied'&&event.detail.macro_id===bulkMacro.id)
 assert.deepEqual(macroAudit.map(event=>event.target_id).sort(),[id,second].sort(),'each permitted macro application has its own audit and the foreign ticket has none')
 for(const event of macroAudit){assert.equal(event.actor_id,w.users.owner);assert.equal(event.outcome,'succeeded');assert.equal(event.detail.usage_id,macroBatch.results.find(row=>row.id===event.target_id).usage_id)}
 assert.deepEqual(await foreignGet(),foreignBefore);assert.deepEqual(await messages(foreignTicket.id,foreignVisitor.token),foreignMessages);assert.deepEqual(await securityLog(app,foreign),foreignAudit)

 const lifecycle=[{field:'status_id',operator:'eq',value:'on_hold'},{field:'status_category',operator:'eq',value:'on_hold'}],answer={field:`custom:${reason.id}`,operator:'eq',value:'damaged'}
 const query=filters=>ok('/conversations?filters='+encodeURIComponent(JSON.stringify(filters)),undefined,'operator')
 assert.deepEqual(ids(await query(lifecycle)),[formTicket,otherForm].sort(),'lifecycle filtering excludes pending macro tickets')
 assert.deepEqual(ids(await query([answer])),[id,second,formTicket].sort(),'the saved customer answer filters alongside operator-entered values')
 const formView=await ok('/ticket-views',{name:'Damaged replacements on hold',visibility:'shared',filters:[...lifecycle,answer],sort:[{field:'priority',direction:'desc'}]})
 const saved=await ok(`/ticket-views/${formView.id}`,undefined,'operator')
 assert.deepEqual(saved.filters,[...lifecycle,answer]);assert.deepEqual(saved.sort,[{field:'priority',direction:'desc'}])
 assert.deepEqual(ids(await ok(`/conversations?saved_view=${formView.id}`,undefined,'operator')),[formTicket],'the combined view admits the matching customer form and excludes both one-predicate near misses')
 return second
}
