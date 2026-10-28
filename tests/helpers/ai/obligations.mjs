import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
export async function obligationsJourney(){
 const a=await assistantApp({bindings:{OPENAI_API_KEY:undefined}}),{app,p,owner,workspace}=a
 try{
 const v=await a.visitor();await v.say('🧭 Please follow up on the broken export tomorrow.')
 const initial=await v.transcript()
 const message=(await app.call(`/api/conversations/${v.conversationId}/messages`,{token:owner,body:{localId:crypto.randomUUID(),content:'🧭 I will follow up on the broken export tomorrow.',expectedRevision:initial.revision,expectedLastMessageId:initial.lastMessageId},status:200})).data.message
 const base=`/api/ai-support/projects/${p}/conversations/${v.conversationId}/obligations`
 const call=(path='',options={})=>app.call(base+path,{token:owner,...options})
 const due=Date.now()+3600000,body={messageId:message.id,quote:'follow up on the broken export tomorrow',ownerId:workspace.users.owner,dueAt:due,stopCondition:'Customer confirms export recovery'}
 assert.equal((await call('',{body:{...body,quote:'Invented promise'}})).status,400)
 assert.equal((await call('',{body:{...body,ownerId:'outsider'}})).status,400)
 assert.equal((await app.call(base,{token:v.token})).status,403)
 const other=await app.seedWorkspace('followup-other')
 assert.equal((await app.call(base,{token:other.tokens.owner})).status,403)
 await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',1)").bind(p,workspace.users.operator).run()
 assert.equal((await app.call(base,{token:workspace.tokens.operator,body})).status,403,'current membership overrides the signed-in role')
 await app.db.prepare("DELETE FROM member_roles WHERE project_id=? AND user_id=?").bind(p,workspace.users.operator).run()
 const created=(await call('',{body,status:201})).data
 let row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.id,created.id);assert.equal(row.state,'proposed');assert.equal(row.draft,null)
 assert.equal(row.quote,body.quote)
 const duplicate=(await call('',{body,status:200})).data
 assert.equal(duplicate.id,created.id);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.pendingChange,false)
 const proposedVersion=row.version
 await call(`/${row.id}/accept`,{body:{version:proposedVersion,ownerId:workspace.users.owner,dueAt:due},status:200})
 assert.equal((await call(`/${row.id}/accept`,{body:{version:proposedVersion,ownerId:workspace.users.operator,dueAt:due+1000}})).status,409)
 row=(await call('',{status:200})).data.obligations[0]
 await call(`/${row.id}/accept`,{body:{version:row.version,ownerId:workspace.users.operator,dueAt:due+1000},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}`,{token:owner,method:'PUT',body:{agent_id:workspace.users.operator},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}`,{token:owner,method:'PUT',body:{agent_id:workspace.users.admin},status:200})
 await app.configure({})
 row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.owner_id,workspace.users.operator,'conversation handoffs do not silently change the accepted promise owner')
 assert.equal(row.due_at,due+1000);assert.equal(row.changes.length,2)
 assert.equal(row.changes[1].accepted_by,workspace.users.owner)
 assert.equal(row.reminderDue,true);assert.equal(row.draft.requiresHumanSend,true)
 assert.match(row.draft.content,/do not yet have current evidence/)
 assert.equal((await v.transcript()).messages.length,initial.messages.length+1,'drafting creates no customer message')
 await app.db.batch([
 app.db.prepare("INSERT INTO escalation_connections(id,project_id,provider,target,updated_at) VALUES('con',?,'github','just-every/run-happytohelp',1)").bind(p),
 app.db.prepare("INSERT INTO escalation_issues VALUES('issue',?,'con','github','1','EX-1','https://github.com/just-every/run-happytohelp/issues/1','closed',NULL,1,1)").bind(p),
 app.db.prepare("INSERT INTO escalation_links(id,project_id,conversation_id,issue_id,created_at) VALUES('link',?,?,'issue',1)").bind(p,v.conversationId)
 ])
 await app.scheduled()
 const dependent=(await call('',{body:{...body,dependencyId:'issue'},status:200})).data
 assert.equal(dependent.id,created.id,'one cited promise remains one obligation')
 assert.equal(dependent.duplicate,true);assert.equal(dependent.pendingChange,true)
 const pending=(await call('',{status:200})).data.obligations[0]
 assert.equal(pending.owner_id,workspace.users.operator,'a revised proposal leaves accepted terms intact')
 await app.scheduled()
 assert.equal((await app.first("SELECT count(*) n FROM notification_inbox WHERE id LIKE 'followup:%'")).n,1,'a pending revision does not re-send the accepted reminder')
 assert.deepEqual(pending.pendingTerms,{ownerId:body.ownerId,dueAt:body.dueAt,stopCondition:body.stopCondition,dependencyId:'issue'})
 assert.equal((await call(`/${dependent.id}/accept`,{body:{version:row.version,ownerId:body.ownerId,dueAt:due}})).status,409)
 await call(`/${dependent.id}/accept`,{body:{version:pending.version,ownerId:workspace.users.owner,dueAt:due,dependencyId:'issue',stopCondition:'Customer receives the revised update'},status:200})
 await app.scheduled();await app.scheduled()
 row=(await call('',{status:200})).data.obligations[0]
 const reminderId=`followup:${dependent.id}:${row.version}`
 const reminders=await app.sql("SELECT * FROM notification_inbox WHERE id LIKE 'followup:%'")
 assert.equal(reminders.filter(n=>n.id===reminderId).length,1,'accepted obligation receives one internal reminder even on repeated schedules')
 assert.equal(reminders.find(n=>n.id===reminderId).email,0)
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.pendingTerms,null);assert.equal(row.stop_condition,'Customer receives the revised update');assert.equal(row.dependency.stale,true);assert.equal(row.dependency.progress,'unconfirmed')
 assert.doesNotMatch(row.draft.content,/have observed recovery/,'a closed issue without readback is not progress')
 await app.db.prepare("INSERT INTO escalation_deliveries VALUES('con','receipt','issue',1,?)").bind(Date.now()).run()
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.dependency.stale,false);assert.equal(row.dependency.progress,'unconfirmed','provider closure alone is not customer recovery')
 await app.db.prepare("UPDATE escalation_links SET recovery='observed' WHERE id='link'").run()
 row=(await call('',{status:200})).data.obligations.find(o=>o.id===dependent.id)
 assert.equal(row.dependency.progress,'recovery observed')
 assert.equal((await call(`/${row.id}/complete`,{body:{version:row.version,stopConditionMet:true,confirmationMessageId:message.id,quote:body.quote}})).status,409,'the original promise is not fresh completion evidence')
 await v.say('Thank you; the export works now.')
 const confirmation=(await v.transcript()).messages.filter(m=>m.actor_role==='contact').at(-1)
 await call(`/${row.id}/complete`,{body:{version:row.version,stopConditionMet:true,confirmationMessageId:confirmation.id,quote:'the export works now'},status:200})
 row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.state,'completed');assert.equal(row.reminderDue,false);assert.equal(row.draft,null)
 assert.equal(row.completion.confirmationMessageId,confirmation.id);assert.equal(row.completion.reviewerId,workspace.users.owner)

 await app.call(`/api/management/projects/${p}/contacts/${v.contactId}/erase`,{token:owner,body:{},status:200})
 assert.equal((await call('')).status,404)
 assert.equal((await app.first('SELECT count(*) n FROM followup_obligations')).n,0,'erasure removes obligations')
 assert.equal((await app.first('SELECT count(*) n FROM followup_changes')).n,0,'erasure removes accepted history')
 }finally{await a.close()}
}
