import {configurationFieldsJourney} from './configuration-fields.mjs';
import {companyJourney} from './companies.mjs';
import assert from 'node:assert/strict';
import {phases} from '../journeys/kit/scenarios.mjs';
import {nativeHarness} from './harness.mjs';
import {zip} from './zip.mjs';
import {assertBusinessEquality} from './business-equality.mjs';
const test=phases(import.meta.url);
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const ndjson=(...records)=>records.map(record=>JSON.stringify(record)).join('\n');
let unique=0;

// Each source goes through the real upload, review and approved apply; outcomes are read from native rows.
async function imported(vendor,body,{name='export.jsonl',apply=true,check,before,withConversations=false,expectedPostReviewRequests=[]}={}){
 const h=await nativeHarness({withConversations});try{
  const initial=await before?.(h)
  const sent=await h.raw(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body:typeof body==='string'?body+'\n'.repeat(++unique):body})
  assert.equal(sent.response.status,201,JSON.stringify(sent.data).slice(0,400));await h.drain();const review=(await h.call(`${root}/${sent.data.data.id}`)).data
  assert.ok(review.plan,`${name} reached no review: ${review.state} ${review.error}`)
  const rejection=key=>review.plan.decisions.find(row=>`${row.kind}/${row.sourceId}`===key)?.rejection,omissions=key=>review.plan.decisions.find(row=>`${row.kind}/${row.sourceId}`===key)?.omissions.map(item=>item.reason)
  let done
  if(apply&&review.plan.counts.effects>0){await h.call(`${root}/${review.id}/apply`,post({fingerprint:review.plan.fingerprint}));await h.drain();done=(await h.call(`${root}/${review.id}`)).data;assert.equal(done.state,'completed');assert.equal(done.error,null)}
  const rows=async sql=>(await h.db.prepare(sql).all()).results
  assert.equal(h.outbound,0,'import makes no external request before review or activation')
  await check({review,plan:review.plan,rejection,omissions,done,rows,h,initial});assert.deepEqual(h.outboundRequests,expectedPostReviewRequests,'only explicitly exercised native behavior may attempt the named provider request')
 }finally{await h.close()}
}
async function refusedUpload(vendor,body,name,expected){const h=await nativeHarness();try{const result=await h.raw(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});assert.equal(result.response.status,422);for(const [key,value] of Object.entries(expected))assert.deepEqual(key==='code'?result.data.diagnostic.code:result.data.diagnostic.location[key],value,`${name} ${key}`);assert.equal(h.lastWrites,0)}finally{await h.close()}}

const user={user:{id:1,role:'end-user',name:'Ada',email:'ada@example.test',created_at:'2024-01-01T00:00:00Z'}};
const staff={user:{id:2,role:'agent',name:'Teammate',email:'staff@example.test',created_at:'2024-01-01T00:00:00Z'}};
const ticket={ticket:{id:42,requester_id:1,subject:'Quoted "subject" مرحبا',created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:02:00Z',status:'open',tags:[' Billing ','billing'],comments:[{id:9,author_id:1,body:'Customer <script>inert</script>',public:true,created_at:'2024-01-02T00:00:00Z'},{id:10,author_id:2,body:'Private note',public:false,created_at:'2024-01-02T00:01:00Z'},{id:11,author_id:2,body:'Public reply',public:true,created_at:'2024-01-02T00:02:00Z'}]}};



const contact={type:'contact',id:'c',email:'person@example.test',created_at:1704067200};
const macro={type:'macro',id:'m',name:'Reply',body:'Hello',body_text:'Hello',visible_to:'everyone',available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'};
const conversation={type:'conversation',id:'v',state:'open',channel:{initial:'messenger'},created_at:1704067200,updated_at:1704067200,contacts:{type:'contact.list',contacts:[{id:'c'}]},source:{id:'s',body:'First',author:{type:'contact',id:'c'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[]}};









// Imported macros are manual commands: preview is pure and apply creates a
// composer draft, never a sent message. Repeat and undo cover their full version.



async function configurationJourney(){
 const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'},condition={all:[{field:'priority',operator:'is',value:'normal'}],any:[]}
 const records=[user,staff,ticket,
  {group:{id:71,name:'Billing',deleted:false,default:true,...dates}},{group:{id:72,name:'Technical',deleted:false,default:false,...dates}},
  {schedule:{id:73,name:'Eastern business hours',time_zone:'Eastern Time (US & Canada)',intervals:[{start_time:1980,end_time:2460}],holidays:[{id:74,name:'Winter holiday',start_date:'2024-12-25',end_date:'2024-12-26'}],...dates}},
  {view:{id:75,title:'Open work',active:true,restriction:null,conditions:{all:[{field:'status',operator:'is',value:'open'}],any:[]},execution:{sort_by:'updated_at',sort_order:'desc'},...dates}},
  {trigger:{id:76,title:'Escalate normal work',active:true,position:1,conditions:condition,actions:[{field:'priority',value:'high'},{field:'current_tags',value:'reviewed-import'},{field:'group_id',value:'71'}],...dates}},
  {automation:{id:77,title:'Pending after one hour',active:true,position:2,conditions:{all:[{field:'status',operator:'is',value:'pending'},{field:'hours_since_created',operator:'greater_than',value:'1'}],any:[]},actions:[{field:'priority',value:'urgent'}],...dates}},
  {trigger:{id:78,title:'Unsupported recipient send',active:true,conditions:condition,actions:[{field:'notification_user',value:['2','Subject','Private email']}],...dates}},
 ]
 const source=ndjson(...records)
 console.log('configuration proof: starting inert import')
 await imported('zendesk',source,{before:h=>h.snapshot(),check:async({h,initial,review,plan,rejection,omissions,rows})=>{
  console.log('configuration proof: imported draft configuration');
  assert.equal(plan.counts.rejected,1);assert.equal(rejection('trigger/78'),'configuration_action_unsupported:notification_user')
  assert.ok(omissions('automation/77').includes('automation_native_hour_boundary_once_per_eligibility_episode'))
  assert.ok((await rows("SELECT state,published_version FROM workflow_rules WHERE id IN (SELECT target_id FROM move_in_origins WHERE target_kind='rule')")).every(row=>row.state==='draft'&&row.published_version===0))
  assert.deepEqual((await rows('SELECT name FROM ticket_groups ORDER BY name')).map(row=>row.name),['Billing','Technical'])
  assert.equal((await rows('SELECT COUNT(*) n FROM ticket_group_members'))[0].n,0)
  const calendar=(await rows('SELECT * FROM workflow_calendars'))[0]
  assert.equal(calendar.active,0);assert.equal(calendar.timezone,'America/New_York');assert.deepEqual(JSON.parse(calendar.weekly_json),[{day:1,start:'09:00',end:'17:00'}]);assert.deepEqual(JSON.parse(calendar.closures_json),['2024-12-25','2024-12-26'])
  const importedRules=(await rows("SELECT target_id FROM move_in_origins WHERE target_kind='rule'")).map(row=>row.target_id),rules=(await h.call('/api/dashboard/projects/p/workflow-rules')).rules.filter(row=>importedRules.includes(row.id))
  assert.equal(rules.length,2)
  const trigger=rules.find(row=>row.kind==='event'),preview=await h.call(`/api/dashboard/projects/p/workflow-rules/${trigger.id}/preview`,post({}))
  assert.equal(preview.side_effects,false);assert.ok(preview.matched>=1)
  assert.ok((await rows('SELECT priority FROM conversations')).every(row=>row.priority==='normal'))
  assert.equal((await rows('SELECT COUNT(*) n FROM workflow_runs'))[0].n,0)
  const views=(await h.call('/api/dashboard/projects/p/ticket-views')).data
  assert.equal(views.length,1);assert.equal(views[0].visibility,'personal');assert.deepEqual(views[0].filters,[{field:'status_id',operator:'eq',value:'open'}])
  assert.equal((await h.call('/api/dashboard/projects/p/ticket-views',{actor:'operator'})).data.length,0)
  console.log('configuration proof: preview passed; checking repeat')
  const snapshot=await h.snapshot(),repeat=(await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'config-repeat.jsonl'},body:source+'\n\n'})).data
  await h.drain();const ready=(await h.call(`${root}/${repeat.id}`)).data
  await h.call(`${root}/${repeat.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assertBusinessEquality(snapshot,await h.snapshot())
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain();assertBusinessEquality(initial,await h.snapshot())
  console.log('configuration proof: exact repeat and undo passed')
 }})
 await imported('zendesk',source,{withConversations:true,expectedPostReviewRequests:[{hostname:'api.sendgrid.com',method:'POST'}],check:async({h,review,rows})=>{
  console.log('configuration proof: checking explicit activation')
  const rule=(await h.call('/api/dashboard/projects/p/workflow-rules')).rules.find(row=>row.kind==='event'&&row.name==='Escalate normal work')
  const contact=(await rows('SELECT id FROM contacts'))[0];await h.contactSession('native-visitor','p',contact.id)
  const conversation=await h.call('/api/conversations',{...post({projectId:'p'}),actor:'native-visitor'})
  await h.call(`/api/conversations/${conversation.id}/messages`,{...post({content:'A native request',localId:'synthetic-happytohelp-1',expectedRevision:0}),actor:'native-visitor'})
  const settle=async()=>{let steps=0;while(h.queued.length){assert.ok(++steps<1000);const result=await h.step();assert.deepEqual(result.retried,[])}}
  await settle()
  await h.call(`/api/dashboard/projects/p/workflow-rules/${rule.id}/preview`,post({}))
  assert.equal((await rows(`SELECT priority FROM conversations WHERE id='${conversation.id}'`))[0].priority,'normal')
  await h.call(`/api/dashboard/projects/p/workflow-rules/${rule.id}/publish`,post({}))
  const frontier=await h.call(`/api/conversations/${conversation.id}`,{actor:'native-visitor'})
  await h.call(`/api/conversations/${conversation.id}/messages`,{...post({content:'Please escalate',localId:'synthetic-happytohelp-2',expectedRevision:frontier.revision}),actor:'native-visitor'});await settle()
  const changed=(await rows(`SELECT priority,group_id FROM conversations WHERE id='${conversation.id}'`))[0]
  assert.equal(changed.priority,'high');assert.ok(changed.group_id)
  assert.ok((await rows(`SELECT t.name FROM conversation_tags ct JOIN workspace_tags t ON t.id=ct.tag_id WHERE ct.conversation_id='${conversation.id}'`)).some(t=>t.name==='reviewed-import'))
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain()
  assert.equal((await rows(`SELECT state FROM workflow_rules WHERE id='${rule.id}'`))[0].state,'published','undo preserves a natively activated rule')
  assert.ok((await rows(`SELECT id FROM ticket_groups WHERE id='${changed.group_id}'`)).length,'undo preserves a group that later native work uses')
 }})
}

async function lifecycleJourney(){
 const states=['new','open','pending','hold','solved','closed']
 const records=[user,staff,...states.map((state,index)=>({ticket:{...ticket.ticket,id:1000+index,status:state,via:{channel:index%2?'email':'web'},comments:ticket.ticket.comments.map(comment=>({...comment,id:comment.id+index*100}))}}))]
 await imported('zendesk',ndjson(...records),{before:h=>h.snapshot(),check:async({h,initial,review,rows})=>{
  const landed=await rows("SELECT o.source_id,c.id,c.status_id,c.status_category,c.channel,c.resolved_at FROM conversations c JOIN move_in_origins o ON o.target_id=c.id AND o.target_kind='conversation' ORDER BY o.source_id")
  assert.equal(landed.length,states.length)
  for(const [index,row] of landed.entries()){
   const expected=states[index]==='hold'?'on_hold':states[index]
   assert.equal(row.status_id,expected);assert.equal(row.status_category,expected);assert.equal(row.channel,index%2?'email':'widget')
   assert.equal(row.resolved_at!==null,['solved','closed'].includes(expected))
  }
  assert.equal((await rows("SELECT count(*) n FROM email_threading_keys WHERE key_kind='subject_token'"))[0].n,states.length,'source ticket-number keys were imported inertly')
  assert.equal((await rows("SELECT count(*) n FROM email_threading_keys WHERE key_kind='vendor_header'"))[0].n,states.length,'source header keys were imported inertly')
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain()
  assert.equal((await rows('SELECT count(*) n FROM email_threading_keys'))[0].n,0,'undo removes the inert source keys')
  assertBusinessEquality(initial,await h.snapshot())
 }})
}

import {step} from './steps.mjs';

test("landing: an approved import lands each vendor's history, people, replies, notes, tags and knowledge exactly, keeps notes private, and repeats or repackages as a no-op",async()=>{
await step('Zendesk history lands with roles, original times, private notes, one tag, contact-only tags and plain bodies; incomplete or restricted sources are review rejections',async()=>{
 await companyJourney(imported,'zendesk')
 await lifecycleJourney()
 await imported('zendesk','\n'+ndjson(user,staff,ticket),{check:async({plan,omissions,rows})=>{
  assert.equal(plan.counts.rejected,0);assert.deepEqual(omissions('user/2'),['historical_staff_retained_as_authors_no_access_created'])
  assert.deepEqual(plan.decisions.find(row=>row.kind==='user').location,{artifact:'export.jsonl',row:2})
  assert.deepEqual(await rows('SELECT content,actor_role,created_at FROM messages ORDER BY revision'),[{content:'Customer <script>inert</script>',actor_role:'contact',created_at:1704153600000},{content:'Public reply',actor_role:'operator',created_at:1704153720000}])
  assert.deepEqual(await rows('SELECT content,created_at FROM move_in_notes'),[{content:'Private note',created_at:1704153660000}]);assert.equal((await rows('SELECT * FROM conversation_tags')).length,1)
  assert.deepEqual(await rows('SELECT assigned_to FROM conversations'),[{assigned_to:null}]);assert.deepEqual(await rows("SELECT is_verified FROM contacts WHERE email='ada@example.test'"),[{is_verified:0}]);assert.equal((await rows('SELECT bot_enabled FROM context_subjects'))[0].bot_enabled,0)
 }})
 const tagged={user:{...user.user,tags:['contact-only']}},plain={ticket:{...ticket.ticket,comments:ticket.ticket.comments.map(comment=>({...comment,plain_body:'Exported plain body'}))}}
 await imported('zendesk',ndjson(tagged,staff,plain),{check:async({rows})=>{assert.deepEqual(JSON.parse((await rows("SELECT metadata_json FROM contacts WHERE email='ada@example.test'"))[0].metadata_json).imported_tags,['contact-only']);assert.equal((await rows("SELECT * FROM workspace_tags WHERE name='contact-only'")).length,0);assert.deepEqual((await rows('SELECT content FROM messages')).map(row=>row.content),['Exported plain body','Exported plain body'])}})
 for(const [change,reason] of [[{comments:[]},'ticket_comments_required'],[{comments:[{id:9,author_id:1,body:'Body',created_at:'2024-01-02T00:00:00Z'}]},'comment_visibility_required'],[{comments:[{id:9,author_id:99,body:'Body',public:true,created_at:'2024-01-02T00:00:00Z'}]},'comment_author_role_missing']])await imported('zendesk',ndjson(user,{ticket:{...ticket.ticket,...change}}),{apply:false,check:({rejection})=>assert.equal(rejection('ticket/42'),reason)})
 await imported('zendesk',ndjson({article:{id:8,title:'Restricted',body:'Private',draft:false,user_segment_id:123,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-01T00:00:00Z'}},{macro:{id:7,restriction:{type:'Group',id:1},actions:[]}}),{apply:false,check:({rejection})=>{assert.equal(rejection('article/8'),'restricted_article_not_imported');assert.equal(rejection('macro/7'),'restricted_macro_not_imported')}})
 await imported('zendesk',ndjson({user:{...user.user,created_at:'2024-02-30T00:00:00Z'}}),{apply:false,check:({rejection})=>assert.equal(rejection('user/1'),'original_timestamp_missing_or_invalid')})
 await imported('zendesk',ndjson({user:{...user.user,created_at:'2024-01-01T10:00:00+10:00'}}),{check:async({rows})=>assert.deepEqual(await rows('SELECT created_at FROM contacts'),[{created_at:1704067200000}])})
 await imported('zendesk','{"ticket":{"id":0}}',{name:'zero.ndjson',apply:false,check:({plan})=>assert.ok(plan.diagnostics.some(row=>row.code==='invalid_source_id'),JSON.stringify(plan.diagnostics))});await refusedUpload('zendesk','{"tickets":[]}','plural.ndjson',{code:'singular_wrapper_required'})
});
await step('Intercom lists, envelopes and lines land with original times, initial-message context, private notes and closing state; placeholders, bad part counts and unknown collections are explicit review outcomes',async()=>{
 await companyJourney(imported,'intercom')
 await imported('intercom',JSON.stringify({contacts:[contact],conversations:[{type:'conversation',id:'x'}]}),{name:'group.json',apply:false,check:({plan})=>assert.deepEqual(plan.decisions.filter(row=>['contact','conversation'].includes(row.kind)).map(row=>row.location.pointer).sort(),['/contacts/0','/conversations/0'])})
 await imported('intercom','{\n "contacts": [\n {"type":"contact","id":"a","email":"a@example.test","created_at":1704067200},\n {"type":"contact","id":"b","email":"b@example.test","created_at":1704067200}\n ],\n "conversations": [{"type":"conversation","id":"z"}]\n}',{name:'export.json',apply:false,check:({plan})=>assert.deepEqual(plan.decisions.filter(row=>['contact','conversation'].includes(row.kind)).map(row=>[row.sourceId,row.location.row]).sort(),[['a',3],['b',4],['z',6]])})
 await imported('intercom',ndjson(contact,macro),{check:async({rows})=>assert.deepEqual(await rows('SELECT content,updated_at FROM macros'),[{content:'Hello',updated_at:1704153600000}])})
 const named={type:'contact',id:'c',name:'Ada',email:'ada@example.test',created_at:1704067200},closed={...conversation,state:'closed',created_at:1704153600,updated_at:1704153720,conversation_parts:{type:'conversation_part.list',conversation_parts:[{id:'n',part_type:'note',body:'Secret note',created_at:1704153660,author:{id:'a',type:'admin'}},{id:'r',part_type:'comment',body:'Reply',created_at:1704153720,author:{id:'a',type:'admin'}}]}}
 await imported('intercom',ndjson(named,closed),{check:async({rows,omissions})=>{
  assert.deepEqual((await rows('SELECT content FROM messages ORDER BY revision')).map(row=>row.content),['First','Reply']);assert.deepEqual(await rows('SELECT content FROM move_in_notes'),[{content:'Secret note'}])
  const initial=(await rows("SELECT source_time,time_provenance FROM move_in_message_sources WHERE source_id='source:s'"))[0];assert.deepEqual(initial,{source_time:null,time_provenance:'conversation-created-context'})
  assert.deepEqual(await rows('SELECT resolved_at FROM conversations'),[{resolved_at:1704153720000}]);assert.deepEqual(await rows('SELECT source_state FROM move_in_conversations'),[{source_state:'closed'}]);assert.ok(omissions('conversation/v').includes('closed_in_source_closing_time_is_last_update'))
 }})
 const placeholders=[{body:'Hi',body_text:'Hi {{user.name|fallback:"there"}}'},{body:'<p>Hi <attribute key="user.name" default="there"/></p>'},{body:'<p>Hi <attribute key="company.custom" default="friend"></attribute></p>'},{body:'<p>Hi</p>',body_text:'Hi {{user.name|fallback:"there"}}'},{body:'{% if user %}Hello{% endif %}'},{body:'<p>Hi <attribute key="any.field"/></p>',body_text:'Hi'}]
 await imported('intercom',ndjson(...placeholders.map((change,i)=>({...macro,id:`m${i}`,...change}))),{apply:false,check:({rejection})=>{for(let i=0;i<placeholders.length;i++)assert.equal(rejection(`macro/m${i}`),'macro_placeholders_not_supported')}})
 const counts=['0',null,false,-1,0.5,Number.MAX_SAFE_INTEGER+1,1]
 await imported('intercom',ndjson(contact,...counts.map((count,i)=>({...conversation,id:`v${i}`,conversation_parts:{...conversation.conversation_parts,total_count:count}})),{...conversation,id:'ok-plain'},{...conversation,id:'ok-zero',conversation_parts:{...conversation.conversation_parts,total_count:0}}),{apply:false,check:({rejection})=>{for(let i=0;i<counts.length;i++)assert.equal(rejection(`conversation/v${i}`),'conversation_parts_count_invalid_or_incomplete',String(counts[i]));assert.equal(rejection('conversation/ok-plain'),undefined);assert.equal(rejection('conversation/ok-zero'),undefined)}})
 await imported('intercom',JSON.stringify(contact)+'\n'+JSON.stringify(conversation).replace('"conversation_parts":[]','"conversation_parts":[],"total_count":1e400'),{apply:false,check:({plan})=>assert.ok(plan.diagnostics.some(row=>row.code==='conversation_parts_count_invalid_or_incomplete'&&row.location.row===2))})
 await imported('intercom','{\n"contacts":['+JSON.stringify(contact)+'],\n"companies":[{"type":"company","id":"co"},{"id":"co2"}],\n"segments":[],\n"unknown_metadata":{"note":"retained only"},\n"type":"list","total_count":1,"pages":{}\n}',{name:'source.json',check:async({plan,rows})=>{
  assert.equal(plan.counts.effects,1);assert.ok(plan.decisions.some(row=>row.kind==='company'&&row.sourceId==='co'&&row.rejection),'an incomplete documented company is refused');const omitted=plan.decisions.filter(row=>row.omissions.some(item=>item.reason.startsWith('unsupported_record_kind:')))
  assert.deepEqual(omitted.map(row=>row.location),[{artifact:'source.json',row:3,pointer:'/companies/1'},{artifact:'source.json',row:4,pointer:'/segments'},{artifact:'source.json',row:5,pointer:'/unknown_metadata'}]);assert.equal((await rows('SELECT * FROM contacts')).length,1)
 }})
 await imported('intercom','{"type":"li\\u0073t","companies":[{"id":"one"}],"unknown":null}',{name:'escaped.json',apply:false,check:({plan})=>{assert.equal(plan.decisions.length,2);assert.equal(plan.decisions.filter(row=>row.omissions.length).length,2)}})
 await imported('intercom',JSON.stringify({...contact,unknown_feature:{private:'kept only in original'}}),{check:({omissions})=>assert.deepEqual(omissions('contact/c'),['unsupported_source_field:unknown_feature'])})
 // Malformed tokens are refused at their own line and path, not the last good record.
 for(const [body,row,pointer] of [[' \n {\n "contacts":['+JSON.stringify(contact)+'],\n "later": nope\n }',4,'/later'],['{\n"contacts":['+JSON.stringify(contact)+'],\n"conversations":[\n {"type":"conversation","id":"a"},\n nope\n]}',5,'/conversations/1'],['{\n"contacts":['+JSON.stringify(contact)+'],\n"later": [1,\n]\n}',4,'/later/1'],[' \n {"type":"contact",\n "id": nope}',3,'/id'],['{\n"contacts":['+JSON.stringify(contact)+'],\n invalid: 1}',3,''],['{\n"type":"contact",\n"id":"bad\\\nvalue"\n}',3,'/id']])await refusedUpload('intercom',body,'source.json',{row,pointer})
 await refusedUpload('intercom','{}','report.csv',{code:'unsupported_file_extension'})
});
await step('Freshdesk tickets keep the description first, private notes, staff as authors and the resolved time; signed download links are refused',async()=>{
 await companyJourney(imported,'freshdesk')
 const {contact:person,agent,ticket:freshTicket,cannedResponse}=await import('./freshdesk-fixtures.mjs')
 await imported('freshdesk',ndjson(person,agent,freshTicket(5001,4),freshTicket(5002,2),freshTicket(5003,5),freshTicket(5004,3),cannedResponse),{check:async({plan,omissions,rows})=>{
  assert.equal(plan.counts.rejected,0);const solved=(await rows("SELECT c.id,c.resolved_at,c.assigned_to FROM conversations c JOIN move_in_origins o ON o.target_id=c.id WHERE o.source_id='5001'"))[0]
  assert.deepEqual((await rows(`SELECT content,actor_role FROM messages WHERE conversation_id='${solved.id}' ORDER BY revision`)).map(row=>[row.content,row.actor_role]),[['Where is my refund?','contact'],['Refund sent.','operator'],['Thanks!','contact']])
  assert.deepEqual((await rows(`SELECT content FROM move_in_notes WHERE conversation_id='${solved.id}'`)).map(row=>row.content),['Private triage']);assert.equal(solved.resolved_at,Date.UTC(2024,0,2,9,30));assert.equal(solved.assigned_to,null)
  assert.equal((await rows("SELECT c.resolved_at FROM conversations c JOIN move_in_origins o ON o.target_id=c.id WHERE o.source_id='5002'"))[0].resolved_at,null)
  const categories=await rows("SELECT o.source_id,c.status_category,c.channel FROM conversations c JOIN move_in_origins o ON o.target_id=c.id AND o.target_kind='conversation' ORDER BY o.source_id");assert.deepEqual(categories.map(row=>[row.source_id,row.status_category,row.channel]),[['5001','solved','email'],['5002','open','email'],['5003','closed','email'],['5004','pending','email']])
  assert.deepEqual(await rows('SELECT content FROM macros'),[{content:'Refunds take 5 days.'}]);assert.equal(plan.decisions.find(row=>row.kind==='agent').targets.length,0);assert.ok(omissions('ticket/5001').includes('attachments_metadata_retained_bytes_not_imported'))
 }})
 await refusedUpload('freshdesk',JSON.stringify({contact:{...person.contact,avatar:{avatar_url:'https://s3.example.test/a.png?X-Amz-Signature=abc'}}}),'signed.ndjson',{code:'signed_download_link_not_accepted'})
});
await step('one Intercom source in four packagings and a ZIP of all of them map the same five records exactly once',async()=>{
 const {intercomRecords}=await import('./record-inputs.mjs'),records=intercomRecords(),values=Object.values(records)
 const packages=[['separate.jsonl',values.map(JSON.stringify).join('\n')],['array.json',JSON.stringify(values)],['list.json',JSON.stringify({type:'list',data:values,total_count:4,pages:null})],['collections.json',JSON.stringify({contacts:[records.contact],conversations:[records.conversation],macros:[records.macro],articles:[records.article],pages:{}})]]
 for(const [name,body] of packages)await imported('intercom',body,{name,check:async({plan,rows})=>{
  assert.equal(plan.counts.rejected,0);assert.deepEqual(plan.decisions.filter(row=>row.targets.length).map(row=>`${row.kind}/${row.sourceId}`).sort(),['article/article-39','contact/person-31','conversation/conversation-32','macro/macro-38','tag-name/returns'])
  assert.deepEqual(await rows('SELECT name FROM contacts'),[{name:'Mara'}]);assert.deepEqual((await rows('SELECT content FROM messages'))[0],{content:'Opening message'});assert.deepEqual(await rows('SELECT content FROM move_in_notes'),[{content:'Private note'}]);assert.deepEqual(await rows('SELECT content FROM macros'),[{content:'Hello Mara'}]);assert.deepEqual(await rows('SELECT status FROM knowledge_articles'),[{status:'draft'}])
 }})
 await imported('intercom',zip(packages.map(([name,body])=>({name:'nested/'+name,body}))),{name:'multi.zip',check:async({plan,rows})=>{assert.equal(plan.counts.unique,5);assert.equal(plan.counts.duplicates,plan.counts.input-plan.counts.unique);assert.ok(plan.counts.duplicates>0);assert.deepEqual([...new Set(plan.decisions.map(row=>`${row.kind}/${row.sourceId}`))].sort(),['article/article-39','contact/person-31','conversation/conversation-32','macro/macro-38','tag-name/returns'])}})
});
await step('Zendesk macros translate placeholders and four actions into native preview and guarded manual apply',async()=>{
 await configurationJourney()
 await configurationFieldsJourney(imported)
 const body=ndjson(user,staff,ticket,{macro:{id:81,title:'Refund follow-up',restriction:null,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',actions:[
  {field:'comment_value',value:'Hello {{ticket.requester.first_name}}, about {{ticket.title}}.'},
  {field:'priority',value:'high'},{field:'status',value:'pending'},{field:'current_tags',value:'refund-followup'},
 ]}})
 await imported('zendesk',body,{check:async({h,plan,review,rows})=>{
  assert.equal(plan.counts.rejected,0)
  const macro=(await rows('SELECT id FROM macros'))[0],conversation=(await rows('SELECT id,ticket_version,priority,status_id FROM conversations'))[0]
  const native='/api/dashboard/projects/p',definition=(await h.call(`${native}/macros/${macro.id}`)).data
  assert.equal(definition.content,'Hello {{requester.first_name}}, about {{ticket.subject}}.')
  assert.equal(definition.actions.priority,'high');assert.equal(definition.actions.status_id,'pending');assert.equal(definition.actions.tags_add.length,1)
  assert.equal(conversation.priority,'normal');assert.notEqual(conversation.status_id,'pending')
  const preview=await h.call(`${native}/macros/${macro.id}/preview`,post({version:1,conversation_id:conversation.id,expected_ticket_version:conversation.ticket_version}))
  assert.equal(preview.data.results[0].status,'ready',JSON.stringify(preview))
  assert.match(preview.data.results[0].draft.content,/Hello Ada, about Quoted/)
  assert.equal((await rows('SELECT COUNT(*) n FROM messages'))[0].n,2)
  const repeated=await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'repeat.ndjson'},body:'\n'+body})
  await h.drain();const repeat=(await h.call(`${root}/${repeated.data.id}`)).data
  assert.equal(repeat.plan.counts.rejected,0)
  await h.call(`${root}/${repeat.id}/apply`,post({fingerprint:repeat.plan.fingerprint}));await h.drain()
  assert.equal((await rows('SELECT count(*) n FROM macro_versions'))[0].n,1)
  assert.deepEqual((await h.call(`${native}/macros/${macro.id}`)).data.actions,definition.actions)
  // A native edit must be visible to Move in, so undo cannot discard reviewed changes.
  const current=(await h.call(`${native}/macros/${macro.id}`)).data
  await h.call(`${native}/macros/${macro.id}`,{...post({...current,title:'Reviewed native macro',expected_version:1}),method:'PUT'})
  await h.call(`${root}/${review.id}/undo`,post({}))
  await h.drain()
  assert.equal((await rows('SELECT title FROM macros'))[0].title,'Reviewed native macro')
 }})
 await imported('zendesk',body,{withConversations:true,check:async({h,rows})=>{
  const macro=(await rows('SELECT id FROM macros'))[0],conversation=(await rows('SELECT id,ticket_version FROM conversations'))[0],native='/api/dashboard/projects/p'
  const result=await h.call(`${native}/macros/${macro.id}/apply`,post({version:1,conversation_id:conversation.id,expected_ticket_version:conversation.ticket_version,command_id:'synthetic-happytohelp-1'}))
  assert.equal(result.data.results[0].status,'applied',JSON.stringify(result))
  const changed=(await rows('SELECT status_id,priority FROM conversations'))[0]
  assert.deepEqual(changed,{status_id:'pending',priority:'high'})
  assert.equal((await rows("SELECT count(*) n FROM conversation_tags ct JOIN workspace_tags t ON t.id=ct.tag_id WHERE t.name='refund-followup'"))[0].n,1)
  assert.match((await h.call(`${native}/conversations/${conversation.id}/macro-draft`)).data.content,/Hello Ada, about Quoted/)
  assert.equal((await rows('SELECT count(*) n FROM messages'))[0].n,2,'manual macro use drafts the reply; it never sends it')
 }})
 await imported('zendesk',ndjson({macro:{id:82,title:'Private reply',restriction:null,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',actions:[{field:'comment_value',value:'Note {{ticket.unknown}}'},{field:'comment_mode_is_public',value:false},{field:'assignee_id',value:2}]}}),{check:async({omissions,rows})=>{
  assert.ok(omissions('macro/82').includes('macro_placeholder_unsupported:ticket.unknown'))
  assert.ok(omissions('macro/82').includes('macro_action_unsupported:assignee_id'))
  assert.equal(JSON.parse((await rows('SELECT actions_json FROM macro_versions'))[0].actions_json).reply_type,'note')
 }})
 await imported('zendesk',ndjson({macro:{id:83,title:'Dynamic link',restriction:null,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',actions:[{field:'comment_value_html',value:'<a href="{{ticket.url}}">Open ticket</a>'}]}}),{apply:false,check:({rejection})=>assert.equal(rejection('macro/83'),'macro_attribute_placeholders_not_supported')})
})
});

test("helpscout: Help Scout conversations and Docs publish only complete public content, recheck category privacy, and keep undo and erasure safe",async()=>{
await step('Help Scout responses and Docs map only documented, complete and public content; incomplete history, unsent threads and ambiguous drafts never publish',async()=>{
 await companyJourney(imported,'helpscout')
 const {responses,customer,history,docs}=await import('./helpscout-fixtures.mjs')
 await imported('helpscout',JSON.stringify({responses:responses()}),{name:'export.json',check:async({plan,rows})=>{
  assert.equal(plan.counts.rejected,0)
  assert.deepEqual((await rows('SELECT content,actor_role FROM messages ORDER BY revision')).map(row=>[row.content,row.actor_role]),[['Please help','contact'],['Historical reply','operator']])
  assert.deepEqual(await rows('SELECT content,created_at FROM move_in_notes'),[{content:'Private note',created_at:1704067290000}]);assert.deepEqual((await rows('SELECT email FROM contacts')).map(row=>row.email),['ada@example.test'])
  assert.deepEqual((await rows('SELECT status FROM knowledge_articles ORDER BY status DESC')).map(row=>row.status),['published','draft']);assert.equal((await rows('SELECT * FROM macros')).length,0)
 }})
 for(const [mutate,reason] of [[h=>{h.conversation._embedded={threads:h.page._embedded.threads};h.page=null},'thread_pages_required_embedded_history_not_complete'],[h=>{h.conversation.type='chat';h.conversation._embedded={threads:h.page._embedded.threads};h.page=null},'thread_pages_required_embedded_history_not_complete'],[h=>{h.page.page.totalPages=2;h.page.page.totalElements=4},'thread_pages_incomplete'],[h=>{h.page._links.next={href:'https://api.helpscout.net/v2/conversations/901/threads?page=2'}},'thread_terminal_page_missing'],[h=>{h.page.page.totalElements=4},'thread_total_incomplete'],[h=>{h.page._embedded.threads[1].body=null},'thread_body_required'],[h=>{h.page._embedded.threads[0].state='unknown';h.conversation.threads=1},'thread_state_unknown'],[h=>{h.page._embedded.threads[1].id=h.page._embedded.threads[0].id},'duplicate_thread_id'],[h=>{h.conversation.threads=3},'published_non_note_thread_count_mismatch']]){
  const h=history();mutate(h);await imported('helpscout',[customer(),h.conversation,h.page].filter(Boolean).map(JSON.stringify).join('\n'),{apply:false,check:({rejection,plan})=>{assert.equal(rejection('conversation/901'),reason,reason);assert.equal(plan.decisions.find(row=>row.kind==='conversation').targets.length,0)}})
 }
 const unsent=history();unsent.page._embedded.threads.push(...['draft','bounced','hidden','review','underreview'].map((state,i)=>({id:9900+i,type:'message',state,body:`Unsafe ${state}`,createdAt:'2024-01-01T00:01:00Z'})));unsent.page.page.totalElements=8
 await imported('helpscout',[customer(),unsent.conversation,unsent.page].map(JSON.stringify).join('\n'),{check:async({omissions,rows})=>{assert.equal((await rows('SELECT * FROM messages')).length,2);assert.equal(omissions('conversation/901').filter(reason=>reason.startsWith('unsent_or_hidden_thread')).length,5);assert.doesNotMatch(JSON.stringify(await rows('SELECT content FROM messages')),/Unsafe/)}})
 const paged=history(),first=structuredClone(paged.page),last=structuredClone(paged.page);first.page={number:1,size:2,totalElements:3,totalPages:2};first._embedded.threads=paged.page._embedded.threads.slice(0,2);first._links.next={href:'https://api.helpscout.net/v2/conversations/901/threads?page=2'};last.page={number:2,size:2,totalElements:3,totalPages:2};last._embedded.threads=paged.page._embedded.threads.slice(2);last._links.self.href+='?page=2'
 await imported('helpscout',[customer(),paged.conversation,first,last].map(JSON.stringify).join('\n'),{check:async({plan,rows})=>{assert.equal(plan.counts.rejected,0);assert.equal((await rows('SELECT * FROM move_in_notes')).length,1)}})
 for(const [change,expected] of [[rows=>{rows[0].collections.items[0].visibility='private'},'draft'],[rows=>{rows[1].categories.items[0].visibility='private'},'draft'],[rows=>{delete rows[1].categories.items[0].visibility},'article_ancestry_incomplete_or_conflicting'],[rows=>{rows[2].article.status='unknown'},'article_publication_required'],[rows=>{delete rows[2].article.text},'article_body_required'],[rows=>rows[0].collections.pages=2,'article_ancestry_incomplete_or_conflicting'],[rows=>rows[1].categories.count=2,'article_ancestry_incomplete_or_conflicting'],[rows=>{rows[2].article.hasDraft=true;rows[2].article.text='Could be draft-request body'},'draft']]){
  const rows=docs();change(rows);await imported('helpscout',rows.map(JSON.stringify).join('\n'),{apply:expected==='draft',check:async({rejection,rows:read})=>{if(expected==='draft')assert.ok((await read('SELECT status FROM knowledge_articles')).every(row=>row.status==='draft'),'nothing private, unknown or ambiguous is published');else assert.equal(rejection('article/article-1'),expected)}})
 }
 const rows=docs(),draft=structuredClone(rows[2]);draft.article.text='Unpublished edits'
 await imported('helpscout',JSON.stringify({responses:rows,articleDrafts:[draft],articles:[{id:'ref-only',collectionId:'collection-1',name:'Only metadata',status:'published',hasDraft:false}]}),{name:'docs.json',check:async({rows:read})=>{const contents=(await read('SELECT title,content FROM knowledge_articles')).map(row=>row.content);assert.ok(contents.includes('Public help'));assert.ok(!contents.includes('Unpublished edits'),'an article draft request never replaces published content');assert.equal((await read("SELECT * FROM knowledge_articles WHERE title='Only metadata'")).length,0)}})
});
});
