import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'
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
 app.db.prepare("INSERT INTO escalation_connections(id,project_id,provider,target,updated_at) VALUES('con',?,'github','just-every/run-happytohelp',1)").bind(p),
 app.db.prepare("INSERT INTO escalation_issues VALUES('issue',?,'con','github','1','EX-1','https://github.com/just-every/run-happytohelp/issues/1','closed',NULL,1,1)").bind(p),
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
 assert.equal((await call(`/${row.id}/complete`,{body:{version:4,stopConditionMet:true,confirmationMessageId:message.id,quote:body.quote}})).status,409,'the original promise is not fresh completion evidence')
 await v.say('Thank you; the export works now.')
 const confirmation=(await v.transcript()).messages.filter(m=>m.actor_role==='contact').at(-1)
 await call(`/${row.id}/complete`,{body:{version:4,stopConditionMet:true,confirmationMessageId:confirmation.id,quote:'the export works now'},status:200})
 row=(await call('',{status:200})).data.obligations[0]
 assert.equal(row.state,'completed');assert.equal(row.reminderDue,false);assert.equal(row.draft,null)
 assert.equal(row.completion.confirmationMessageId,confirmation.id);assert.equal(row.completion.reviewerId,workspace.users.owner)
 // A real generation can extract a quoted candidate, but it cannot accept it.
 await app.configure({OPENAI_API_KEY:'synthetic-happytohelp-19'})
 const proposedVisitor=await a.visitor();await proposedVisitor.say('Please follow up tomorrow.')
 const current=await proposedVisitor.transcript()
 const promised=(await app.call(`/api/conversations/${proposedVisitor.conversationId}/messages`,{token:owner,body:{localId:crypto.randomUUID(),content:'I will follow up tomorrow.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.message
 await app.db.prepare("INSERT INTO escalation_links(id,project_id,conversation_id,issue_id,created_at) VALUES('model-link',?,?,'issue',1)").bind(p,proposedVisitor.conversationId).run()
 await a.action(proposedVisitor.conversationId,'assignAi',{ai_id:'ai'})
 await proposedVisitor.say('Please track that promise.')
 let turn=0
 a.ai.respond=body=>{if(++turn===1)return openaiToolCall('list_followup_dependencies',{},'followup-dependencies');if(turn===2){assert.match(JSON.stringify(body.input),/EX-1/);return openaiToolCall('propose_followup',{messageId:promised.id,quote:'follow up tomorrow',ownerId:'human',dueAt:Date.now()+86400000,stopCondition:'A teammate supplies the follow-up.',dependencyId:'issue'},'propose-followup')}return 'A teammate can review the follow-up.'}
 await a.run()
 const extracted=(await app.call(`/api/ai-support/projects/${p}/conversations/${proposedVisitor.conversationId}/obligations`,{token:owner,status:200})).data.obligations[0]
 assert.equal((await proposedVisitor.transcript()).messages.filter(m=>m.actor_role==='ai').length,0,'internal promise and dependency work never publishes an unapproved customer update')
 assert.equal((await app.first('SELECT assigned_to FROM conversations WHERE id=?',proposedVisitor.conversationId)).assigned_to,workspace.users.owner,'internal promise work transfers the next customer response to a human')
 assert.equal(extracted.state,'proposed');assert.equal(extracted.accepted_by,null);assert.equal(extracted.quote,'follow up tomorrow');assert.equal(extracted.dependency_id,'issue')
 await app.call(`/api/ai-support/projects/${p}/conversations/${proposedVisitor.conversationId}/obligations/${extracted.id}/accept`,{token:owner,body:{version:1,ownerId:workspace.users.owner,dueAt:Date.now()+7*86400000},status:200})
 await app.db.prepare('UPDATE escalation_deliveries SET received_at=? WHERE issue_id=?').bind(Date.now()-2*86400000,'issue').run()
 const stale=(await app.call(`/api/ai-support/projects/${p}/conversations/${proposedVisitor.conversationId}/obligations`,{token:owner,status:200})).data.obligations[0]
 assert.equal(stale.reminderDue,true);assert.equal(stale.dependency.stale,true);assert.equal(stale.dependency.progress,'unconfirmed');assert.equal(stale.draft,null)
 await app.scheduled()
 assert.equal((await app.first('SELECT count(*) n FROM notification_inbox WHERE id=?',`followup:${extracted.id}:2`)).n,1,'stale evidence is chased internally even before the pre-due drafting window')
 await app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id=?").bind(proposedVisitor.contactId).run()

 await app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id=?").bind(v.contactId).run()
 assert.equal((await call('')).status,404)
 assert.equal((await app.first('SELECT count(*) n FROM followup_obligations')).n,0,'erasure removes obligations and accepted history')
 }finally{await a.close()}
}
