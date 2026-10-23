import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
export async function obligationsJourney(){
 const a=await assistantApp({bindings:{OPENAI_API_KEY:undefined}}),{app,p,owner,workspace}=a
 try{
 const v=await a.visitor();await v.say('🧭 Please follow up on the broken export tomorrow.')
 const message=(await v.transcript()).messages.find(m=>m.actor_role==='contact'),base=`/api/ai-support/projects/${p}/conversations/${v.conversationId}/obligations`
 const call=(path='',options={})=>app.call(base+path,{token:owner,...options})
 const due=Date.now()+3600000,body={messageId:message.id,quote:'follow up on the broken export tomorrow',ownerId:workspace.users.owner,dueAt:due,stopCondition:'Customer confirms export recovery'}
 assert.equal((await call('',{body:{...body,quote:'Invented promise'}})).status,400)
 assert.equal((await call('',{body:{...body,ownerId:'outsider'}})).status,400)
 assert.equal((await app.call(base,{token:v.token})).status,403)
 const created=(await call('',{body,status:201})).data
 let row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.id,created.id);assert.equal(row.state,'proposed');assert.equal(row.draft,null)
 assert.equal(row.quote,body.quote)
 await call(`/${row.id}/accept`,{body:{version:1,ownerId:workspace.users.owner,dueAt:due},status:200})
 assert.equal((await call(`/${row.id}/accept`,{body:{version:1,ownerId:workspace.users.operator,dueAt:due+1000}})).status,409)
 await call(`/${row.id}/accept`,{body:{version:2,ownerId:workspace.users.operator,dueAt:due+1000},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}`,{token:owner,method:'PUT',body:{agent_id:workspace.users.operator},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}`,{token:owner,method:'PUT',body:{agent_id:workspace.users.admin},status:200})
 await app.configure({})
 row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.owner_id,workspace.users.operator,'conversation handoffs do not silently change the accepted promise owner')
 assert.equal(row.due_at,due+1000);assert.equal(row.version,3);assert.equal(row.changes.length,2)
 assert.equal(row.changes[1].accepted_by,workspace.users.owner)
 assert.equal(row.reminderDue,true);assert.equal(row.draft.requiresHumanSend,true)
 assert.match(row.draft.content,/do not yet have current evidence/)
 assert.equal((await v.transcript()).messages.filter(m=>m.actor_role==='ai').length,0,'drafting never sends')
 await app.db.batch([
 app.db.prepare("INSERT INTO escalation_connections(id,project_id,provider,target,updated_at) VALUES('con',?,'github','example/project',1)").bind(p),
 app.db.prepare("INSERT INTO escalation_issues VALUES('issue',?,'con','github','1','EX-1','https://github.com/example/project/issues/1','closed',NULL,1,1)").bind(p),
 app.db.prepare("INSERT INTO escalation_links(id,project_id,conversation_id,issue_id,created_at) VALUES('link',?,?,'issue',1)").bind(p,v.conversationId)
 ])
 const dependent=(await call('',{body:{...body,dependencyId:'issue'},status:201})).data
 assert.equal(dependent.id,created.id,'one cited promise remains one obligation')
 await call(`/${dependent.id}/accept`,{body:{version:3,ownerId:workspace.users.owner,dueAt:due,dependencyId:'issue'},status:200})
 await app.scheduled();await app.scheduled()
 const reminders=await app.sql("SELECT * FROM notification_inbox WHERE id LIKE 'followup:%'")
 assert.equal(reminders.filter(n=>n.id===`followup:${dependent.id}:4`).length,1,'accepted obligation receives one internal reminder even on repeated schedules')
 assert.equal(reminders.find(n=>n.id===`followup:${dependent.id}:4`).email,0)
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.dependency.stale,true);assert.equal(row.dependency.progress,'unconfirmed')
 assert.doesNotMatch(row.draft.content,/have observed recovery/,'a closed issue without readback is not progress')
 await app.db.prepare("INSERT INTO escalation_deliveries VALUES('con','receipt','issue',1,?)").bind(Date.now()).run()
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.dependency.stale,false);assert.equal(row.dependency.progress,'unconfirmed','provider closure alone is not customer recovery')
 await app.db.prepare("UPDATE escalation_links SET recovery='observed' WHERE id='link'").run()
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.dependency.progress,'recovery observed')
 await app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id=?").bind(v.contactId).run()
 assert.equal((await call('')).status,404)
 assert.equal((await app.first('SELECT count(*) n FROM followup_obligations')).n,0,'erasure removes obligations and accepted history')
 }finally{await a.close()}
}
