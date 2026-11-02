import assert from 'node:assert/strict'

const expect=(actual,expected,label)=>{assert.deepEqual(actual,expected,label)}
const empty={groupIds:[],includeUngrouped:false}
const probe=(point,door,output)=>console.log(`PROBE ACCESS-001 ${point}: ${door} -> ${JSON.stringify(output)}`)

async function fixture(app,key,model='gpt-5.6-luna'){
 const w=await app.seedWorkspace(key),p=w.projectId,P=`/api/management/projects/${p}`,A=`/api/ai-support/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`
 const role=(await app.ok(P+'/roles',{token:w.tokens.owner,body:{name:'Synthetic scoped support',base:'operator',permissions:['conversations.reply','conversations.manage','reports.view']}})).data.id
 await app.ok(`${P}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role}})
 const groups=[key+'-1',key+'-2'],tickets=[key+'-3',key+'-4'],contact=key+'-5',ai=key+'-6'
 for(const id of groups)await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(id,p,id).run()
 await app.db.prepare('INSERT INTO contacts(id,project_id,email,created_at) VALUES(?,?,?,1)').bind(contact,p,key+'@example.test').run()
 await app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES(?,?,'Synthetic support','support','Use evidence',?,1)").bind(ai,p,model).run()
 await app.db.prepare('INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,?,1)').bind(p,JSON.stringify({default_visitor_ai_id:ai})).run()
 for(let i=0;i<2;i++){
  await app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,subject,created_at,updated_at) VALUES(?,?,?,?,?,1,1)').bind(tickets[i],p,contact,groups[i],'Synthetic hidden subject '+i).run()
  await app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,'synthetic-fixture',?,'contact',?,1,1)").bind(tickets[i]+'-message',p,tickets[i],contact,'Synthetic private follow up tomorrow '+i).run()
  await app.db.prepare('UPDATE conversations SET revision=1,last_message_id=? WHERE id=?').bind(tickets[i]+'-message',tickets[i]).run()
  await app.db.prepare('INSERT INTO conversation_ai(conversation_id,ai_id) VALUES(?,?)').bind(tickets[i],ai).run()
 }
 const scope=async(value,id=role)=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(value===null?null:JSON.stringify(value),p,id).run()
 for(const group of groups)for(const user of [w.users.owner,w.users.operator])await app.db.prepare('INSERT INTO ticket_group_members(project_id,group_id,user_id) VALUES(?,?,?)').bind(p,group,user).run()
 const selected={groupIds:[groups[0]],includeUngrouped:false}
 await scope(selected)
 const foreign=await app.seedWorkspace(key+'-9')
 return {w,p,P,A,D,role,groups,tickets,scope,selected,foreign,contact,ai}
}

/** One stored selection governs admission, committing writes and generation-id reads. */
export async function aiTicketScopeAssertions(a){
 const {app}=a,f=await fixture(app,'synthetic-hh-100'),{w,p,P,A,D,tickets:[visible,hidden],scope,selected,foreign}=f
 const call=(path,body,token=w.tokens.operator,headers)=>app.call(A+path,{token,body,headers})
 const post=(id,kind,token,headers)=>call(`/conversations/${id}/${kind}`,{expectedRevision:1},token,headers)
 const count=async()=>(await app.first('SELECT count(*) n FROM ai_generations WHERE project_id=?',p)).n
 const revoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE project_id='${p}' AND id='${f.role}'`
 // P1 is deliberately first: authority changes after both read checks.
 const initial=await count(),calls=a.providerCalls();let visibleGeneration
 for(const kind of ['generations','suggestions']){
  await scope(selected)
  const race=await post(visible,kind,w.tokens.operator,{'x-test-statement':'INSERT OR IGNORE INTO ai_generations','x-test-before-statement':revoke})
  probe('P1',`POST ${kind}; narrow scope before generation INSERT`,{status:race.status,rows:await count()-initial,providerCalls:a.providerCalls()-calls})
  expect(race.status,409,'commit-time scope loss refuses generation admission');expect(await count(),initial,'scope loss inserts no generation')
 }
 probe('P2','none',{reason:'No erasure or retention path changes; existing erasure journey is run separately'})
 probe('P3','none',{reason:'AI spend and automatic reply ceilings retain their existing journeys'})
 await scope(selected)
 for(const kind of ['generations','suggestions']){
  const before=await count(),denied=await post(hidden,kind)
  probe('P4',`POST hidden ${kind}`,{status:denied.status,rows:await count()-before,providerCalls:a.providerCalls()-calls})
  expect(denied.status,404,'hidden AI admission is the S1 refusal');expect(await count(),before,'hidden POST inserts nothing');expect(a.providerCalls(),calls,'denied admission never calls a provider')
  const allowed=await post(visible,kind);expect(allowed.status,202,'selected ticket AI admission remains allowed');if(kind==='generations')visibleGeneration=allowed.data.id
 }
 expect((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action='ticket.scope_denied'",p)).n>=2,true,'hidden admission refusals are audited')
 expect((await call('/generations/'+visibleGeneration)).status,200,'selected generation read retained')
 expect((await call('/generations/'+visibleGeneration+'/cancel',{})).data,{cancelled:true},'selected generation cancel retained')
 const hiddenGeneration=await post(hidden,'generations',w.tokens.owner);expect(hiddenGeneration.status,202,'owner recovery admits hidden ticket')
 const gid=hiddenGeneration.data.id,output=JSON.stringify({answer:'Synthetic hidden generation output'})
 await app.db.prepare('UPDATE ai_generations SET output_json=? WHERE id=?').bind(output,gid).run()
 const original=await app.first('SELECT state,output_json FROM ai_generations WHERE id=?',gid)
 const read=await call('/generations/'+gid),cancel=await call('/generations/'+gid+'/cancel',{})
 probe('P5','GET and cancel hidden generation',{readStatus:read.status,read:read.data,cancel:cancel.data,state:(await app.first('SELECT state FROM ai_generations WHERE id=?',gid)).state})
 expect(read.status,404,'hidden generation is unavailable');expect(read.data,{error:'Not found'},'same response as unknown generation');expect(cancel.data,{cancelled:false},'hidden work cannot be cancelled');expect(await app.first('SELECT state,output_json FROM ai_generations WHERE id=?',gid),original,'hidden output and work remain unchanged')
 await scope(empty)
 for(const kind of ['generations','suggestions'])expect((await post(visible,kind)).status,404,'empty scope refuses native AI work')
 for(const [label,token,value] of [['NULL',w.tokens.operator,null],['owner',w.tokens.owner,empty]]){
  await scope(value)
  for(const kind of ['generations','suggestions'])expect((await post(hidden,kind,token)).status,202,label+' admission retained')
  expect((await call('/generations/'+gid,undefined,token)).status,200,label+' generation read retained')
  await app.db.prepare("UPDATE ai_generations SET state='queued' WHERE id=?").bind(gid).run()
  expect((await call('/generations/'+gid+'/cancel',{},token)).data,{cancelled:true},label+' cancel retained')
 }
 await scope(selected)
 for(const kind of ['generations','suggestions'])expect((await post(hidden,kind,foreign.tokens.owner)).status,403,'other workspace cannot admit work')
 expect((await call('/generations/'+gid,undefined,foreign.tokens.owner)).status,403,'other tenant gets no generation output')
 expect((await call('/generations/'+gid+'/cancel',{},foreign.tokens.owner)).status,403,'other tenant cannot cancel')
 // Restore a live generation to populate the procedure report without provider work.
 await app.db.prepare("UPDATE ai_generations SET state='queued' WHERE id=?").bind(gid).run()
 await procedureReportScopeProbe(app,f,gid)
 probe('P9','NULL, owner, empty and other tenant across generation doors',{null:'202/200/true',owner:'202/200/true',empty:404,otherTenant:403})
}

export async function obligationTicketScopeAssertions(a){
 const f=await fixture(a.app,'synthetic-hh-300')
 await obligationScopeAssertions(a.app,f)
}

async function obligationScopeAssertions(app,f){
 const {w,p,A,tickets:[visible,hidden],scope,selected,foreign}=f
 const path=id=>`${A}/conversations/${id}/obligations`,body=id=>({messageId:id+'-message',quote:'follow up tomorrow',ownerId:w.users.owner,dueAt:Date.now()+3600000,stopCondition:'Synthetic private stop condition'})
 const created=await app.ok(path(hidden),{token:w.tokens.owner,body:body(hidden)})
 await app.ok(`${path(hidden)}/${created.id}/accept`,{token:w.tokens.owner,body:{version:1,ownerId:w.users.owner,dueAt:Date.now()+3600000}})
 await scope(selected)
 const before=await app.first('SELECT version,state FROM followup_obligations WHERE id=?',created.id)
 const responses=[]
 for(const [suffix,input] of [['',undefined],['',body(hidden)],[`/${created.id}/accept`,{version:2,ownerId:w.users.owner,dueAt:Date.now()+3600000}],[`/${created.id}/complete`,{version:2,stopConditionMet:true,confirmationMessageId:hidden+'-message',quote:'follow up tomorrow'}]]){
  const result=await app.call(path(hidden)+suffix,{token:w.tokens.operator,body:input});responses.push({door:input?'POST '+suffix:'GET',status:result.status,data:result.data});expect(result.status,404,'all hidden obligation routes share the existence guard')
 }
 probe('P8','hidden obligations GET/propose/accept/complete',responses)
 expect(await app.first('SELECT version,state FROM followup_obligations WHERE id=?',created.id),before,'hidden obligation writes do nothing')
 expect((await app.call(path(visible),{token:w.tokens.operator,body:body(visible)})).status,201,'visible obligation proposal retained')
 for(const [label,token,value] of [['NULL',w.tokens.operator,null],['owner',w.tokens.owner,empty]]){
  await scope(value);const r=await app.call(path(hidden),{token});expect(r.status,200,label+' obligations retained');expect(r.data.obligations[0].quote,'follow up tomorrow','allowed quote retained')
 }
 await scope(empty);expect((await app.call(path(visible),{token:w.tokens.operator})).status,404,'empty scope hides obligations')
 expect((await app.call(path(hidden),{token:foreign.tokens.owner})).status,403,'other tenant receives no obligation')
 await scope(selected)
}

async function procedureReportScopeProbe(app,f,gid){
 const {w,p,P,A,tickets:[,hidden],scope}=f,key='synthetic-hh-110',version='synthetic-hh-111',release='synthetic-hh-112',run='synthetic-hh-113',cycle='synthetic-hh-114'
 await app.db.prepare("INSERT INTO advice_procedure_versions(id,project_id,procedure_key,version,intent,instructions,model,config_json,created_by,created_at) VALUES(?,?,?,1,'synthetic','Synthetic private instructions','gpt-5.6-luna','{}',?,1)").bind(version,p,key,w.users.owner).run()
 await app.db.prepare("INSERT INTO training_runs(id,project_id,operator_id,request_id,kind,status,config,case_count,max_cost,max_tokens,created_at) VALUES(?,?,?,?,'evaluation','completed','{}',1,1,100,1)").bind(run,p,w.users.owner,run).run()
 await app.db.prepare("INSERT INTO procedure_releases(id,project_id,procedure_key,version_id,evaluation_id,cohort_limit,state,approved_by,created_at) VALUES(?,?,?,?,?,1,'stopped',?,1)").bind(release,p,key,version,run,w.users.owner).run()
 await app.db.prepare('INSERT INTO procedure_generation VALUES(?,?,?)').bind(gid,release,version).run()
 await app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,'synthetic-ai','ai','Synthetic private procedure answer',2,2)").bind(hidden+'-answer',p,hidden,'generation:'+gid).run()
 await app.db.prepare("INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json) VALUES(?,?,?,?,1,3,2,1,'ai','{}')").bind(cycle,p,hidden,f.contact).run()
 await scope(empty)
 const path=`${A}/procedure-reports/${key}`,report=await app.call(path,{token:w.tokens.operator})
 expect(report.status,200,'counts and identifiers retain the authorized procedure deferral')
 const fields=Object.fromEntries(Object.entries(report.data).map(([k,v])=>[k,Array.isArray(v)&&v.length&&typeof v[0]==='object'?Object.keys(v[0]).sort():typeof v]))
 probe('P8','out-of-scope populated procedure report GET fields',{status:report.status,fields})
 expect(report.data.cases[0].conversationId,hidden,'probe includes a hidden case, rather than an empty report')
 expect(/Synthetic private|Synthetic hidden/.test(JSON.stringify(report.data)),false,'procedure report returns no ticket subject, quote, draft, instructions or message text')
 const adminRole=(await app.ok(P+'/roles',{token:w.tokens.owner,body:{name:'Synthetic scoped report review',base:'admin',permissions:['settings.manage','reports.view']}})).data.id
 await scope(empty,adminRole);await app.ok(`${P}/agents/${w.users.admin}`,{token:w.tokens.owner,method:'PUT',body:{role:adminRole}})
 const review=await app.call(`${path}/cases/${cycle}/review`,{token:w.tokens.admin,body:{decision:'exclude',reason:'human-led',evidenceMessageId:hidden+'-message',quote:'follow up tomorrow'}})
 probe('P8','out-of-scope procedure review POST fields',{status:review.status,fields:Object.keys(review.data).sort()})
 expect((await app.call(path,{token:f.foreign.tokens.owner})).status,403,'other tenant gets no procedure report')
 expect((await app.call(`${path}/cases/${cycle}/review`,{token:f.foreign.tokens.owner,body:{}})).status,403,'other tenant cannot review a case')
 expect(review.status,200,'review projection remains unchanged');expect(Object.keys(review.data).sort(),['decision','id','originalEvidencePreserved'],'review returns no quoted content')
}

/** Creation and dispatch are distinct public-door outcomes; assignment grants no visibility. */
export async function notificationTicketScopeAssertions(m){
 const {app,mail}=m,f=await fixture(app,'synthetic-hh-200'),{w,p,P,D,tickets:[visible,hidden],scope,selected}=f,user=w.users.operator,address=user+'@example.test'
 await app.ok(P+'/email-settings',{token:w.tokens.owner,method:'PUT',body:{from_name:'Synthetic support',from_address:'support@example.test',inbound_address:'help@example.test',is_enabled:true}})
 await app.db.prepare('DELETE FROM conversation_ai WHERE conversation_id IN (?,?)').bind(visible,hidden).run()
 const mailCount=()=>mail.sent.filter(e=>[].concat(e.body.to).map(x=>x.email??x).includes(address)).length
 const rows=async(table,id)=>(await app.first(`SELECT count(*) n FROM ${table} WHERE project_id=? AND conversation_id=? AND user_id=?`,p,id,user)).n
 const patch=(id,assigned_to,headers)=>app.call(`${D}/${id}/ticket`,{token:w.tokens.owner,method:'PATCH',body:{assigned_to},headers})
 const settle=async(headers)=>{await app.scheduled(headers);await app.scheduled(undefined,{after:61000})}
 const revoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE project_id='${p}' AND id='${f.role}'`
 const start=mailCount()
 // Narrow after the assignment transaction, before request-time dispatch.
 const race=await patch(visible,user,{'x-test-statement':'SELECT o[.]','x-test-before-statement':revoke})
 await settle()
 const raced={status:race.status,email:mailCount()-start,inbox:await rows('notification_inbox',visible),state:(await app.first('SELECT state FROM operator_notifications WHERE project_id=? AND conversation_id=?',p,visible))?.state}
 probe('P1','assign visible ticket; narrow before assignment dispatch',raced)
 expect(raced,{status:200,email:0,inbox:0,state:'complete'},'revoked assignment notice ends complete without audience or mail')
 await scope(selected)
 const hiddenAt=mailCount(),denied=await patch(hidden,user);await settle()
 probe('P6','assign scoped-out operator',{status:denied.status,assigned:(await app.first('SELECT assigned_to FROM conversations WHERE id=?',hidden)).assigned_to,notices:await rows('operator_notifications',hidden),inbox:await rows('notification_inbox',hidden),email:mailCount()-hiddenAt})
 expect(denied.status,200,'assignment itself succeeds');expect(await rows('operator_notifications',hidden),0,'hidden assignment creates no operator notice');expect(await rows('notification_inbox',hidden),0,'hidden assignment creates no inbox audience');expect(mailCount(),hiddenAt,'hidden assignee receives no mail')
 await patch(visible,null);await scope(selected)
 const allowedAt=mailCount();expect((await patch(visible,user)).status,200);await settle()
 expect(await rows('notification_inbox',visible),1,'allowed assignment freezes inbox row');expect(mailCount()-allowedAt,1,'allowed assignee gets one email')
 // A pending durable assignment exercises the scheduled freeze path separately.
 await patch(visible,null);const pending='synthetic-hh-210'
 await app.db.prepare('UPDATE conversations SET assigned_to=? WHERE id=?').bind(user,visible).run()
 await app.db.prepare("INSERT INTO operator_notifications(id,project_id,conversation_id,user_id,kind,through_revision,created_at) VALUES(?,?,?,?,'assignment',1,1)").bind(pending,p,visible,user).run()
 await scope(empty);const freezeAt=mailCount();await settle()
 expect((await app.first('SELECT state FROM operator_notifications WHERE id=?',pending)).state,'complete','scheduled hidden assignment retires')
 expect((await app.first('SELECT count(*) n FROM notification_inbox WHERE id=?',pending)).n,0,'scheduled freeze has no hidden inbox row');expect(mailCount(),freezeAt,'scheduled freeze sends nothing')
 // Isolate the coalesced digest from the Q2 customer-update audience.
 await app.ok(P+'/notification-preferences',{token:w.tokens.operator,method:'PUT',body:{preferences:[{kind:'customer_updated',inbox:false,email:true},{kind:'group',inbox:false,email:false}]}})
 let serial=0
 const customer=async id=>{
  const current=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',id),contactToken='synthetic-hh-contact-'+(++serial)
  // Fixture session is a contact principal, just as a signed widget visitor.
  const {sha}=await import('../../journeys/kit/app.mjs')
  await app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,'contact',?,?)").bind(sha(contactToken),f.contact,p,f.contact,Date.now()+3600000).run()
  return app.call(`/api/conversations/${id}/messages`,{token:contactToken,body:{localId:'synthetic-hh-'+serial,content:'Synthetic hidden digest text '+serial,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}})
 }
 for(const unassigned of [false,true]){
  await scope(selected);if(unassigned){await patch(hidden,null);await app.db.prepare('INSERT INTO user_project_preferences(project_id,user_id,is_notified_on_unassigned_activity) VALUES(?,?,1) ON CONFLICT(project_id,user_id) DO UPDATE SET is_notified_on_unassigned_activity=1').bind(p,user).run()}
  const at=mailCount(),before=await rows('operator_notifications',hidden);expect((await customer(hidden)).status,200);await settle()
  probe('P7',unassigned?'hidden unassigned activity, opted-in operator':'hidden assigned activity',{newNotices:await rows('operator_notifications',hidden)-before,email:mailCount()-at})
  expect(await rows('operator_notifications',hidden),before,'hidden activity creates no digest notice');expect(mailCount(),at,'hidden activity sends no digest')
 }
 await scope(selected);await patch(visible,null);await patch(visible,user);await settle()
 const digestAt=mailCount();expect((await customer(visible)).status,200);await settle()
 expect(mailCount()-digestAt,1,'in-scope assignee still receives unread digest')
 expect(mail.sent.filter(e=>[].concat(e.body.to).map(x=>x.email??x).includes(address)).at(-1).body.text.includes('Synthetic hidden digest text'),true,'positive digest contains the admitted message')
 // Lose scope after the first recipient read, while the digest is being prepared.
 await scope(selected);expect((await customer(visible)).status,200)
 const raceAt=mailCount()
 await app.scheduled({'x-test-statement':'SELECT actor_role,content FROM messages','x-test-before-statement':revoke},{after:61000})
 expect(mailCount(),raceAt,'scope lost during rendering is checked again before delivery')
 expect((await app.first("SELECT count(*) n FROM operator_notifications WHERE project_id=? AND conversation_id=? AND kind='unread' AND state='pending'",p,visible)).n,0,'skipped unread notice completes')
 probe('P7','narrow scope during unread rendering',{email:mailCount()-raceAt,pending:0})
 // NULL compatibility and native owner recovery use exactly the same notification term.
 await scope(null);await patch(hidden,null);const nullAt=mailCount();await patch(hidden,user);await settle();expect(mailCount()-nullAt,1,'NULL assignment email retained')
 await app.db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,1)').bind(p,w.users.owner,f.role).run()
 await scope(empty)
 const ownerAt=mail.sent.filter(e=>[].concat(e.body.to).map(x=>x.email??x).includes(w.users.owner+'@example.test')).length
 const ownerAssignment=await app.call(`${D}/${hidden}/ticket`,{token:w.tokens.admin,method:'PATCH',body:{assigned_to:w.users.owner}});expect(ownerAssignment.status,200,'native owner assignment retained');await settle()
 expect(mail.sent.filter(e=>[].concat(e.body.to).map(x=>x.email??x).includes(w.users.owner+'@example.test')).length-ownerAt,1,'native owner recovery gets assignment email even with an empty stored scope')
 const foreignAssignment=await patch(hidden,f.foreign.users.operator);expect(foreignAssignment.status,400,'foreign assignee remains refused')
 probe('P9','notification compatibility',{null:'assignment email retained',otherTenant:'foreign recipients are refused by existing teammate journey',ownerRecovery:'shared S1 term defaults true'})
}
