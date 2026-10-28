import {socketClient} from '../widget/sockets.mjs'
import assert from 'node:assert/strict'
import {sha} from '../../journeys/kit/app.mjs'

/** Public read/write regressions for the internal scope foundation. Policy setup is
 * a storage fixture: role-management intentionally does not offer narrowing yet. */
export async function nativeTicketScopeAssertions(app){
 const w=await app.seedWorkspace('ticket-scope'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`
 const call=(path,body,method,token=w.tokens.operator)=>app.call(path,{body,method,token})
 const role=await call(`${P}/roles`,{name:'Scoped native agent',base:'operator',permissions:['conversations.manage','conversations.reply','conversations.notes','conversations.follow','contacts.manage']},'POST',w.tokens.owner)
 assert.equal(role.status,201)
 const roleId=role.data.data.id
 const unavailable=await call(`${P}/roles/${roleId}`,{name:'Scoped native agent',base:'operator',permissions:[],ticketScope:{groupIds:[],includeUngrouped:false}},'PUT',w.tokens.owner)
 assert.equal(unavailable.status,409,'the unfinished restriction mode must not be exposed or silently ignored')
 assert.equal((await app.first('SELECT ticket_scope_json FROM project_roles WHERE id=?',roleId)).ticket_scope_json,null)
 for(const group of ['scope-a','scope-b','scope-denied'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,p,group).run()
 await app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('scope-customer',?,'Morgan Customer','morgan@example.test',1)").bind(p).run()
 const tickets=[['scope-allowed-a','scope-a'],['scope-allowed-b','scope-b'],['scope-ungrouped',null],...Array.from({length:35},(_,i)=>['scope-denied-'+i,'scope-denied'])]
 for(const [id,group] of tickets)await app.db.batch([
  app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,revision,last_message_id,created_at,updated_at) VALUES(?,?,?, ?,1,?,1,?)').bind(id,p,'scope-customer',group,id+'-message',id.includes('denied')?1000:1),
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,'scope-customer','contact',?,1,1)").bind(id+'-message',p,id,id+'-local','Scope marker '+id),
  app.db.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) VALUES(?,?,?,1)').bind(p,id,id+'-message'),
 ])
 assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:roleId},'PUT',w.tokens.owner)).status,200)
 // Accepted native membership plus a stored role selection: routing membership,
 // assignment, following and customer association never supply visibility.
 await app.db.prepare('INSERT INTO ticket_group_members(project_id,group_id,user_id) VALUES(?,?,?)').bind(p,'scope-denied',w.users.operator).run()
 await app.db.prepare("UPDATE conversations SET assigned_to=? WHERE id='scope-denied-0'").bind(w.users.operator).run()
 await app.db.prepare("INSERT INTO conversation_followers(conversation_id,user_id,created_at) VALUES('scope-denied-0',?,1)").bind(w.users.operator).run()
 const select=async(groupIds,includeUngrouped)=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=?,updated_at=updated_at+1 WHERE project_id=? AND id=?').bind(JSON.stringify({groupIds,includeUngrouped}),p,roleId).run()
 await select(['scope-a','scope-b'],false)

 // Report/export authority remains independent; a scoped admin can export only the current cohort.
 const reportRole=await call(`${P}/roles`,{name:'Scoped report reviewer',base:'admin',permissions:['reports.view','data.export']},'POST',w.tokens.owner)
 assert.equal(reportRole.status,201)
 await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=?').bind(JSON.stringify({groupIds:['scope-a','scope-b'],includeUngrouped:false}),reportRole.data.data.id).run()
 assert.equal((await call(`${P}/agents/${w.users.admin}`,{role:reportRole.data.data.id},'PUT',w.tokens.owner)).status,200)
 const reportPath=`/api/dashboard/projects/${p}/reports?period=custom&start=1970-01-01&end=1970-01-02`
 const report=await call(reportPath,undefined,undefined,w.tokens.admin);assert.equal(report.status,200);assert.equal(report.data.volume,2,'report aggregation filters before reducing')
 const team=await call(`/api/dashboard/projects/${p}/reports/team?period=custom&start=1970-01-01&end=1970-01-02`,undefined,undefined,w.tokens.admin);assert.equal(team.status,200);assert.equal(team.data.denominators.cohort,2,'team report uses the same current scope')
 const exported=await call(reportPath+'&format=conversations.csv',undefined,undefined,w.tokens.admin);assert.equal(exported.status,200);assert.match(exported.data,/scope-allowed-a/);assert.doesNotMatch(exported.data,/scope-denied|scope-ungrouped/)
 const transcript=await call(reportPath+'&format=transcripts.json',undefined,undefined,w.tokens.admin);assert.equal(transcript.status,200);assert.deepEqual(transcript.data.conversations.map(c=>c.id),['scope-allowed-a','scope-allowed-b']);assert.match(JSON.stringify(transcript.data),/Scope marker scope-allowed-a/);assert.doesNotMatch(JSON.stringify(transcript.data),/scope-denied|scope-ungrouped/)
 for(const ticket of ['scope-denied-0','scope-ungrouped'])assert.equal((await call(`${D}/${ticket}/timer`)).status,404,'timer reads refuse hidden tickets')
 const company=await call(`${P}/companies`,{name:'Scope customer company'},'POST',w.tokens.owner);assert.equal(company.status,201)
 assert.equal((await call(`${P}/companies/${company.data.company.id}/members/scope-customer`,{},'PUT',w.tokens.owner)).status,200)
 const history=await call(`${P}/companies/${company.data.company.id}`);assert.equal(history.status,200);assert.deepEqual(history.data.tickets.map(t=>t.id).sort(),['scope-allowed-a','scope-allowed-b'],'company association grants no ticket visibility')


 // Persisted connected credentials retain their own exact target/scope bounds and
 // also lose ticket access with the principal's current role, on the public door.
 const delegationToken='synthetic-ticket-scope-grant',targets=['scope-allowed-a','scope-denied-0'].map(id=>`projects/${p}/conversations/${id}`)
 await app.db.batch([
  app.db.prepare("INSERT INTO edition_clients(id,project_id,origin,redirect_uri) VALUES('scope-client',?,'https://scope.example','https://scope.example/callback')").bind(p),
  app.db.prepare("INSERT INTO edition_grants(id,installation_id,client_id,project_id,principal_id,scopes,targets,expires_at,token_hash,created_at) VALUES('scope-grant','roles-installation','scope-client',?,?,?,?,?,?,1)").bind(p,w.users.operator,JSON.stringify(['support.conversation.read']),JSON.stringify(targets),Date.now()+60000,sha(delegationToken)),
 ])
 const delegated=id=>call('/api/delegation/v1/evidence?target='+encodeURIComponent(`projects/${p}/conversations/${id}`),undefined,undefined,delegationToken)
 const permittedEvidence=await delegated('scope-allowed-a');assert.equal(permittedEvidence.status,200);assert.match(permittedEvidence.data.text,/Scope marker scope-allowed-a/)
 assert.equal((await delegated('scope-denied-0')).status,404,'an exact grant target cannot bypass current ticket scope')
 assert.equal((await delegated('scope-allowed-b')).status,403,'role visibility cannot enlarge a machine target list')

 await (await app.files).put('scope-denied-attachment','Private attachment bytes')
 await app.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES('scope-denied-media',?,'scope-denied-0',?,'scope-denied-attachment','private.txt','text/plain',24,'scope-denied-0-message',1)").bind(p,w.users.owner).run()
 const listed=await call(D);assert.equal(listed.status,200);assert.equal(listed.data.meta.pagination.total,2,'scope filtering precedes pagination');assert.deepEqual(listed.data.data.map(t=>t.id).sort(),['scope-allowed-a','scope-allowed-b'])
 assert.deepEqual((await call(D+'?search=Scope')).data.data.map(t=>t.id).sort(),['scope-allowed-a','scope-allowed-b'],'search hydration stays scoped')
 assert.equal((await call(D+'/counts')).data.data.open,2,'counts use the same scope')
 for(const id of ['scope-allowed-a','scope-allowed-b'])for(const door of [`${D}/${id}`,`${D}/${id}/ticket`,`/api/conversations/${id}/messages`])assert.equal((await call(door)).status,200,door)
 for(const id of ['scope-denied-0','scope-ungrouped'])for(const door of [`${D}/${id}`,`${D}/${id}/ticket`,`/api/conversations/${id}`,`/api/conversations/${id}/messages`,`/api/conversations/${id}/media/scope-denied-media`,`${D}/${id}/buckets`])assert.equal((await call(door)).status,404,door)
 const note=await call(D+'/scope-allowed-a/notes',{content:'A permitted internal note'},'POST');assert.equal(note.status,201)
 assert.equal((await call(D+'/scope-denied-0/notes',{content:'Denied note'},'POST')).status,404)
 const bulk={tickets:['scope-allowed-a','scope-denied-0'].map(id=>({id,expected_version:0})),changes:{priority:'high'}}
 const preview=await call(`/api/dashboard/projects/${p}/tickets/bulk/preview`,bulk,'POST');assert.equal(preview.status,200);assert.equal(preview.data.data.results.find(t=>t.id==='scope-allowed-a').status,'ready');assert.notEqual(preview.data.data.results.find(t=>t.id==='scope-denied-0').status,'ready')
 const applied=await call(`/api/dashboard/projects/${p}/tickets/bulk/apply`,bulk,'POST');assert.equal(applied.status,200);assert.equal(applied.data.data.results.find(t=>t.id==='scope-allowed-a').status,'applied');assert.equal(applied.data.data.results.find(t=>t.id==='scope-denied-0').status,'forbidden');assert.equal((await app.first("SELECT priority FROM conversations WHERE id='scope-denied-0'")).priority,'normal')
 assert.equal((await call(`${D}/scope-allowed-a/ticket`,{group_id:'scope-denied'},'PATCH')).status,403,'destination scope is independent of routing membership')
 assert.equal((await call(`${D}/scope-allowed-a/ticket`,{priority:'high'},'PATCH')).status,200)

 assert.equal((await call(`${D}/scope-allowed-a/timer/start`,{},'POST')).status,200,'permitted timer starts')
 assert.equal((await call(`${D}/scope-allowed-a/timer/stop`,{},'POST')).status,200,'permitted timer stops')
 const timersBefore=(await app.first('SELECT count(*) n FROM ticket_handle_sessions WHERE project_id=?',p)).n
 const timerRace=await app.call(`${D}/scope-allowed-b/timer/start`,{token:w.tokens.operator,method:'POST',body:{},headers:{'x-test-statement':'INSERT OR IGNORE INTO ticket_handle_sessions','x-test-before-statement':`UPDATE project_roles SET ticket_scope_json='${JSON.stringify({groupIds:[],includeUngrouped:false})}',updated_at=updated_at+1 WHERE id='${roleId}'`}})
 assert.equal(timerRace.status,409,'a timer cannot start after commit-time scope loss')
 assert.equal((await app.first('SELECT count(*) n FROM ticket_handle_sessions WHERE project_id=?',p)).n,timersBefore,'revocation leaves no timer write')
 await select(['scope-a','scope-b'],true)
 assert.equal((await call(D+'/counts')).data.data.open,3,'explicit ungrouped choice')
 const stream=await socketClient(app)(`/api/conversations/scope-allowed-a/socket?token=${w.tokens.operator}`)
 assert.equal(stream.status,101);await stream.next(frame=>frame.type==='message')
 await select([],false)
 assert.equal((await delegated('scope-allowed-a')).status,404,'active grant sees role-scope revocation on its next request')
 try{const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('scope stream did not revoke')),3000);stream.socket.addEventListener('close',event=>{clearTimeout(timer);resolve(event.code)},{once:true})});stream.socket.send(JSON.stringify({type:'ping'}));assert.equal(await closed,1008,'an already open stream checks current scope')}finally{stream.socket.close()}
 assert.equal((await call(D)).data.meta.pagination.total,0,'restricted empty means no tickets')
 assert.equal((await call(D+'/counts')).data.data.open,0)
 assert.equal((await call(D+'/scope-allowed-a')).status,404,'next request observes narrowing')
 assert.equal((await call(D+'/scope-allowed-a/notes',{content:'Stale tab note'},'POST')).status,404)
 assert.equal((await call(D+'/scope-allowed-a',undefined,undefined,w.tokens.owner)).status,200,'native owner retains recovery')
 await select(['scope-a'],false)
 const before=await app.first("SELECT subject FROM conversations WHERE id='scope-allowed-a'")
 const raced=await app.call(`${D}/scope-allowed-a/ticket`,{token:w.tokens.operator,method:'PATCH',body:{subject:'Must not commit'},headers:{'x-test-statement':'INSERT INTO ticket_history','x-test-before-statement':`UPDATE project_roles SET ticket_scope_json='${JSON.stringify({groupIds:[],includeUngrouped:false})}',updated_at=updated_at+1 WHERE id='${roleId}'`}})
 assert.equal(raced.status,409,'scope changed between preparation and receipt refuses the write');assert.deepEqual(await app.first("SELECT subject FROM conversations WHERE id='scope-allowed-a'"),before)
 await select(['scope-a'],false)
 await app.db.prepare("UPDATE conversations SET group_id='scope-denied' WHERE id='scope-allowed-a'").run()
 assert.equal((await call(D+'/scope-allowed-a')).status,404,'ticket movement revokes the next read')
 assert.equal((await call(D+'/scope-allowed-b')).status,404,'other selected groups can be removed')
 const foreign=await app.seedWorkspace('ticket-scope-foreign')
 assert.equal((await call(`/api/dashboard/projects/${foreign.projectId}/conversations`)).status,403,'selection grants no other brand membership')
 assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action='ticket.scope_denied'",p)).n>0)
}
