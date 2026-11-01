import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

/** Configuration extends the existing operator creation journey through its actual public door. */
export async function outboundConfigurationJourney(){
 const sent=[],mail=[],app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-fixture',EMAIL_FROM:'support@example.test'},outbound:async request=>{if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]});assert.equal(new URL(request.url).hostname,'api.resend.com');const copy=await request.json();mail.push(copy);if(copy.headers?.['Message-ID'])sent.push(copy);return Response.json({id:'synthetic-config-'+mail.length})}})
 try{
  const workspace=await app.seedWorkspace('configuration'),foreign=await app.seedWorkspace('configuration-other'),p=workspace.projectId,owner={token:workspace.tokens.owner},operator={token:workspace.tokens.operator},management=`/api/management/projects/${p}`,base=`/api/dashboard/projects/${p}/tickets`
  const field=async body=>(await app.ok(management+'/ticket-fields',{...owner,body})).data
  const text=await field({name:'Delivery detail',type:'text',required:true}),count=await field({name:'Parcels',type:'number'}),decimal=await field({name:'Weight',type:'decimal'}),date=await field({name:'Delivery date',type:'date'}),choice=await field({name:'Delivery reason',type:'dropdown',options:['replacement','return']}),multi=await field({name:'Handling',type:'multiselect',options:['fragile','signature']}),check=await field({name:'Confirmed',type:'checkbox'}),regex=await field({name:'Order reference',type:'regex',validation:{pattern:'^[A-Z]+$'}}),account=await field({name:'Support account',type:'account'}),secret=await field({name:'Owner detail',type:'text',read_roles:['owner'],write_roles:['owner']})
  let form=(await app.ok(`/api/forms/projects/${p}/forms`,{...owner,body:{title:'Replacement shipment',enabled:true,fields:[{fieldId:choice.id,required:true},{fieldId:text.id,required:true,condition:{fieldId:choice.id,operator:'equals',value:'replacement'}},...[count,decimal,date,multi,check,regex,account].map(f=>({fieldId:f.id}))]}})).data
  const group=(await app.ok(management+'/ticket-groups',{...owner,body:{name:'Parcel support',members:[workspace.users.admin]}})).data
  let contact=(await app.ok(management+'/contacts',{...owner,body:{name:'Synthetic Maya',email:'maya@customer.example'}})).data
  const mailbox=(await app.ok(management+'/mailboxes',{...owner,body:{provider:'forwarding',address:'help@support.example',displayName:'Parcel support'}})).data
  const command={kind:'email',localId:'configured-existing',requesterId:contact.id,mailboxId:mailbox.id,subject:'Your replacement shipment',content:'Your replacement leaves today.',formId:form.id,fields:{[choice.id]:'replacement',[text.id]:'Leave at reception',[count.id]:2,[decimal.id]:1.25,[date.id]:'2026-11-03',[multi.id]:['fragile','signature'],[check.id]:false,[regex.id]:'ORDER'},groupId:group.id,assigneeId:workspace.users.admin}
  const options=await app.ok(base+'/options',{...operator});assert.equal(options.actorId,workspace.users.operator);assert.ok(!options.fields.some(f=>f.id===secret.id));assert.equal(options.forms[0].id,form.id)
  for(const q of ['Maya','maya@customer.example'])assert.equal((await app.ok(base+'/requesters?q='+encodeURIComponent(q),operator)).data[0].id,contact.id)
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
  assert.equal((await app.request(url.pathname+url.search)).status,303)
  contact=await app.first('SELECT ct.* FROM contacts ct JOIN portal_identities identity ON identity.contact_id=ct.id AND identity.project_id=ct.project_id WHERE ct.project_id=? AND identity.email=?',p,contact.email)
  command.requesterId=contact.id
  await app.ok(management+`/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  command.fields[account.id]=company.id
  assert.deepEqual((await app.ok(base+'/options?requesterId='+contact.id,operator)).accounts,[{value:company.id,label:'Synthetic account'}])
  await refused({},account.id,422,{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`DELETE FROM contact_companies WHERE project_id='${p}' AND contact_id='${contact.id}'`})
  await app.ok(management+`/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
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
 }finally{await app.close()}
}
