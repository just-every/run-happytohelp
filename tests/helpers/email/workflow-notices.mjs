import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {recipients} from './app.mjs'

// Published workflow decisions use the same proven-address and durable-delivery
// doors as native triggers. Capture only at the provider edge.
export async function workflowNotices(m){
 const {app,mail}=m,base='/api/dashboard/projects/p',rules=base+'/workflow-rules'
 const owner={headers:m.operator},request=async(path,body)=>app.ok(path,{...owner,...(body===undefined?{}:{body})})
 const deliveries=marker=>mail.sent.filter(entry=>entry.body.text?.startsWith(marker))
 for(const mode of ['confirmed','refused','uncertain']){
  const marker=`Workflow ${mode}:`,subject=`Workflow notice ${mode}`
  const definition={name:subject,kind:'event',event_kind:'customer_reply',conditions:{all:[{field:'subject',op:'eq',value:subject}]},actions:[{type:'assign',user_id:'op'},{type:'notify',kind:'assignee',message:marker+' {{ticket.id}}'},...(mode==='confirmed'?[{type:'notify',kind:'customer_update',message:'Customer '+marker+' {{ticket.id}}'}]:[]),{type:'priority',priority:'high'},...(mode==='confirmed'?[{type:'status',status_id:'pending'}]:[])]}
  const {rule}=await request(rules,definition),before=mail.attempts
  assert.equal((await request(`${rules}/${rule.id}/preview`,{})).side_effects,false)
  assert.equal(mail.attempts,before,'workflow previews have no network effects')
  await request(`${rules}/${rule.id}/publish`,{})
  mail.respond=entry=>{if(!entry.body.text?.startsWith(marker))return undefined;if(mode==='uncertain')throw new Error('response lost after acceptance');if(mode==='refused')return new Response('refused',{status:422})}
  const messageId=`synthetic-happytohelp-workflow-${mode}`,from=`workflow-${mode}@example.com`
  assert.equal((await m.gateway({messageId,to:'inbound@example.com',from,cc:['cc@example.com','unproven@example.net'],subject,text:'Please review this order'})).status,201)
  await app.scheduled();await app.scheduled()
  const id=(await m.claim(messageId)).conversation_id,runs=async()=>(await request(`${base}/workflow-runs?conversation_id=${id}`)).runs.filter(run=>run.rule_id===rule.id)
  const run=(await runs())[0];assert.ok(run)
  assert.equal(run.state,mode==='confirmed'?'complete':mode==='refused'?'failed':'uncertain',run.reason)
  assert.deepEqual(deliveries(marker).map(entry=>recipients(entry.body)),[['op@example.com']],'only the current assignee receives the teammate action')
  for(const entry of deliveries(marker))assert.equal(entry.body.headers['X-Auto-Response-Suppress'],'All')
  if(mode==='confirmed')assert.deepEqual(deliveries('Customer '+marker).flatMap(entry=>recipients(entry.body)).sort(),['cc@example.com',from].sort(),'customer actions reach the requester and independently proven CC only')
  assert.equal((await app.first('SELECT priority FROM conversations WHERE id=?',id)).priority,mode==='confirmed'?'high':'normal','later actions require a confirmed delivery')
  if(mode==='confirmed')assert.equal((await app.first('SELECT status_category FROM conversations WHERE id=?',id)).status_category,'pending','the published event rule applies its status action after confirmed notices')
  const counts=[deliveries(marker).length,deliveries('Customer '+marker).length]
  await app.configure({});await app.scheduled();await app.scheduled()
  assert.deepEqual([deliveries(marker).length,deliveries('Customer '+marker).length],counts,'restart never repeats a terminal or uncertain notification')
  assert.equal((await runs()).length,1)
  if(mode==='uncertain'){
   const current=(await runs())[0],review={expected_updated_at:current.updated_at,note:'Reviewed the provider receipt; the external outcome is still unknown. Close remaining work.',reference:'synthetic-happytohelp-5'},path=`${base}/workflow-runs/${current.id}/reconcile`,beforeReview=mail.attempts
   assert.equal((await app.call(path,{headers:{Authorization:'Bearer watch-token'},body:review})).status,403)
   assert.equal((await app.call(path,{...owner,body:{...review,expected_updated_at:current.updated_at-1}})).status,409)
   const foreign=await app.seedWorkspace('workflow-review-foreign')
   assert.equal((await app.call(`/api/dashboard/projects/${foreign.projectId}/workflow-runs/${current.id}/reconcile`,{token:foreign.tokens.owner,body:review})).status,404)
   const reconciled=await request(path,review);assert.equal(reconciled.state,'cancelled');assert.equal(reconciled.provider_outcome,'unchanged')
   assert.equal((await app.call(path,{...owner,body:review})).status,409,'review cannot be repeated against an obsolete frontier')
   assert.equal((await runs())[0].state,'cancelled')
   const audit=await app.first("SELECT detail_json FROM audit_events WHERE project_id='p' AND action='workflow.run.reconciled' AND target_id=?",current.id)
   assert.deepEqual(JSON.parse(audit.detail_json),{run_id:current.id,previous_state:'uncertain',cursor:current.cursor,note:review.note,reference:review.reference,disposition:'remaining_actions_cancelled',provider_outcome:'unchanged'})
   await app.configure({});await app.scheduled();assert.equal(mail.attempts,beforeReview,'manual reconciliation and restart never send or resume remaining actions')
   assert.equal((await app.first('SELECT priority FROM conversations WHERE id=?',id)).priority,'normal')
   assert.equal((await app.first("SELECT count(*) n FROM workflow_notifications WHERE conversation_id=? AND state='uncertain'",id)).n,1,'the uncertain provider record remains uncertain')
  }
  await request(`${rules}/${rule.id}/pause`,{})
  await m.gateway({messageId:messageId+'-paused',to:'inbound@example.com',from,subject,text:'Another matching request'})
  await app.scheduled();assert.deepEqual([deliveries(marker).length,deliveries('Customer '+marker).length],counts,'pause prevents subsequent effects')
  mail.respond=null
 }
}

// The workflow editor's named-group option identifies a group, never a user.
// Both audiences retain their current membership and personal delivery choices.
export async function workflowGroupNotices(m){
 const {app,DB,mail}=m,base='/api/dashboard/projects/p',owner={headers:m.operator},req=(path,body,method)=>app.ok(base+path,{...owner,...(body===undefined?{}:{body}),...(method?{method}:{})})
 const group=(await req('/ticket-groups',{name:'Workflow review',members:['op','watch']})).data
 const incoming={messageId:'synthetic-happytohelp-30',to:'inbound@example.com',from:'group-workflow@example.com',subject:'Workflow group review',text:'Please review this order'}
 await m.gateway(incoming);const id=(await m.claim(incoming.messageId)).conversation_id
 await req(`/conversations/${id}/followers`,{user_ids:['op','watch']},'PUT')
 const definition={name:'Explicit group and follower workflow',kind:'event',event_kind:'customer_reply',conditions:{all:[{field:'subject',op:'eq',value:incoming.subject}]},actions:[{type:'assign',user_id:null,group_id:group.id},{type:'notify',kind:'group',recipient_id:group.id,message:'Group workflow: {{ticket.id}}'},{type:'notify',kind:'followers',message:'Follower workflow: {{ticket.id}}'}]}
 const {rule}=await req('/workflow-rules',definition)
 const foreign=await app.seedWorkspace('foreign-notify-group')
 const foreignGroup=(await app.ok(`/api/dashboard/projects/${foreign.projectId}/ticket-groups`,{token:foreign.tokens.owner,body:{name:'Foreign team',members:[]}})).data
 assert.equal((await app.call(base+'/workflow-rules',{...owner,body:{...definition,actions:[{type:'notify',kind:'group',recipient_id:foreignGroup.id}]}})).status,400,'a workflow cannot name another workspace group')
 assert.equal((await app.call(base+'/workflow-rules',{...owner,body:{...definition,actions:[{type:'notify',kind:'followers',recipient_id:'op'}]}})).status,400,'a follower action cannot redirect to a chosen member')
 assert.equal((await req(`/workflow-rules/${rule.id}/preview`,{})).side_effects,false)
 await req(`/workflow-rules/${rule.id}/publish`,{})
 const secret=(await DB.prepare("SELECT verification_secret FROM projects WHERE id='p'").first()).verification_secret
 const signed=(await app.ok('/api/identity/widget/session',{body:{widgetKey:'w',identifier:incoming.from,email:incoming.from,contact_hash:createHmac('sha256',secret).update(incoming.from).digest('hex')},headers:{Origin:'https://example.com'}}))
 const ticket=(await req(`/conversations/${id}/ticket`)).data
 await app.ok(`/api/conversations/${id}/messages`,{token:signed.token,body:{localId:'synthetic-happytohelp-31',content:'Here is the order reference',expectedRevision:ticket.revision,expectedLastMessageId:ticket.last_message_id}})
 await app.scheduled();await app.scheduled()
 const run=(await req(`/workflow-runs?conversation_id=${id}`)).runs.find(r=>r.rule_id===rule.id);assert.equal(run.state,'complete',run.reason)
 for(const marker of ['Group workflow:','Follower workflow:'])assert.deepEqual(mail.sent.filter(e=>e.body.text?.startsWith(marker)).flatMap(e=>recipients(e.body)),['op@example.com'],'watch opted out of email; only the current permitted recipient is emailed')
 const inbox=(await app.ok('/api/management/projects/p/notification-inbox',{headers:{Authorization:'Bearer watch-token'}})).data
 for(const kind of ['group','follower'])assert.ok(inbox.some(n=>n.conversation_id===id&&n.kind===kind),'watch retains the preferred inbox notice')
 const before=mail.attempts;await app.configure({});await app.scheduled();assert.equal(mail.attempts,before,'completed audience claims are not replayed after restart')
 await req(`/workflow-rules/${rule.id}/pause`,{})
}
