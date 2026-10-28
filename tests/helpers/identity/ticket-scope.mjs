import {socketClient} from '../widget/sockets.mjs'
import assert from 'node:assert/strict'
import {sha} from '../../journeys/kit/app.mjs'

/** A role is narrowed, used for ticket work and reports, then revoked during active work. */
export async function nativeTicketScopeAssertions(app){
 const w=await app.seedWorkspace('ticket-scope'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`
 const call=(path,body,method,token=w.tokens.operator)=>app.call(path,{body,method,token})
 for(const group of ['scope-a','scope-b','scope-denied'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,p,group).run()
 const definition={name:'Scoped native agent',base:'operator',permissions:['conversations.manage','conversations.reply','conversations.notes','conversations.follow','contacts.manage']}
 const role=await call(`${P}/roles`,{...definition,ticketScope:{groupIds:['scope-a','scope-b'],includeUngrouped:false}},'POST',w.tokens.owner)
 assert.equal(role.status,201)
 const roleId=role.data.data.id
 const select=async(groupIds,includeUngrouped)=>{const response=await call(`${P}/roles/${roleId}`,{...definition,ticketScope:{groupIds,includeUngrouped}},'PUT',w.tokens.owner);assert.equal(response.status,200,JSON.stringify(response.data))}
 const reloaded=(await call(`${P}/roles`,undefined,undefined,w.tokens.owner)).data.data.custom.find(r=>r.id===roleId)
 assert.deepEqual(reloaded.ticketScope,{groupIds:['scope-a','scope-b'],includeUngrouped:false})
 await app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('scope-customer',?,'Morgan Customer','morgan@example.test',1)").bind(p).run()
 for(const [id,group] of [['scope-allowed-a','scope-a'],['scope-allowed-b','scope-b'],['scope-ungrouped',null],['scope-denied-0','scope-denied']])await app.db.batch([
  app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,revision,last_message_id,created_at,updated_at) VALUES(?,?,?, ?,1,?,1,1)').bind(id,p,'scope-customer',group,id+'-message'),
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,'scope-customer','contact',?,1,1)").bind(id+'-message',p,id,id+'-local','Scope marker '+id),
  app.db.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) VALUES(?,?,?,1)').bind(p,id,id+'-message'),
 ])
 assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:roleId},'PUT',w.tokens.owner)).status,200)
 // Assignment and following never supply visibility outside the saved role.
 await app.db.prepare("UPDATE conversations SET assigned_to=? WHERE id='scope-denied-0'").bind(w.users.operator).run()
 await app.db.prepare("INSERT INTO conversation_followers(conversation_id,user_id,created_at) VALUES('scope-denied-0',?,1)").bind(w.users.operator).run()
 const listed=await call(D);assert.equal(listed.status,200);assert.deepEqual(listed.data.data.map(t=>t.id).sort(),['scope-allowed-a','scope-allowed-b'])
 assert.deepEqual((await call(D+'?search=Scope')).data.data.map(t=>t.id).sort(),['scope-allowed-a','scope-allowed-b'])
 assert.equal((await call(D+'/counts')).data.data.open,2)
 assert.equal((await call(D+'/scope-allowed-a')).status,200)
 for(const id of ['scope-denied-0','scope-ungrouped'])assert.equal((await call(`${D}/${id}`)).status,404)
 assert.equal((await call(D+'/scope-allowed-a/notes',{content:'A permitted internal note'},'POST')).status,201)
 assert.equal((await call(D+'/scope-denied-0/notes',{content:'Denied note'},'POST')).status,404)
 assert.equal((await call(`${D}/scope-allowed-a/ticket`,{group_id:'scope-denied'},'PATCH')).status,403)

 // A separate reporting permission still exports only the reviewer's visible cohort.
 const reportRole=await call(`${P}/roles`,{name:'Scoped report reviewer',base:'admin',permissions:['reports.view','data.export','contacts.manage','integrations.install','conversations.manage'],ticketScope:{groupIds:['scope-a','scope-b'],includeUngrouped:false}},'POST',w.tokens.owner)
 assert.equal(reportRole.status,201)
 assert.equal((await call(`${P}/agents/${w.users.admin}`,{role:reportRole.data.data.id},'PUT',w.tokens.owner)).status,200)
 const reportPath=`/api/dashboard/projects/${p}/reports?period=custom&start=1970-01-01&end=1970-01-02`
 const report=await call(reportPath,undefined,undefined,w.tokens.admin);assert.equal(report.status,200);assert.equal(report.data.volume,2)
 const exported=await call(reportPath+'&format=conversations.csv',undefined,undefined,w.tokens.admin);assert.equal(exported.status,200);assert.match(exported.data,/scope-allowed-a/);assert.doesNotMatch(exported.data,/scope-denied|scope-ungrouped/)
 const transcript=await call(reportPath+'&format=transcripts.json',undefined,undefined,w.tokens.admin);assert.equal(transcript.status,200);assert.deepEqual(transcript.data.conversations.map(c=>c.id),['scope-allowed-a','scope-allowed-b'])

 // An already approved machine target loses access with its principal's role.
 const delegationToken='synthetic-ticket-scope-grant',targets=['scope-allowed-a','scope-denied-0'].map(id=>`projects/${p}/conversations/${id}`)
 await app.db.batch([
  app.db.prepare("INSERT INTO edition_clients(id,project_id,origin,redirect_uri) VALUES('scope-client',?,'https://scope.example','https://scope.example/callback')").bind(p),
  app.db.prepare("INSERT INTO edition_grants(id,installation_id,client_id,project_id,principal_id,scopes,targets,expires_at,token_hash,created_at) VALUES('scope-grant','roles-installation','scope-client',?,?,?,?,?,?,1)").bind(p,w.users.operator,JSON.stringify(['support.conversation.read']),JSON.stringify(targets),Date.now()+60000,sha(delegationToken)),
 ])
 const delegated=id=>call('/api/delegation/v1/evidence?target='+encodeURIComponent(`projects/${p}/conversations/${id}`),undefined,undefined,delegationToken)
 const permitted=await delegated('scope-allowed-a');assert.equal(permitted.status,200);assert.match(permitted.data.text,/Scope marker scope-allowed-a/)
 assert.equal((await delegated('scope-denied-0')).status,404)
 assert.equal((await delegated('scope-allowed-b')).status,403,'role visibility cannot enlarge the grant target list')
 await select(['scope-a','scope-b'],true)
 assert.equal((await call(D+'/counts')).data.data.open,3,'explicit ungrouped choice')
 const stream=await socketClient(app)(`/api/conversations/scope-allowed-a/socket?token=${w.tokens.operator}`)
 assert.equal(stream.status,101);await stream.next(frame=>frame.type==='message')
 await select([],false)
 assert.equal((await delegated('scope-allowed-a')).status,404)
 try{const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('scope stream did not revoke')),3000);stream.socket.addEventListener('close',event=>{clearTimeout(timer);resolve(event.code)},{once:true})});stream.socket.send(JSON.stringify({type:'ping'}));assert.equal(await closed,1008)}finally{stream.socket.close()}
 assert.equal((await call(D)).data.meta.pagination.total,0,'restricted empty means no tickets')
 assert.equal((await call(D+'/scope-allowed-a')).status,404)
 assert.equal((await call(D+'/scope-allowed-a/notes',{content:'Stale tab note'},'POST')).status,404)
 assert.equal((await call(D+'/scope-allowed-a',undefined,undefined,w.tokens.owner)).status,200,'native owner retains recovery')
 const audit=(await app.sql("SELECT detail_json FROM audit_events WHERE project_id=? AND action='role.updated' AND target_id=?",p,roleId)).map(r=>JSON.parse(r.detail_json))
 assert.ok(audit.some(d=>d.ticketScope.before.groupIds.length===2&&d.ticketScope.after.groupIds.length===0),'revocation is audited with before and after selections')
}
