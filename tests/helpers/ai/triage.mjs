import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
export async function triageJourney(){
 const a=await assistantApp(),{app,p,owner,workspace:w,ai}=a,base=`/api/dashboard/projects/${p}`
 const call=async(path,body,method='POST',token=owner)=>{const result=await app.ok(base+path,{token,body,method});return result.data??result}
 const get=path=>call(path,undefined,'GET')
 const settings=()=>get('/triage-settings')
 const save=async change=>call('/triage-settings',{...await settings(),...change},'PUT')
 const read=id=>get(`/conversations/${id}/triage`),ticket=id=>get(`/conversations/${id}/ticket`)
 const run=async()=>a.run((await app.takeJobs()).filter(j=>j.type==='triage'))
 let answer={intent:{value:'refund',confidence:.96,quote:'I need a refund'},sentiment:{value:'negative',confidence:.94,quote:'I am disappointed'},language:{value:'en',confidence:.99,quote:'I need a refund'}}
 ai.respond=()=>answer
 try{
 const group=await call('/ticket-groups',{name:'Default review',members:[w.users.operator]})
 await save({enabled:true,default_group_id:group.id})
 const early=await app.call(base+'/triage-settings',{token:owner,method:'PUT',body:{...await settings(),routing_enabled:true,accuracy_reviewed:true}});assert.equal(early.status,400)
 const visitor=await a.visitor('Jamie Rivera'),id=visitor.conversationId
 await visitor.say('I need a refund. I am disappointed with my order.')
 assert.equal(ai.calls.length,0,'admission never invokes the model')
 assert.equal((await read(id)).state,'pending');assert.equal((await ticket(id)).group_id,group.id)
 await run();const triage=await read(id)
 assert.equal(triage.state,'complete',JSON.stringify(triage));assert.deepEqual(triage.predictions,answer)
 assert.equal((await ticket(id)).fields.triage_intent,'refund');assert.equal((await settings()).routing_enabled,false)
 const bypass=await call('/workflow-rules',{name:'Unapproved intent assignment',kind:'event',event_kind:'changed',position:0,conditions:{all:[{field:'field:triage_intent',op:'eq',value:'refund'}]},actions:[{type:'assign',user_id:w.users.operator}]})
 await call(`/workflow-rules/${bypass.rule.id}/publish`,{})
 const corrected=await call(`/conversations/${id}/triage`,{field:'intent',value:'refund'},'PATCH',w.tokens.operator)
 assert.equal((await ticket(id)).assigned_to,null,'event actions cannot bypass triage routing approval');await call(`/workflow-rules/${bypass.rule.id}/pause`,{});assert.equal(corrected.labels[0].actor_id,w.users.operator);assert.ok(corrected.labels[0].at)
 const measured=(await settings()).accuracy.find(r=>r.intent_id==='refund');assert.equal(measured.correct,1);assert.equal(measured.total,1)
 await call('/routing-operators',{operators:[{user_id:w.users.operator,available:true,capacity:20,skills:[]}]},'PUT')
 const rule=await call('/workflow-rules',{name:'Refund intent',kind:'routing',position:0,conditions:{all:[{field:'field:triage_intent',op:'eq',value:'refund'}]},actions:[],routing:{strategy:'named',user_id:w.users.operator,skills:[]}})
 await call(`/workflow-rules/${rule.rule.id}/publish`,{})
 // An explicit review is required even after a measured label exists.
 assert.equal((await app.call(base+'/triage-settings',{token:owner,method:'PUT',body:{...await settings(),routing_enabled:true}})).status,400)
 await save({routing_enabled:true,accuracy_reviewed:true})
 const routed=await a.visitor('Taylor Chen');await routed.say('I need a refund. I am disappointed.');await run();assert.equal((await ticket(routed.conversationId)).assigned_to,w.users.operator)
 answer={...answer,intent:{...answer.intent,confidence:.25}}
 const vague=await a.visitor('Morgan Lane');await vague.say('I need a refund? I am disappointed but I am not sure.');await run();assert.equal((await ticket(vague.conversationId)).assigned_to,null);assert.equal((await ticket(vague.conversationId)).group_id,group.id)
 // The same fields feed ordinary filters and event rules, without an alternative triage engine.
 const priority=await call('/workflow-rules',{name:'Negative sentiment',kind:'event',event_kind:'changed',position:1,conditions:{all:[{field:'field:triage_sentiment',op:'eq',value:'negative'}]},actions:[{type:'priority',priority:'high'}]})
 await call(`/workflow-rules/${priority.rule.id}/publish`,{})
 answer={intent:{value:'billing',confidence:.97,quote:'factura'},sentiment:{value:'negative',confidence:.95,quote:'frustrado'},language:{value:'es',confidence:.99,quote:'Mi factura'}}
 const spanish=await a.visitor('Carmen López');await spanish.say('Mi factura es incorrecta y estoy frustrado.');await run();assert.equal((await ticket(spanish.conversationId)).priority,'high')
 const listing=await app.ok(base+'/conversations?filters='+encodeURIComponent(JSON.stringify([{field:'custom:triage_language',operator:'eq',value:'es'}])),{token:owner});assert.ok(listing.data.some(t=>t.id===spanish.conversationId))
 // A subsequent customer turn replaces fields and cannot reuse a prior prediction.
 ai.reject=true;await spanish.say('¿Pueden ayudarme con la factura?');assert.equal((await ticket(spanish.conversationId)).fields.triage_intent,undefined);await run();assert.equal((await read(spanish.conversationId)).state,'unavailable');assert.ok((await read(spanish.conversationId)).reason)
 const calls=ai.calls.length;await a.run([{type:'triage',id:(await app.first('SELECT id FROM triage_jobs WHERE conversation_id=? ORDER BY source_revision DESC',spanish.conversationId)).id,projectId:p}]);assert.equal(ai.calls.length,calls)
 ai.reject=false;await app.configure({OPENAI_API_KEY:undefined});const missing=await a.visitor('No key');await missing.say('Help with my bill');await run();assert.match((await read(missing.conversationId)).reason,/OPENAI_API_KEY/)
 const collaborator=await app.seedWorkspace('triage-collab');await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(collaborator.projectId,collaborator.users.operator,Date.now()).run()
 assert.equal((await app.call(`/api/dashboard/projects/${collaborator.projectId}/triage-settings`,{token:collaborator.tokens.operator,method:'PUT',body:{}})).status,403)
 assert.equal((await app.call(base+`/conversations/${id}/triage`,{token:collaborator.tokens.owner})).status,404)
 await app.ok(`/api/management/projects/${p}/contacts/${visitor.contactId}/erase`,{token:owner,body:{}})
 for(const table of ['triage_jobs','triage_labels'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE conversation_id=?`,id)).n,0)
 const taxonomy=(await settings()).taxonomy.map(t=>({...t,name:t.id==='refund'?'Returns and refunds':t.name,active:t.id!=='how_to'}));taxonomy.push({id:'cancel_subscription',name:'Cancel subscription',active:true});await save({routing_enabled:false,taxonomy});assert.deepEqual((await settings()).taxonomy,taxonomy)
 assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'triage.%'",p)).length)
 }finally{await a.close()}
}
