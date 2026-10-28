import {macroDraftLifecycle} from '../r4/macros.mjs'
import assert from 'node:assert/strict'

// The queue composes the native macro, status and public request-form doors.
// It runs inside ticketsJourney; provider mail uses that journey's network edge.
export async function ticketQueueCapabilities(f,queueIds,tag){
 const {app,w,ok,call,get,patch,notices}=f
 const ids=queueIds.slice(7,10)
 const field=await ok('/ticket-fields',{name:'Replacement stage',type:'dropdown',options:['Awaiting label','Label sent']})
 f.fields.push(field)
 const status=await ok('/ticket-statuses',{name:'Waiting for return label',category:'pending'})
 const macro=await ok('/macros',{title:'Queue a replacement label',content:'Hello {{requester.first_name | there}}, we are arranging the label for ticket {{ticket.id}}.',actions:{reply_type:'public',priority:'urgent',status_id:status.id,group_id:f.group.id,agent_id:w.users.operator,tags_add:[tag.id],fields:{[field.id]:'Awaiting label'}},scope:{visibility:'shared',roles:['owner','operator'],groups:[],brands:[w.projectId]}})
 const before=await Promise.all(ids.slice(0,2).map(id=>get(id)))
 const tickets=before.map(ticket=>({id:ticket.id,expected_version:ticket.ticket_version}))
 const messages=async id=>(await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner})).messages
 const messagesBefore=await Promise.all(tickets.map(ticket=>messages(ticket.id)))
 const stranger=await app.ok('/api/identity/widget/session',{body:{widgetKey:f.foreign.widgetKey},headers:{Origin:f.foreign.allowedOrigin}})
 const foreign=await app.ok('/api/conversations',{token:stranger.token,body:{projectId:f.foreign.projectId}})
 const stale={id:ids[2],expected_version:(await get(ids[2])).ticket_version}
 const selection=[...tickets,stale,{id:foreign.id,expected_version:0}]
 const previewReceipt=await ok(`/macros/${macro.id}/preview`,{version:macro.version,tickets:selection})
 assert.deepEqual(previewReceipt.results.map(row=>row.status),['ready','ready','ready','forbidden'])
 const preview={...previewReceipt,results:previewReceipt.results.slice(0,2)}
 assert.deepEqual(preview.results.map(row=>row.status),['ready','ready'])
 for(const row of preview.results){
  assert.deepEqual(row.draft.unresolved,[])
  assert.equal(row.draft.content,`Hello Dana, we are arranging the label for ticket ${row.id}.`)
  for(const [name,value] of [['priority','urgent'],['status_id',status.id],['group_id',f.group.id],['agent_id',w.users.operator],[`custom.${field.id}`,'Awaiting label'],['tags_add',[tag.id]]])assert.deepEqual(row.changes.find(change=>change.field===name)?.to,value)
 }
 assert.deepEqual(await Promise.all(tickets.map(ticket=>get(ticket.id))),before,'macro preview leaves tickets unchanged')
 assert.deepEqual(await Promise.all(tickets.map(ticket=>messages(ticket.id))),messagesBefore,'macro preview sends no replies')
 for(const ticket of tickets)assert.equal((await call(`/conversations/${ticket.id}/macro-draft`)).data.data,null)
 await patch(ids[2],{subject:'Customer updated while preview was open'})
 const appliedReceipt=await ok(`/macros/${macro.id}/apply`,{version:macro.version,tickets:selection,command_id:'queue-replacement-labels'})
 assert.deepEqual(appliedReceipt.results.map(row=>row.status),['applied','applied','stale','forbidden'])
 const applied={...appliedReceipt,results:appliedReceipt.results.slice(0,2)}
 assert.deepEqual(applied.results.map(row=>row.status),['applied','applied'])
 for(const [i,row] of applied.results.entries()){
  const ticket=await get(row.id),draft=await ok(`/conversations/${row.id}/macro-draft`)
  assert.equal(ticket.priority,'urgent');assert.equal(ticket.status_id,status.id);assert.equal(ticket.status_category,'pending')
  assert.equal(ticket.group_id,f.group.id);assert.equal(ticket.assigned_to,w.users.operator)
  assert.equal(ticket.fields[field.id],'Awaiting label');assert.ok(ticket.tags.some(value=>value.id===tag.id))
  assert.ok(ticket.ticket_version>before[i].ticket_version)
  assert.equal(draft.usage_id,row.usage_id);assert.equal(draft.content,preview.results[i].draft.content);assert.deepEqual(draft.unresolved,[])
 }
 assert.deepEqual(await Promise.all(tickets.map(ticket=>messages(ticket.id))),messagesBefore,'bulk application retains replies as drafts until an operator sends them')
 const usage=await ok(`/macros/${macro.id}/usage`)
 assert.equal(usage.find(row=>row.version===macro.version&&row.actor_id===w.users.owner).uses,2)
 const audit=(await app.ok(`/api/management/projects/${w.projectId}/audit?category=data&limit=200`,{token:w.tokens.owner})).data
 for(const row of applied.results){
  const receipt=audit.find(event=>event.action==='macro.applied'&&event.target_id===row.id&&event.detail.usage_id===row.usage_id)
  assert.ok(receipt);assert.equal(receipt.outcome,'succeeded');assert.equal(receipt.detail.macro_id,macro.id)
 }

 await macroDraftLifecycle(f,macro,ids[0])

 // A verified customer submits the same typed field through the public form.
 const forms=`/api/forms/projects/${w.projectId}/forms`,publicForms=`/api/forms/${w.projectId}`
 const form=(await app.ok(forms,{token:w.tokens.owner,body:{title:'Request a replacement label',enabled:true,fields:[{fieldId:field.id,required:true}]}})).data
 const published=(await app.ok(`${publicForms}/${form.id}`)).data
 assert.ok(published.fields.some(value=>value.id===field.id))
 const email='label-requester@example.test',mailBefore=notices.length
 await app.call(`/api/portal/${w.projectId}/access/request`,{headers:{Origin:'https://app.example'},body:{email,returnTo:`/help/${w.projectId}/requests/${form.id}`},status:202})
 const mail=notices.slice(mailBefore).find(entry=>[].concat(entry.body.to).includes(email))
 assert.ok(mail,'the customer receives a sign-in link at the mail-provider edge')
 const link=new URL(mail.body.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0])
 const signedIn=await app.request(link.pathname+link.search)
 assert.equal(signedIn.status,303)
 const headers={Cookie:signedIn.headers.get('set-cookie').split(';')[0],Origin:'https://app.example'}
 const submission=await app.call(`${publicForms}/${form.id}/submissions`,{headers,body:{subject:'Please send my return label',message:'The boots arrived damaged and I need a return label.',fields:{[field.id]:'Awaiting label'},localId:'queue-label-request'},status:201})
 const formTicket=await get(submission.data.ticket.id)
 assert.equal(formTicket.channel,'form');assert.equal(formTicket.fields[field.id],'Awaiting label')
 await patch(formTicket.id,{priority:'urgent'})
 await patch(ids[2],{priority:'urgent',status_id:status.id,fields:{[field.id]:'Label sent'}})

 const priority={field:'priority',operator:'eq',value:'urgent'},statusFilter={field:'status_id',operator:'eq',value:status.id},fieldFilter={field:`custom:${field.id}`,operator:'eq',value:'Awaiting label'}
 let view=await ok('/ticket-views',{name:'Urgent replacement labels',visibility:'shared',filters:[priority,statusFilter],sort:[]})
 const reload=async expected=>{
  const saved=await ok(`/ticket-views/${view.id}`)
  assert.deepEqual(saved.filters,view.filters)
  assert.deepEqual((await ok(`/conversations?saved_view=${view.id}`)).map(ticket=>ticket.id).sort(),expected.slice().sort())
 }
 await reload(ids.slice(0,3))
 view=await ok(`/ticket-views/${view.id}`,{...view,expected_version:view.version,filters:[priority,fieldFilter]},'owner','PUT')
 await reload([...ids.slice(0,2),formTicket.id])
 view=await ok(`/ticket-views/${view.id}`,{...view,expected_version:view.version,filters:[priority,statusFilter,fieldFilter]},'owner','PUT')
 await reload(ids.slice(0,2))
 await patch(formTicket.id,{status_id:status.id})
 await reload([...ids.slice(0,2),formTicket.id])
}
