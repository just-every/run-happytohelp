import assert from 'node:assert/strict'

/** Stored authority only: scope is written by fixtures, never the public role API. */
export async function nativeTicketScopeAssertions(app){
 const results=[]
 const w=await app.seedWorkspace('synthetic-hh-1'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`
 const call=(path,body,method,token=w.tokens.operator,headers)=>app.call(path,{body,method,token,headers})
 const probe=(point,door,response,expected)=>{
  const observed={status:response.status,...(response.data?.data?.results?{results:response.data.data.results.map(r=>({status:r.status,committed:r.committed}))}:{}),...(response.data?.code?{code:response.data.code}:{})}
  results.push({point,actual:observed,expected})
  console.log(`PROBE ${results.length} ${point}: ${door} -> ${JSON.stringify(observed)}`)
  assert.equal(response.status,typeof expected==='number'?expected:expected.status,point)
  if(expected.results)assert.deepEqual(observed.results,expected.results,point)
 }

 const role=await call(`${P}/roles`,{name:'Synthetic ticket scope',base:'operator',permissions:['conversations.manage','conversations.reply','conversations.notes','conversations.follow']},'POST',w.tokens.owner);assert.equal(role.status,201)
 const roleId=role.data.data.id
 await app.db.prepare('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?, ?,1)').bind('synthetic-hh-contact',p,'Synthetic customer','synthetic-hh-2@example.test').run()
 for(const group of ['synthetic-hh-a','synthetic-hh-b'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,p,group).run()
 for(const [ticket,group] of [['synthetic-hh-visible','synthetic-hh-a'],['synthetic-hh-hidden','synthetic-hh-b'],['synthetic-hh-ungrouped',null]])await app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,subject,created_at,updated_at) VALUES(?,?,?,?,?,1,1)').bind(ticket,p,'synthetic-hh-contact',group,'Synthetic ticket').run()
 assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:roleId},'PUT',w.tokens.owner)).status,200)
 const ticket=id=>`${D}/synthetic-hh-${id}/ticket`
 const select=async(scope,id=roleId)=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=?,updated_at=updated_at+1 WHERE project_id=? AND id=?').bind(scope===null?null:typeof scope==='string'?scope:JSON.stringify(scope),p,id).run()
 const selected={groupIds:['synthetic-hh-a'],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
 await select(selected)
 probe('selected read',`GET ${ticket('visible')}`,await call(ticket('visible')),200)
 probe('hidden read',`GET ${ticket('hidden')}`,await call(ticket('hidden')),404)
 probe('selected patch',`PATCH ${ticket('visible')} priority=high`,await call(ticket('visible'),{priority:'high'},'PATCH'),200)
 probe('hidden patch',`PATCH ${ticket('hidden')} priority=high`,await call(ticket('hidden'),{priority:'high'},'PATCH'),404)
 probe('destination refused',`PATCH ${ticket('visible')} group_id=synthetic-hh-b`,await call(ticket('visible'),{group_id:'synthetic-hh-b'},'PATCH'),403)
 probe('source refused',`PATCH ${ticket('hidden')} group_id=synthetic-hh-a`,await call(ticket('hidden'),{group_id:'synthetic-hh-a'},'PATCH'),404)
 await app.db.prepare("UPDATE conversations SET group_id=CASE id WHEN 'synthetic-hh-visible' THEN 'synthetic-hh-a' ELSE 'synthetic-hh-b' END WHERE id IN ('synthetic-hh-visible','synthetic-hh-hidden')").run()
 const bulk=async(action,id='visible',changes={priority:'urgent'},headers)=>{const row=await app.first('SELECT ticket_version FROM conversations WHERE id=?','synthetic-hh-'+id);return call(`${P}/tickets/bulk/${action}`,{tickets:[{id:'synthetic-hh-'+id,expected_version:row.ticket_version}],changes},'POST',w.tokens.operator,headers)}
 probe('bulk selected preview',`POST ${P}/tickets/bulk/preview visible priority=urgent`,await bulk('preview'),{status:200,results:[{status:'ready',committed:undefined}]})
 probe('bulk hidden apply',`POST ${P}/tickets/bulk/apply hidden priority=urgent`,await bulk('apply','hidden'),{status:200,results:[{status:'forbidden',committed:undefined}]})
 probe('bulk destination refused',`POST ${P}/tickets/bulk/apply visible group_id=synthetic-hh-b`,await bulk('apply','visible',{group_id:'synthetic-hh-b'}),400)
 const before=await app.first("SELECT subject,priority,ticket_version FROM conversations WHERE id='synthetic-hh-visible'")
 const revoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE project_id='${p}' AND id='${roleId}'`
 const race=await bulk('apply','visible',{priority:'urgent'},{'x-test-statement':'INSERT INTO ticket_history','x-test-before-statement':revoke})
 probe('bulk commit revocation',`POST ${P}/tickets/bulk/apply visible priority=urgent; scope narrowed before INSERT ticket_history`,race,{status:200,results:[{status:'stale',committed:undefined}]})
 const after=await app.first("SELECT subject,priority,ticket_version FROM conversations WHERE id='synthetic-hh-visible'")
 console.log('RACE unchanged='+(JSON.stringify(before)===JSON.stringify(after)));assert.deepEqual(after,before,'revoked bulk admission leaves ticket unchanged')
 await select({groupIds:[],includeUngrouped:true})
 probe('ungrouped selected',`GET ${ticket('ungrouped')}`,await call(ticket('ungrouped')),200)
 probe('ungrouped excludes groups',`GET ${ticket('visible')}`,await call(ticket('visible')),404)
 await select(empty)
 probe('empty excludes ungrouped',`GET ${ticket('ungrouped')}`,await call(ticket('ungrouped')),404)
 probe('empty excludes groups',`GET ${ticket('visible')}`,await call(ticket('visible')),404)
 probe('owner recovery',`GET ${ticket('hidden')} as native owner`,await call(ticket('hidden'),undefined,undefined,w.tokens.owner),200)
 await select({groupIds:['synthetic-hh-a','synthetic-hh-b'],includeUngrouped:false})
 const destinationBefore=await app.first("SELECT group_id,ticket_version FROM conversations WHERE id='synthetic-hh-visible'")
 const destinationRevoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(selected)}' WHERE project_id='${p}' AND id='${roleId}'`
 probe('destination revoked at commit',`PATCH ${ticket('visible')} group_id=synthetic-hh-b; scope narrows before receipt`,await call(ticket('visible'),{group_id:'synthetic-hh-b'},'PATCH',w.tokens.operator,{'x-test-statement':'INSERT INTO ticket_history','x-test-before-statement':destinationRevoke}),409)
 assert.deepEqual(await app.first("SELECT group_id,ticket_version FROM conversations WHERE id='synthetic-hh-visible'"),destinationBefore)
 await app.db.prepare("UPDATE conversations SET group_id='synthetic-hh-a' WHERE id='synthetic-hh-visible'").run()
 await select(selected)
 await app.db.prepare('INSERT INTO ticket_group_members(project_id,group_id,user_id) VALUES(?,?,?)').bind(p,'synthetic-hh-b',w.users.operator).run()
 await app.db.prepare("UPDATE conversations SET assigned_to=? WHERE id='synthetic-hh-hidden'").bind(w.users.operator).run()
 await app.db.prepare("INSERT INTO conversation_followers(conversation_id,user_id,created_at) VALUES('synthetic-hh-hidden',?,1)").bind(w.users.operator).run()
 probe('routing assignment follow confer no visibility',`GET ${ticket('hidden')} as routed assignee/follower`,await call(ticket('hidden')),404)
 const foreign=await app.seedWorkspace('synthetic-hh-3');await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind('synthetic-hh-foreign',foreign.projectId,'Synthetic foreign').run()
 // Corrupt-storage fixtures deliberately bypass the column CHECK only in this test connection.
 await app.db.prepare('PRAGMA ignore_check_constraints=ON').run()
 for(const [point,scope] of [['malformed JSON','{'],['malformed shape',{groupIds:'synthetic-hh-a',includeUngrouped:true}],['unknown group',{groupIds:['synthetic-hh-a','synthetic-hh-unknown'],includeUngrouped:true}],['foreign group',{groupIds:['synthetic-hh-a','synthetic-hh-foreign'],includeUngrouped:true}]]){await select(scope);probe(point,`GET ${ticket('visible')} with test-only stored ${point}`,await call(ticket('visible')),404);probe(point+' ungrouped',`GET ${ticket('ungrouped')} with test-only stored ${point}`,await call(ticket('ungrouped')),404)}
 await app.db.prepare('PRAGMA ignore_check_constraints=OFF').run()
 await select(null)
 probe('NULL compatibility hidden read',`GET ${ticket('hidden')}`,await call(ticket('hidden')),200)
 probe('NULL compatibility mutate',`PATCH ${ticket('hidden')} subject=Synthetic unrestricted`,await call(ticket('hidden'),{subject:'Synthetic unrestricted'},'PATCH'),200)
 const collab=await call(`${P}/roles`,{name:'Synthetic scoped collaborator',base:'collaborator',permissions:['conversations.notes','conversations.follow']},'POST',w.tokens.owner);assert.equal(collab.status,201)
 await select(selected,collab.data.data.id)
 assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:collab.data.data.id},'PUT',w.tokens.owner)).status,200)
 probe('collaborator reads permitted',`GET ${ticket('visible')}`,await call(ticket('visible')),200)
 probe('collaborator notes permitted',`POST ${D}/synthetic-hh-visible/notes`,await call(`${D}/synthetic-hh-visible/notes`,{content:'Synthetic private note'},'POST'),201)
 probe('collaborator follows permitted',`POST ${D}/synthetic-hh-visible/follow`,await call(`${D}/synthetic-hh-visible/follow`,{},'POST'),200)
 probe('collaborator reply refused','POST /api/conversations/synthetic-hh-visible/messages',await call('/api/conversations/synthetic-hh-visible/messages',{content:'Synthetic public reply',localId:'synthetic-hh-reply'},'POST'),403)
 probe('collaborator fields refused',`PATCH ${ticket('visible')} priority=low`,await call(ticket('visible'),{priority:'low'},'PATCH'),403)
 probe('collaborator hidden refused',`GET ${ticket('hidden')}`,await call(ticket('hidden')),404)
 console.log(`PROBE_TOTAL=${results.length} phase=AFTER`)
 // Participant and tag commits use the same live stored selection. Revocation
 // deliberately leaves updated_at unchanged to isolate the new scope guard.
 assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:roleId},'PUT',w.tokens.owner)).status,200)
 await select(selected)
 for(const suffix of ['one','two'])await app.db.prepare('INSERT INTO contacts(id,project_id,email,created_at) VALUES(?,?,?,1)').bind('synthetic-hh-recipient-'+suffix,p,`synthetic-hh-recipient-${suffix}@example.test`).run()
 const participantPath=`${D}/synthetic-hh-visible/participants`
 const participant=await call(participantPath,{email:'synthetic-hh-recipient-one@example.test'},'POST');assert.equal(participant.status,201)
 const participantBefore=await app.sql("SELECT * FROM conversation_participants WHERE conversation_id='synthetic-hh-visible'")
 const deleteRace=await call(`${participantPath}/${participant.data.data.pivot.id}`,undefined,'DELETE',w.tokens.operator,{'x-test-statement':'DELETE FROM conversation_participants','x-test-before-statement':revoke})
 assert.equal(deleteRace.status,404);assert.deepEqual(await app.sql("SELECT * FROM conversation_participants WHERE conversation_id='synthetic-hh-visible'"),participantBefore)
 await select(selected)
 const addRace=await call(participantPath,{email:'synthetic-hh-recipient-two@example.test'},'POST',w.tokens.operator,{'x-test-statement':'INSERT INTO conversation_participants','x-test-before-statement':revoke})
 assert.equal(addRace.status,409);assert.deepEqual(await app.sql("SELECT * FROM conversation_participants WHERE conversation_id='synthetic-hh-visible'"),participantBefore)
 await select(selected)
 const tagsPath=`${D}/synthetic-hh-visible/tags`
 assert.equal((await call(tagsPath,{name:'Synthetic allowed tag'},'POST')).status,201)
 const tagsBefore=await app.sql('SELECT * FROM workspace_tags WHERE project_id=? ORDER BY id',p)
 const tagRace=await call(tagsPath,{name:'Synthetic revoked tag'},'POST',w.tokens.operator,{'x-test-statement':'INSERT INTO workspace_tags','x-test-before-statement':revoke})
 assert.equal(tagRace.status,409);assert.deepEqual(await app.sql('SELECT * FROM workspace_tags WHERE project_id=? ORDER BY id',p),tagsBefore)
 console.log('COMMIT_PROOF participants=201,404,409 unchanged=true; tags=201,409 unchanged=true')

}
