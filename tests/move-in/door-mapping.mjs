import assert from 'node:assert/strict';
import {assertBusinessEquality} from './business-equality.mjs';
import {configurationFieldsJourney} from './configuration-fields.mjs';
import {companyJourney} from './companies.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const ndjson=(...records)=>records.map(JSON.stringify).join('\n');
const user={user:{id:1,role:'end-user',name:'Ada',email:'ada@example.test',created_at:'2024-01-01T00:00:00Z'}};
const staff={user:{id:2,role:'agent',name:'Teammate',email:'staff@example.test',created_at:'2024-01-01T00:00:00Z'}};
const ticket={ticket:{id:42,requester_id:1,subject:'Quoted "subject" مرحبا',created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:02:00Z',status:'open',tags:[' Billing ','billing'],comments:[{id:9,author_id:1,body:'Customer <script>inert</script>',public:true,created_at:'2024-01-02T00:00:00Z'},{id:10,author_id:2,body:'Private note',public:false,created_at:'2024-01-02T00:01:00Z'},{id:11,author_id:2,body:'Public reply',public:true,created_at:'2024-01-02T00:02:00Z'}]}};



const contact={type:'contact',id:'c',email:'person@example.test',created_at:1704067200};
const macro={type:'macro',id:'m',name:'Reply',body:'Hello',body_text:'Hello',visible_to:'everyone',available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'};
const conversation={type:'conversation',id:'v',state:'open',channel:{initial:'messenger'},created_at:1704067200,updated_at:1704067200,contacts:{type:'contact.list',contacts:[{id:'c'}]},source:{id:'s',body:'First',author:{type:'contact',id:'c'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[]}};









// Imported macros are manual commands: preview is pure and apply creates a
// composer draft, never a sent message. Repeat and undo cover their full version.



async function configurationJourney(imported){
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
}
export async function configurationLifecycle(h){
 const imported=async(vendor,body,{before,check}={})=>{
  const initial=await before?.(h),sent=await h.call(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'configuration.jsonl','X-Import-Schema':'2.16'},body});
  await h.drain();const review=(await h.call(`${root}/${sent.data.id}`)).data,plan=review.plan;
  const rejection=key=>plan.decisions.find(row=>`${row.kind}/${row.sourceId}`===key)?.rejection;
  const omissions=key=>plan.decisions.find(row=>`${row.kind}/${row.sourceId}`===key)?.omissions.map(item=>item.reason);
  await h.call(`${root}/${review.id}/apply`,post({fingerprint:plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${review.id}`)).data.state,'completed');
  await check({h,initial,review,plan,rejection,omissions,rows:async sql=>(await h.db.prepare(sql).all()).results});assert.equal(h.outbound,0);
 };
 for(const vendor of ['zendesk','intercom','helpscout','freshdesk'])await companyJourney(imported,vendor);
 await configurationFieldsJourney(imported);await configurationJourney(imported);
}
