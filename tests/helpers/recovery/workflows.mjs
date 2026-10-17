import assert from 'node:assert/strict';

function dashboard(runtime,owner){
 const base=`${runtime.origin}/api/dashboard/projects/${owner.projectId}`;
 return async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.ok(response.ok,await response.clone().text());return response.json();
 };
}
async function workflowSnapshot(call,conversationId,ids){
 const [calendars,policies,rules,routing,ticket]=await Promise.all([
  call('/workflow-calendars'),call('/sla-policies'),call('/workflow-rules'),call('/routing-operators'),call(`/conversations/${conversationId}/workflows`),
 ]);
 const result={
  calendar:calendars.data.find(row=>row.id===ids.calendar),
  policy:policies.data.find(row=>row.id===ids.policy),
  rule:rules.rules.find(row=>row.id===ids.rule),
  operator:routing.operators.find(row=>row.user_id===ids.operator),
  ticket:ticket.data,
 };
 for(const [kind,value] of Object.entries(result))assert.ok(value,`Recovery workflow ${kind} is present`);
 return result;
}

export async function seedRecoveryWorkflows(runtime,owner,conversation,{operatorId,groupId,fieldId}){
 const call=dashboard(runtime,owner);
 const {data:calendar}=await call('/workflow-calendars',{
  name:'Carrier support hours',timezone:'America/New_York',
  weekly:[1,2,3,4,5].flatMap(day=>[{day,start:'09:00',end:'12:00'},{day,start:'13:00',end:'17:00'}]),
  holidays:'us_federal',closures:['2026-11-27'],active:true,
 });
 // Retain a complete policy definition without recalculating ticket clocks on
 // reads or creating an alert whose delivery could change the exact snapshot.
 const {data:policy}=await call('/sla-policies',{
  name:'Carrier response commitments',calendar_id:calendar.id,position:10,
  conditions:{priorities:['high'],plans:[],channels:['widget'],brands:[owner.projectId]},
  first_response_minutes:60,next_response_minutes:120,resolution_minutes:480,
  pause_on_hold:true,approaching_minutes:15,unattended_minutes:180,
  backup_user_ids:[operatorId],active:false,
 });
 await call('/routing-operators',{operators:[{user_id:operatorId,available:false,capacity:3,skills:['shipping','returns']}]},'PUT');
 const {rule}=await call('/workflow-rules',{
  name:'Carrier update hand-off',kind:'event',position:25,event_kind:'customer_reply',
  conditions:{all:[{field:'status_category',op:'eq',value:'pending'},{field:`field:${fieldId}`,op:'eq',value:'REC-48213'}],any:[]},
  actions:[{type:'assign',user_id:operatorId,group_id:groupId},{type:'note',content:'Review the carrier update before replying.'}],
 });
 const preview=await call(`/workflow-rules/${rule.id}/preview`,{});
 assert.equal(preview.side_effects,false,'Recovery rule preview is read-only');
 await call(`/workflow-rules/${rule.id}/publish`,{});
 const {rule:paused}=await call(`/workflow-rules/${rule.id}/pause`,{});
 assert.equal(paused.state,'paused','Recovery rule is settled before the backup');
 // Cancel both kinds through the real schedule controls. Bodies, authority,
 // frontier and cancellation history then survive without future execution.
 const scheduleIds=[];
 for(const kind of ['reply','snooze']){
  const {data:schedule}=await call('/workflow-schedules',{
   conversation_id:conversation.id,kind,due_at:Date.now()+7*86400000,
   timezone:'America/New_York',owner_id:operatorId,
   ...(kind==='reply'?{body:'We will share the carrier update after reviewing your order.'}:{}),
  });
  const {data:cancelled}=await call(`/workflow-schedules/${schedule.id}`,{action:'cancel'},'PATCH');
  assert.equal(cancelled.state,'cancelled','Recovery schedule is settled before the backup');
  scheduleIds.push(schedule.id);
 }
 const ids={calendar:calendar.id,policy:policy.id,rule:rule.id,operator:operatorId};
 const snapshot=await workflowSnapshot(call,conversation.id,ids);
 assert.ok(snapshot.rule.versions.length,'Recovery retains an immutable published rule version');
 for(const id of scheduleIds)assert.ok(snapshot.ticket.schedules.some(row=>row.id===id&&row.state==='cancelled'),'Recovery retains each cancelled schedule');
 return {ids,snapshot};
}

export async function verifyRecoveryWorkflows(runtime,owner,conversation,expected){
 const actual=await workflowSnapshot(dashboard(runtime,owner),conversation.id,expected.ids);
 for(const key of ['calendar','policy','rule','operator','ticket'])assert.deepEqual(actual[key],expected.snapshot[key],`retained workflow ${key}`);
}
