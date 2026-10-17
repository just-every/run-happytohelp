import assert from 'node:assert/strict'
import {customer,history} from '../../move-in/helpscout-fixtures.mjs'

/** Explicit export fields, imported through upload/review/apply, then real mail intake. */
export async function vendorReplies(app,{projectId,owner,gate}){
 const scout=history(901,87),scoutEmail='scout@customer.example'
 scout.conversation.status='active';scout.conversation.primaryCustomer.email=scoutEmail
 scout.conversation.reply_to='helpdesk+scout_901@example.test'
 for(const thread of scout.page._embedded.threads)for(const field of ['customer','createdBy'])if(thread[field]?.id===87)thread[field].email=scoutEmail
 const fixtures=[
  {vendor:'freshdesk',email:'fresh@customer.example',sourceId:'820',subject:'Re: Shipment [#820]',to:'helpdesk@example.test',rows:[{contact:{id:81,name:'Fresh Customer',email:'fresh@customer.example',created_at:'2024-01-01T00:00:00Z'}},{ticket:{id:820,requester_id:81,subject:'Shipment',description_text:'Historical question',status:2,priority:1,source:1,created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',conversations:[]}}]},
  {vendor:'helpscout',email:scoutEmail,sourceId:'901',subject:'Re: Shipment',to:scout.conversation.reply_to,rows:[customer(87,scoutEmail),scout.conversation,scout.page]},
  {vendor:'intercom',email:'intercom@customer.example',sourceId:'v91',subject:'Re: Shipment',to:'helpdesk+intercom-v91@example.test',schema:'2.16',rows:[{type:'contact',id:'c91',name:'Intercom Customer',email:'intercom@customer.example',created_at:1704067200},{type:'conversation',id:'v91',channel:{initial:'email'},state:'open',created_at:1704153600,updated_at:1704153600,contacts:{type:'contact.list',contacts:[{id:'c91'}]},source:{id:'s91',body:'Historical question',reply_to:'helpdesk+intercom-v91@example.test',author:{id:'c91',type:'contact'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[]}}]}
 ]
 const imports=`/api/move-in/projects/${projectId}/imports`
 for(const fixture of fixtures){
  const upload=await app.ok(imports+'?vendor='+fixture.vendor,{token:owner,raw:true,headers:{'X-Import-Filename':fixture.vendor+'.jsonl','Content-Type':'application/octet-stream',...(fixture.schema?{'X-Import-Schema':fixture.schema}:{})},body:fixture.rows.map(JSON.stringify).join('\n')})
  await app.drainJobs();const ready=(await app.ok(imports+'/'+upload.data.id,{token:owner})).data
  assert.equal(ready.state,'ready',fixture.vendor);assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan))
  await app.ok(imports+'/'+ready.id+'/apply',{token:owner,body:{fingerprint:ready.plan.fingerprint}});await app.drainJobs()
  const imported=await app.first('SELECT conversation_id FROM email_threading_keys WHERE project_id=? AND source=? AND key_value=?',projectId,fixture.vendor,fixture.vendor==='freshdesk'?'freshdesk:820':fixture.to)
  assert.ok(imported,fixture.vendor+' imported its explicit threading key')
  const reply={messageId:fixture.vendor+'-cutover',from:fixture.email,to:fixture.to,subject:fixture.subject,text:'Reply to the old notification after cutover.'}
  const received=await gate(reply);assert.equal(received.data.state,'delivered',fixture.vendor);assert.equal(received.data.conversationId,imported.conversation_id)
  const mismatch=await gate({...reply,messageId:fixture.vendor+'-wrong-customer',from:'stranger@customer.example'})
  assert.equal(mismatch.data.state,'suspended',fixture.vendor+' identity mismatch');assert.equal(mismatch.data.conversationId,null)
  const header=fixture.vendor==='freshdesk'?'X-Freshdesk-Ticket-Id':fixture.vendor==='helpscout'?'X-HS-Conversation-Id':'X-Intercom-Conversation-Id'
  const unmatched=await gate({...reply,messageId:fixture.vendor+'-unmatched',subject:fixture.vendor==='freshdesk'?'Order [#4521] never arrived':'Reply after the move',to:'helpdesk@example.test',headers:{[header]:'unmatched-old-ticket'}})
  assert.equal(unmatched.data.state,'delivered',fixture.vendor+' unmatched reply becomes a ticket');assert.notEqual(unmatched.data.conversationId,imported.conversation_id)
  assert.ok((await app.ok(`/api/dashboard/projects/${projectId}/conversations/${unmatched.data.conversationId}/ticket`,{token:owner})).data.tags.some(tag=>tag.name==='Possible pre-migration reply'))
 }
}
