import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {message} from '../email/app.mjs'
export async function triageJourney(){
 const a=await assistantApp(),{app,p,owner,workspace:w,ai}=a,base=`/api/dashboard/projects/${p}`
 const call=async(path,body,method='POST',token=owner)=>{const result=await app.ok(base+path,{token,body,method});return result.data??result}
 const get=path=>call(path,undefined,'GET')
 const settings=()=>get('/triage-settings')
 const save=async change=>call('/triage-settings',{...await settings(),...change},'PUT')
 const read=id=>get(`/conversations/${id}/triage`),ticket=id=>get(`/conversations/${id}/ticket`)
 const run=async()=>a.run((await app.takeJobs()).filter(j=>j.type==='triage'))
 const classified=async(id,expected)=>{
  const result=await read(id),fields=(await ticket(id)).fields
  assert.equal(result.state,'complete',JSON.stringify(result));assert.deepEqual(result.predictions,expected)
  for(const [field,prediction] of Object.entries(expected)){
   assert.equal(fields[`triage_${field}`],prediction.value)
   assert.equal(fields[`triage_${field}_confidence`],prediction.confidence)
   assert.equal(fields[`triage_${field}_quote`],prediction.quote)
  }
 }
 let answer={intent:{value:'refund',confidence:.96,quote:'I need a refund'},sentiment:{value:'negative',confidence:.94,quote:'I am disappointed'},language:{value:'en',confidence:.99,quote:'I need a refund'}}
 ai.respond=()=>answer
 try{
 const group=await call('/ticket-groups',{name:'Default review',members:[w.users.operator]})
 await save({enabled:true,default_group_id:group.id})
 const early=await app.call(base+'/triage-settings',{token:owner,method:'PUT',body:{...await settings(),routing_enabled:true,accuracy_reviewed:true}});assert.equal(early.status,400)
 const visitor=await a.visitor('Jamie Rivera'),id=visitor.conversationId
 await a.action(id,'assignAi',{ai_id:null});await visitor.say('I need a refund. I am disappointed with my order.')
 assert.equal(ai.calls.length,0,'admission never invokes the model')
 // The default queue is applied when triage finishes unsure or fails, never while it is pending.
 assert.equal((await read(id)).state,'pending');assert.equal((await ticket(id)).group_id,null)
 await run();const triage=await read(id)
 assert.equal(triage.state,'complete',JSON.stringify(triage));assert.deepEqual(triage.predictions,answer)
 await classified(id,answer)
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
 const relabeled=await call(`/conversations/${vague.conversationId}/triage`,{field:'intent',value:'billing'},'PATCH',w.tokens.operator)
 assert.equal(relabeled.values.intent,'billing');assert.equal(relabeled.predictions.intent.value,'refund');assert.equal(relabeled.labels[0].value,'billing');assert.equal(relabeled.labels[0].actor_id,w.users.operator)
 assert.equal((await ticket(vague.conversationId)).fields.triage_intent,'billing')
 const inaccurate=(await settings()).accuracy.find(r=>r.intent_id==='billing');assert.equal(inaccurate.correct,0);assert.equal(inaccurate.total,1);assert.equal(inaccurate.accuracy,0)
 // The same fields feed ordinary filters and event rules, without an alternative triage engine.
 const priority=await call('/workflow-rules',{name:'Negative sentiment',kind:'event',event_kind:'changed',position:1,conditions:{all:[{field:'field:triage_sentiment',op:'eq',value:'negative'}]},actions:[{type:'priority',priority:'high'}]})
 await call(`/workflow-rules/${priority.rule.id}/publish`,{})
 answer={intent:{value:'billing',confidence:.97,quote:'factura'},sentiment:{value:'negative',confidence:.95,quote:'frustrado'},language:{value:'es',confidence:.99,quote:'Mi factura'}}
 const spanish=await a.visitor('Carmen López');await spanish.say('Mi factura es incorrecta y estoy frustrado.');await run();assert.equal((await ticket(spanish.conversationId)).priority,'high')
 await classified(spanish.conversationId,answer)
 const listing=await app.ok(base+'/conversations?filters='+encodeURIComponent(JSON.stringify([{field:'custom:triage_language',operator:'eq',value:'es'}])),{token:owner});assert.ok(listing.data.some(t=>t.id===spanish.conversationId))
 // Email Routing admits real MIME at the public Worker door. Only the paid model is a fixture.
 const mailbox='support@triage.example.test',sender='customer@triage.example.test'
 await app.ok(`/api/management/projects/${p}/email-settings`,{token:owner,method:'PUT',body:{from_address:mailbox,inbound_address:mailbox,is_enabled:true}})
 answer={intent:{value:'refund',confidence:.96,quote:'Necesito un reembolso'},sentiment:{value:'negative',confidence:.94,quote:'Estoy decepcionada'},language:{value:'es',confidence:.99,quote:'Necesito un reembolso'}}
 const deliver=async(id,text)=>{const result=await app.email(message({id,from:sender,to:mailbox,text}),{from:sender,to:mailbox});assert.equal(result.status,200,JSON.stringify(result));assert.ok(!result.rejected,JSON.stringify(result))}
 await deliver('triage-opening@example.test','Necesito un reembolso por mi pedido. Estoy decepcionada.')
 const inbox=await get('/conversations'),email=inbox.find(t=>t.contact.email===sender);assert.ok(email,'email ticket is visible in the inbox')
 assert.equal((await read(email.id)).state,'pending');assert.equal((await ticket(email.id)).assigned_to,null)
 await app.scheduled();await run();await classified(email.id,answer)
 assert.equal((await ticket(email.id)).assigned_to,w.users.operator,'email intent rule assigns the operator');assert.equal((await ticket(email.id)).priority,'high','email sentiment rule raises priority')
 // The next email replaces the prior prediction, quotes and confidence on the same ticket.
 answer={intent:{value:'billing',confidence:.92,quote:'my invoice'},sentiment:{value:'neutral',confidence:.91,quote:'Please explain'},language:{value:'en',confidence:.98,quote:'Please explain my invoice'}}
 await deliver('triage-followup@example.test','Please explain my invoice.')
 assert.equal((await read(email.id)).state,'pending');assert.equal((await ticket(email.id)).fields.triage_intent,undefined)
 await app.scheduled();await run();await classified(email.id,answer)
 assert.equal((await get('/conversations')).filter(t=>t.contact.email===sender).length,1,'email follow-up stays in its original ticket')
 // A subsequent customer turn replaces fields and cannot reuse a prior prediction.
 ai.reject=true;await spanish.say('¿Pueden ayudarme con la factura?');assert.equal((await ticket(spanish.conversationId)).fields.triage_intent,undefined);await run();assert.equal((await read(spanish.conversationId)).state,'unavailable');assert.ok((await read(spanish.conversationId)).reason)
 const calls=ai.calls.length;await a.run([{type:'triage',id:(await app.first('SELECT id FROM triage_jobs WHERE conversation_id=? ORDER BY source_revision DESC',spanish.conversationId)).id,projectId:p}]);assert.equal(ai.calls.length,calls)
 ai.reject=false;await app.configure({OPENAI_API_KEY:undefined});const withoutKey=ai.calls.length,missing=await a.visitor('No key');await missing.say('Help with my bill');await run();const unavailable=await read(missing.conversationId);assert.match(unavailable.reason,/OPENAI_API_KEY/);assert.equal(unavailable.state,'unavailable');assert.deepEqual(unavailable.predictions,{});assert.equal(ai.calls.length,withoutKey)
 // Default queue placement happens once; an operator's queue choice survives later customer, triage and ticket events.
 const placed=await ticket(missing.conversationId),desk=await call('/ticket-groups',{name:'Billing desk',members:[w.users.operator]});assert.equal(placed.group_id,group.id)
 await call(`/conversations/${missing.conversationId}/ticket`,{expected_version:placed.ticket_version,group_id:desk.id},'PATCH',w.tokens.operator)
 await missing.say('Any news about my bill?');await run();await app.scheduled();assert.equal((await read(missing.conversationId)).state,'unavailable');assert.equal((await ticket(missing.conversationId)).group_id,desk.id)
 await call(`/conversations/${missing.conversationId}/ticket`,{expected_version:(await ticket(missing.conversationId)).ticket_version,priority:'high'},'PATCH',w.tokens.operator);await app.scheduled();assert.equal((await ticket(missing.conversationId)).group_id,desk.id)
 const moves=(await app.sql('SELECT actor_id,actor_type FROM ticket_history WHERE conversation_id=? AND json_extract(changes_json,\'$.group_id.from\') IS NOT json_extract(changes_json,\'$.group_id.to\') ORDER BY at,rowid',missing.conversationId)).map(r=>r.actor_type==='user'?'operator':r.actor_id);assert.deepEqual(moves,['triage default queue','operator'])
 // Triage gates only rules that read its fields: an existing round-robin rule assigns at admission with the model key removed or a language it is unsure of.
 const returns=await call('/ticket-groups',{name:'Returns',members:[w.users.operator]}),robin=await call('/workflow-rules',{name:'Existing round robin',kind:'routing',position:1,conditions:{all:[]},actions:[],routing:{strategy:'round_robin',group_id:returns.id,skills:[]}})
 await call(`/workflow-rules/${robin.rule.id}/publish`,{})
 const admitted=async(name,words)=>{const v=await a.visitor(name);await v.say(words);const t=await ticket(v.conversationId);assert.equal((await read(v.conversationId)).state,'pending');assert.equal(t.assigned_to,w.users.operator,name);assert.equal(t.group_id,returns.id,name);await run();const after=await ticket(v.conversationId);assert.equal(after.assigned_to,w.users.operator,name);assert.equal(after.group_id,returns.id,name);return v.conversationId}
 assert.equal((await read(await admitted('Model down','Where is my parcel?'))).state,'unavailable')
 await app.configure({OPENAI_API_KEY:'sk-test'});answer={intent:{value:'shipping',confidence:.95,quote:'my parcel'},sentiment:{value:'neutral',confidence:.9,quote:'my parcel'},language:{value:'en',confidence:.5,quote:'my parcel'}}
 assert.equal((await read(await admitted('Unsure language','Hola, my parcel is late'))).state,'complete')
 const collaborator=await app.seedWorkspace('triage-collab');await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(collaborator.projectId,collaborator.users.operator,Date.now()).run()
 assert.equal((await app.call(`/api/dashboard/projects/${collaborator.projectId}/triage-settings`,{token:collaborator.tokens.operator,method:'PUT',body:{}})).status,403)
 assert.equal((await app.call(base+`/conversations/${id}/triage`,{token:collaborator.tokens.owner})).status,404)
 const erased=await app.ok(`/api/management/projects/${p}/contacts/${visitor.contactId}/erase`,{token:owner,body:{}});assert.ok(erased.data.providers.requests.some(r=>r.store==='ai_provider'))
 for(const table of ['triage_jobs','triage_labels'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE conversation_id=?`,id)).n,0)
 const taxonomy=(await settings()).taxonomy.map(t=>({...t,name:t.id==='refund'?'Returns and refunds':t.name,active:t.id!=='how_to'}));taxonomy.push({id:'cancel_subscription',name:'Cancel subscription',active:true});await save({routing_enabled:false,taxonomy});assert.deepEqual((await settings()).taxonomy,taxonomy)
 assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'triage.%'",p)).length)
 }finally{await a.close()}
}
