import assert from 'node:assert/strict'
import {message} from './app.mjs'
import {startApp} from '../../journeys/kit/app.mjs'

/** Configuration extends the existing operator creation journey through its actual public door. */
export async function outboundConfigurationJourney(){
 const sent=[],mail=[],app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-fixture',INBOUND_EMAIL_TOKEN:'synthetic-fixture-inbound',EMAIL_FROM:'support@example.test'},outbound:async request=>{if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]});assert.equal(new URL(request.url).hostname,'api.resend.com');const copy=await request.json();mail.push(copy);if(copy.headers?.['Message-ID'])sent.push(copy);return Response.json({id:'synthetic-config-'+mail.length})}})
 try{
  const workspace=await app.seedWorkspace('synthetic-hh-1'),foreign=await app.seedWorkspace('synthetic-hh-2'),p=workspace.projectId,owner={token:workspace.tokens.owner},operator={token:workspace.tokens.operator},management=`/api/management/projects/${p}`,base=`/api/dashboard/projects/${p}/tickets`
  const field=async body=>(await app.ok(management+'/ticket-fields',{...owner,body})).data
  const text=await field({name:'Delivery detail',type:'text',required:true}),count=await field({name:'Parcels',type:'number'}),decimal=await field({name:'Weight',type:'decimal'}),date=await field({name:'Delivery date',type:'date'}),choice=await field({name:'Delivery reason',type:'dropdown',options:['replacement','return']}),multi=await field({name:'Handling',type:'multiselect',options:['fragile','signature']}),check=await field({name:'Confirmed',type:'checkbox'}),regex=await field({name:'Order reference',type:'regex',validation:{pattern:'^[A-Z]+$'}}),account=await field({name:'Support account',type:'account'}),secret=await field({name:'Owner detail',type:'text',read_roles:['owner'],write_roles:['owner']})
  let form=(await app.ok(`/api/forms/projects/${p}/forms`,{...owner,body:{title:'Replacement shipment',enabled:true,fields:[{fieldId:choice.id,required:true},{fieldId:text.id,required:true,condition:{fieldId:choice.id,operator:'equals',value:'replacement'}},...[count,decimal,date,multi,check,regex,account].map(f=>({fieldId:f.id}))]}})).data
  const group=(await app.ok(management+'/ticket-groups',{...owner,body:{name:'Parcel support',members:[workspace.users.admin]}})).data
  let contact=(await app.ok(management+'/contacts',{...owner,body:{name:'Synthetic Maya',email:'maya@customer.example'}})).data
  const mailbox=(await app.ok(management+'/mailboxes',{...owner,body:{provider:'forwarding',address:'help@support.example',displayName:'Parcel support'}})).data
  const command={kind:'email',localId:'configured-existing',requesterId:contact.id,mailboxId:mailbox.id,subject:'Your replacement shipment',content:'Your replacement leaves today.',formId:form.id,fields:{[choice.id]:'replacement',[text.id]:'Leave at reception',[count.id]:2,[decimal.id]:1.25,[date.id]:'2026-11-03',[multi.id]:['fragile','signature'],[check.id]:false,[regex.id]:'ORDER'},groupId:group.id,assigneeId:workspace.users.admin}
  const options=await app.ok(base+'/options',{...operator});assert.equal(options.actorId,workspace.users.operator);assert.ok(!options.fields.some(f=>f.id===secret.id));assert.equal(options.forms[0].id,form.id)
  await app.ok(management+`/contacts/${contact.id}`,{...owner,method:'PUT',body:{phone:'+12025550123'}})
  for(const q of ['Maya','maya@customer.example','+12025550123'])assert.equal((await app.ok(base+'/requesters?q='+encodeURIComponent(q),operator)).data[0].id,contact.id)
  const before=async()=>(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n
  const refused=async(patch,expectedField,status=422,headers)=>{const n=await before(),attempt=await app.call(base,{...operator,body:{...command,localId:crypto.randomUUID(),...patch},headers});assert.equal(attempt.status,status,JSON.stringify(attempt.data));if(expectedField)assert.equal(attempt.data.field,expectedField);assert.equal(await before(),n,'refused configuration creates no ticket');assert.equal(sent.length,0,'refusal sends nothing')}
  await refused({fields:{...command.fields,[count.id]:'2'}},count.id)
  await refused({fields:{[choice.id]:'replacement'}},text.id)
  await refused({fields:{[choice.id]:'return',[text.id]:'hidden answer'}},text.id)
  await refused({fields:{...command.fields,[secret.id]:'hidden'}},secret.id)
  await refused({formId:undefined,fields:{[secret.id]:'denied'}},secret.id)
  await refused({fields:{...command.fields,[account.id]:'foreign-account'}},account.id)
  await refused({assigneeId:foreign.users.operator},'assigneeId')
  await refused({assigneeId:workspace.users.operator},'assigneeId')
  await refused({groupId:'missing-group'},'groupId')
  await refused({fromAddress:'unauthorized@support.example'},null,409)
  const foreignForm=(await app.ok(`/api/forms/projects/${foreign.projectId}/forms`,{token:foreign.tokens.owner,body:{title:'Other brand form',enabled:true,fields:[]}})).data
  await refused({formId:foreignForm.id},'formId')
  await refused({brandId:foreign.projectId},null,400)
  assert.equal((await app.call(`/api/dashboard/projects/${foreign.projectId}/tickets`,{...operator,body:command})).status,403)
  const race=`DELETE FROM ticket_group_members WHERE project_id='${p}' AND group_id='${group.id}' AND user_id='${workspace.users.admin}'`
  await refused({},'assigneeId',422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':race})
  await app.db.prepare('INSERT INTO ticket_group_members VALUES(?,?,?)').bind(p,group.id,workspace.users.admin).run()
  await refused({},'assigneeId',422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`DELETE FROM memberships WHERE project_id='${p}' AND user_id='${workspace.users.admin}'`})
  await app.db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(p,workspace.users.admin,'admin').run()
  await app.db.prepare('INSERT INTO ticket_group_members VALUES(?,?,?)').bind(p,group.id,workspace.users.admin).run()
  const disable=`UPDATE request_forms SET enabled=0 WHERE project_id='${p}' AND id='${form.id}'`
  await refused({},'formId',422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':disable})
  await app.db.prepare('UPDATE request_forms SET enabled=1 WHERE project_id=? AND id=?').bind(p,form.id).run()
  await refused({},choice.id,422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`UPDATE ticket_fields SET write_roles_json='["owner"]' WHERE project_id='${p}' AND id='${choice.id}'`})
  await app.db.prepare('UPDATE ticket_fields SET write_roles_json=\'[]\' WHERE project_id=? AND id=?').bind(p,choice.id).run()
  const company=(await app.ok(management+'/companies',{...owner,body:{name:'Synthetic account',domains:['customer.example']}})).company
  // A matching domain or typed email gives no account authority.
  await refused({fields:{...command.fields,[account.id]:company.id}},account.id)
  await app.ok(management+`/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  await refused({fields:{...command.fields,[account.id]:company.id}},account.id)
  // Verify this actual customer mailbox through its public sign-in door; only mail delivery is faked.
  await app.call(`/api/portal/${p}/access/request`,{body:{email:contact.email},headers:{Origin:'https://app.example'},status:202})
  const delivered=mail.find(copy=>copy.text?.includes('/api/portal/')),url=new URL(delivered.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0])
  const portal=await app.request(url.pathname+url.search);assert.equal(portal.status,303)
  const customer={token:portal.headers.get('Set-Cookie').match(/h2h_portal=([^;]+)/)[1]}
  contact=await app.first('SELECT ct.* FROM contacts ct JOIN portal_identities identity ON identity.contact_id=ct.id AND identity.project_id=ct.project_id WHERE ct.project_id=? AND identity.email=?',p,contact.email)
  command.requesterId=contact.id
  await app.ok(management+`/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  command.fields[account.id]=company.id
  assert.deepEqual((await app.ok(base+'/options?requesterId='+contact.id,operator)).accounts,[{value:company.id,label:'Synthetic account'}])
  await refused({},account.id,422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`DELETE FROM contact_companies WHERE project_id='${p}' AND contact_id='${contact.id}'`})
  await app.ok(management+`/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(p,workspace.users.operator,Date.now()).run()
  await refused({},null,403)
  assert.equal((await app.call(base+'/options',operator)).status,403)
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(p,workspace.users.operator).run()
  const result=await app.ok(base,{...operator,body:command}),id=result.conversation.id
  await app.until(()=>sent.length===1,{message:'configured first email sent'})
  assert.equal(result.conversation.assigned_to,workspace.users.admin);assert.equal(result.conversation.group_id,group.id);assert.equal(result.conversation.requester_id,contact.id);assert.equal(result.conversation.submitter_id,workspace.users.operator)
  const detail=(await app.ok(`/api/dashboard/projects/${p}/conversations/${id}/ticket`,operator)).data
  assert.deepEqual(detail.fields,command.fields);assert.deepEqual(detail.history.find(h=>h.changes.form).changes.form,{from:null,to:form.title,formId:form.id,version:form.updatedAt})
  assert.equal((await app.ok(base,{...operator,body:command})).conversation.id,id);assert.equal(sent.length,1)
  assert.equal((await app.call(base,{...operator,body:{...command,assigneeId:null}})).status,409)
  const callCommand={kind:'call',localId:'configured-inline-call',requesterEmail:'new@customer.example',requesterName:'Synthetic Rosa',subject:'Collection call',content:'Confirmed collection privately.',formId:form.id,fields:{[choice.id]:'return',[count.id]:1},groupId:null,assigneeId:null}
  const call=await app.ok(base,{...operator,body:callCommand});assert.equal(call.conversation.assigned_to,null);assert.equal(call.conversation.group_id,null);assert.notEqual(call.conversation.contact_id,contact.id);assert.equal(call.conversation.requester_id,call.conversation.contact_id);assert.equal(call.conversation.submitter_id,workspace.users.operator);assert.equal(call.message,undefined);assert.equal(sent.length,1)
  assert.equal((await app.ok(base,{...operator,body:callCommand})).note.id,call.note.id)
  const storedCall=(await app.ok(`/api/dashboard/projects/${p}/conversations/${call.conversation.id}/ticket`,operator)).data
  assert.deepEqual(storedCall.fields,callCommand.fields)
  assert.equal(storedCall.history.find(h=>h.changes.form).changes.form.formId,form.id)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',call.conversation.id)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox WHERE conversation_id=?',call.conversation.id)).n,0)
  // A previously admitted command has the old exact normalized identity, with no new optional keys.
  const legacy={kind:'call',localId:'previously-admitted',requesterId:contact.id,subject:'Legacy call',content:'Original private note.'},old=await app.ok(base,{...operator,body:legacy})
  const normalized={kind:'call',localId:legacy.localId,requesterId:contact.id,requesterEmail:null,requesterName:'',subject:legacy.subject,content:legacy.content,mailboxId:null,fromAddress:null,cc:[],bcc:[]}
  const {createHash}=await import('node:crypto');await app.db.prepare('UPDATE operator_ticket_commands SET intent_hash=? WHERE project_id=? AND local_id=?').bind(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),p,legacy.localId).run()
  const unassigned=await app.ok(base,{...operator,body:{...command,localId:'configured-unassigned-email',groupId:null,assigneeId:null}})
  assert.equal(unassigned.conversation.assigned_to,null,'the first public comment preserves deliberately unassigned')
  assert.equal(unassigned.conversation.group_id,null)
  await app.until(()=>sent.length===2,{message:'unassigned configured email'})
  // Removing a form never changes an admitted command's replay or historical provenance.
  await app.ok(`/api/forms/projects/${p}/forms/${form.id}`,{...owner,method:'PATCH',body:{updatedAt:form.updatedAt,enabled:false}})
  assert.equal((await app.ok(base,{...operator,body:command})).conversation.id,id)
  assert.equal((await app.ok(base,{...operator,body:legacy})).conversation.id,old.conversation.id)
  // Stop just after the reservation transaction. The real stored ticket already
  // has its form, typed answers and deliberate assignment before any message exists.
  const interrupted={...command,localId:'synthetic-hh-reservation'}
  // Re-enable the same form for this separate command.
  await app.ok(`/api/forms/projects/${p}/forms/${form.id}`,{...owner,method:'PATCH',body:{updatedAt:(await app.first('SELECT updated_at FROM request_forms WHERE id=?',form.id)).updated_at,enabled:true}})
  assert.equal((await app.call(base,{...operator,body:interrupted,headers:{'x-test-fault':'db-interrupt','x-test-statement':'INSERT OR IGNORE INTO conversations'}})).status,500)
  const reserved=await app.first('SELECT c.* FROM conversations c JOIN operator_ticket_commands cmd ON cmd.conversation_id=c.id WHERE cmd.project_id=? AND cmd.local_id=?',p,interrupted.localId)
  assert.equal(reserved.assigned_to,workspace.users.admin);assert.equal(reserved.group_id,group.id)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',reserved.id)).n,0)
  assert.deepEqual((await app.ok(`/api/dashboard/projects/${p}/conversations/${reserved.id}/ticket`,operator)).data.fields,command.fields)
  assert.equal(sent.length,2)
  const resumed=await app.ok(base,{...operator,body:interrupted});assert.equal(resumed.conversation.id,reserved.id)
  await app.until(()=>sent.length===3,{message:'one recovered configured email'})
  assert.equal((await app.ok(base,{...operator,body:interrupted})).conversation.id,reserved.id);assert.equal(sent.length,3)
  // The new email choice shares the real reservation, note store and later Send
  // door. No public-message or mail work may exist until that explicit reply.
  assert.equal((await app.ok(base,{...operator,body:{...command,firstComment:'public'}})).conversation.id,id,'explicit public preserves the old admitted command identity')
  const privateCommand={...command,localId:'configured-private-email',firstComment:'internal',content:'Private parcel investigation. Do not disclose the warehouse code.'}
  await app.drainJobs()
  const beforePrivate={tickets:await before(),mail:mail.length}
  for(const patch of [{firstComment:'unknown'},{firstComment:null},{firstComment:['internal']},{cc:['copy@customer.example']},{bcc:['hidden@customer.example']}])assert.equal((await app.call(base,{...operator,body:{...privateCommand,...patch}})).status,400)
  assert.equal((await app.call(base+'/notices/preview',{...operator,body:{...privateCommand,requesterId:undefined,requesters:['a@customer.example','b@customer.example']}})).status,400,'private-first choice is single-ticket only')
  assert.equal((await app.call(base,{...operator,body:{...callCommand,firstComment:'internal'}})).status,400,'call input semantics are unchanged')
  assert.equal((await app.call(`/api/dashboard/projects/${foreign.projectId}/tickets`,{...operator,body:privateCommand})).status,403)
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(p,workspace.users.operator,Date.now()).run()
  assert.equal((await app.call(base,{...operator,body:privateCommand})).status,403)
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(p,workspace.users.operator).run()
  assert.equal(await before(),beforePrivate.tickets,'invalid/unauthorized private creation makes no ticket')
  // Lose the response after the guarded note insert actually committed, then
  // restart the same native store. Replaying must recover that exact one note.
  assert.equal((await app.call(base,{...operator,body:privateCommand,headers:{'x-test-fault':'db-interrupt','x-test-statement':'INSERT OR IGNORE INTO conversation_notes'}})).status,500)
  await app.configure({})
  const privateTicket=await app.ok(base,{...operator,body:privateCommand}),privateId=privateTicket.conversation.id,privatePath=`/api/dashboard/projects/${p}/conversations/${privateId}`,messagesPath=`/api/conversations/${privateId}/messages`
  assert.equal(privateTicket.duplicate,true);assert.equal(privateTicket.message,undefined);assert.equal(privateTicket.note.content,privateCommand.content);assert.equal(privateTicket.note.user_id,workspace.users.operator)
  assert.equal(privateTicket.conversation.channel,'email');assert.equal(privateTicket.conversation.mailbox_id,mailbox.id);assert.equal(privateTicket.conversation.requester_id,contact.id);assert.equal(privateTicket.conversation.submitter_id,workspace.users.operator)
  assert.equal(privateTicket.conversation.group_id,group.id);assert.equal(privateTicket.conversation.assigned_to,workspace.users.admin)
  assert.deepEqual((await app.ok(privatePath+'/ticket',operator)).data.fields,command.fields)
  assert.equal((await app.ok(privatePath,operator)).data.id,privateId)
  assert.ok((await app.ok(`/api/dashboard/projects/${p}/conversations`,operator)).data.some(ticket=>ticket.id===privateId),'note-only email appears in the native inbox')
  const privateBucket=(await app.ok(privatePath+`/buckets/${privateId}`,operator)).data
  assert.deepEqual(privateBucket.messages,[]);assert.equal(privateBucket.events.filter(event=>event.type==='INTERNAL_NOTE'&&event.content===privateCommand.content).length,1)
  assert.equal((await app.ok(messagesPath,customer)).messages.length,0,'customer transcript excludes the initial private note')
  const duplicateNotes=await Promise.all([1,2].map(()=>app.ok(base,{...operator,body:privateCommand})))
  assert.ok(duplicateNotes.every(result=>result.conversation.id===privateId&&result.note.id===privateTicket.note.id))
  for(const firstComment of ['public',undefined])assert.equal((await app.call(base,{...operator,body:{...privateCommand,firstComment}})).status,409,'reusing private command as public must never send')
  assert.equal((await app.call(base,{...operator,body:{...privateCommand,content:'Changed note'}})).status,409)
  for(const table of ['messages','conversation_outbox','email_message_options'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE conversation_id=?`,privateId)).n,0,table+' is empty before Send')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',privateId)).n,1)
  await app.scheduled();await app.drainJobs();assert.equal(mail.length,beforePrivate.mail,'private creation/replay/restart/scheduled recovery never contacts the customer')
  // Route and commit-time current authority still fence the new private path.
  const role=(await app.ok(management+'/roles',{...owner,body:{name:'Private ticket scope',base:'operator',permissions:['conversations.reply']}})).data
  await app.db.prepare('INSERT INTO member_roles VALUES(?,?,?,?)').bind(p,workspace.users.operator,role.id,Date.now()).run()
  await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=?').bind(JSON.stringify({groupIds:[],includeUngrouped:true}),role.id).run()
  assert.equal((await app.call(base,{...operator,body:privateCommand})).status,403,'destination outside selected scope refuses private replay')
  assert.equal((await app.call(privatePath,operator)).status,404,'current ticket scope hides private readback')
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(p,workspace.users.operator).run()
  const raced={...privateCommand,localId:'private-note-current-role'}
  assert.equal((await app.call(base,{...operator,body:raced,headers:{'x-test-statement':'INSERT OR IGNORE INTO conversation_notes','x-test-before-statement':`INSERT INTO member_roles VALUES('${p}','${workspace.users.operator}','collaborator',1)`}})).status,409)
  const raceTicket=await app.first('SELECT conversation_id FROM operator_ticket_commands WHERE project_id=? AND local_id=?',p,raced.localId)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',raceTicket.conversation_id)).n,0,'current-role loss before note commit admits no note')
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(p,workspace.users.operator).run()
  assert.equal((await app.ok(base,{...operator,body:raced})).note.content,raced.content,'same reserved command resumes after authority is restored')
  assert.equal((await app.call(privatePath,{token:foreign.tokens.owner})).status,404)
  // The ordinary explicit public reply is the first and only public content.
  const head=await app.ok(messagesPath,operator),publicReply='Your parcel is ready for collection.',sendCommand={localId:'private-email-later-human-send',content:publicReply,mailboxId:mailbox.id,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId}
  const reply=await app.ok(messagesPath,{...operator,body:sendCommand});assert.equal(reply.accepted,true)
  await app.until(()=>sent.some(copy=>copy.text?.includes(publicReply)),{message:'later explicit public reply sent'})
  const copy=sent.find(copy=>copy.text?.includes(publicReply));assert.ok(copy.headers['Message-ID']);assert.ok(copy.reply_to);assert.ok(!JSON.stringify(copy).includes(privateCommand.content))
  assert.deepEqual((await app.ok(messagesPath,customer)).messages.map(message=>message.content),[publicReply])
  await app.ok(messagesPath,{...operator,body:sendCommand});await app.drainJobs();assert.equal(sent.filter(copy=>copy.text?.includes(publicReply)).length,1,'explicit Send replay sends once')
  const inbound=message({id:'private-email-customer-reply@customer.example',from:contact.email,to:copy.reply_to,subject:copy.subject,headers:`In-Reply-To: ${copy.headers['Message-ID']}\r\nReferences: ${copy.headers['Message-ID']}\r\n`,text:'Thank you for the update.'})
  assert.equal((await app.email(inbound,{from:contact.email,to:copy.reply_to,direct:true})).rejected,undefined)
  await app.drainJobs()
  const customerMessages=(await app.ok(messagesPath,customer)).messages
  assert.equal(customerMessages.length,2);assert.equal(customerMessages[1].content,'Thank you for the update.');assert.ok(customerMessages.every(message=>message.conversation_id===privateId));assert.ok(!JSON.stringify(customerMessages).includes(privateCommand.content))
  console.log('PROBE OUTBOUND-001-NOTE N1/N2/N3/N4: private email + restart/replay -> 1 note, 0 public messages/outbox/email before human Send; 1 public reply + 1 threaded customer reply; public default/call/configuration retained; no migrations')
  // Erasure uses the existing native contact door and removes both answers and
  // historical values, including reservation-time form provenance.
  await app.ok(management+`/contacts/${contact.id}/erase`,{...owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM ticket_field_values WHERE conversation_id=?',id)).n,0)
  assert.ok((await app.sql('SELECT changes_json FROM ticket_history WHERE conversation_id=?',id)).every(row=>row.changes_json==='{"erased":true}'))
 }finally{await app.close()}
}
