import assert from 'node:assert/strict'

export async function ticketApiPrivacy(f){
 const {app,w,get,patch,ok,visitor}=f,id=f.queueIds[0]
 const issued=await app.ok(`/api/management/projects/${w.projectId}/connections/tokens`,{token:w.tokens.owner,body:{name:'Ticket operations',scopes:['conversations:read','conversations:write']}})
 const definitions=await app.ok('/api/v1/ticket-fields',{token:issued.token});assert.deepEqual(definitions.data.map(field=>field.id).sort(),[...f.fields.map(field=>field.id),f.retainedField.id].sort(),'the API lists the exact public catalogue, including the retained optional definition');assert.ok(!definitions.data.some(field=>field.id===f.privateField.id))
 assert.ok((await app.ok('/api/v1/ticket-groups',{token:issued.token})).data.some(group=>group.id===f.group.id))
 assert.ok((await app.ok('/api/v1/ticket-statuses',{token:issued.token})).data.some(status=>status.category==='pending'))
 const read=await app.ok('/api/v1/conversations/'+id,{token:issued.token})
 assert.equal(read.data.priority,'urgent');assert.equal(read.data.group_id,null);assert.equal(read.data.fields[f.fields[1].id],1)
 assert.equal(read.data.fields[f.privateField.id],undefined)
 const changed=await app.ok('/api/v1/conversations/'+id,{method:'PATCH',token:issued.token,body:{expected_version:read.data.ticket_version,priority:'high',fields:{[f.fields[2].id]:34.50}}})
 assert.equal(changed.data.fields[f.fields[2].id],34.5)
 assert.equal((await app.call('/api/v1/conversations/'+id,{method:'PATCH',token:issued.token,body:{fields:{[f.privateField.id]:'private from bearer'}}})).status,403)
 const list=await app.ok('/api/v1/conversations?priority=high',{token:issued.token});assert.ok(list.data.some(ticket=>ticket.id===id&&ticket.fields[f.fields[2].id]===34.5))
 await app.db.prepare("INSERT INTO email_settings(project_id,from_name,from_address,inbound_address,is_enabled,updated_at) VALUES(?,'Trailhead support','support@trailhead.example','returns@trailhead.example',1,?)").bind(w.projectId,Date.now()).run()
 const incoming=await app.ok('/api/integrations/email/inbound',{token:'ticket-gateway',body:{messageId:'r3-inbound-first',from:'email-customer@example.test',to:'returns@trailhead.example',subject:'Replacement hiking boots',text:'My boots arrived damaged.'}})
 const email=await app.first("SELECT c.* FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE m.content='My boots arrived damaged.'")
 assert.equal(email.channel,'email');assert.equal(email.subject,'Replacement hiking boots')
 await patch(email.id,{status_id:'pending'})
 await app.ok('/api/integrations/email/inbound',{token:'ticket-gateway',body:{messageId:'r3-inbound-reply',conversationId:email.id,from:'email-customer@example.test',to:'returns@trailhead.example',subject:'Re: Replacement hiking boots',text:'Please use the same size.'}})
 assert.equal((await get(email.id)).status_category,'open')
 // A reply to a Closed ticket is admitted into a linked follow-up for the same customer, which the operator sees; never refused.
 await ok(`/conversations/${email.id}/participants`,{email:'shipping-team@example.test'})
 await patch(email.id,{priority:'high',fields:{[f.fields[0].id]:'TO-EMAIL-49313'},status_id:'solved'})
 await patch(email.id,{status_id:'closed'})
 const oldEmail=await get(email.id)
 const followUp=await app.call('/api/integrations/email/inbound',{token:'ticket-gateway',body:{messageId:'r3-inbound-after-close',conversationId:email.id,from:'email-customer@example.test',to:'returns@trailhead.example',subject:'Re: Replacement hiking boots',text:'The replacement pair leaks too.'}})
 assert.equal(followUp.status,201,JSON.stringify(followUp.data));assert.notEqual(followUp.data.conversationId,email.id)
 const next=await get(followUp.data.conversationId)
 assert.equal(next.requester_id,email.contact_id);assert.equal(next.channel,'email');assert.equal(next.subject,'Re: Replacement hiking boots')
 assert.ok((await app.ok(`/api/conversations/${next.id}/messages`,{token:w.tokens.owner})).messages.some(message=>message.content==='The replacement pair leaks too.'))
 assert.equal((await get(email.id)).status_category,'closed')
 assert.equal(next.requester_id,oldEmail.requester_id);assert.equal(next.priority,'high');assert.deepEqual(next.fields,oldEmail.fields)
 assert.equal((await app.first('SELECT count(*) n FROM conversation_participants WHERE conversation_id=?',next.id)).n,1)
 assert.equal((await ok(`/conversations/${next.id}/workflows`)).followup_of,email.id)

 f.finishTicketErasure=async()=>{
 const before=await get(id);assert.ok(before.history.length)
 const referenced=await ok('/ticket-views',{name:'Dana requests',visibility:'personal',filters:[{field:'requester_id',operator:'eq',value:visitor.contactId}],sort:[]})
 const erased=await app.ok(`/api/management/projects/${w.projectId}/contacts/${visitor.contactId}/erase`,{token:w.tokens.owner,body:{}})
 assert.ok(erased.data.ticket_records>0)
 assert.equal((await app.first('SELECT count(*) n FROM ticket_field_values WHERE conversation_id=?',id)).n,0)
 assert.equal((await app.first('SELECT subject FROM conversations WHERE id=?',id)).subject,'')
 assert.equal(await app.first('SELECT id FROM ticket_views WHERE id=?',referenced.id),null)
 const history=await app.sql('SELECT changes_json FROM ticket_history WHERE conversation_id=?',id)
 assert.ok(history.every(row=>row.changes_json==='{"erased":true}'))
 assert.equal((await app.call('/api/v1/conversations/'+id,{token:issued.token})).status,404)
 assert.equal((await app.call('/api/v1/conversations/'+id,{token:issued.token,method:'PATCH',body:{priority:'urgent'}})).status,404)
 }

 assert.equal(incoming.duplicate,false)
}
