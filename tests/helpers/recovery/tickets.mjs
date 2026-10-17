import assert from 'node:assert/strict';
import {seedRecoveryWorkflows,verifyRecoveryWorkflows} from './workflows.mjs';

export async function seedRecoveryTicket(runtime, owner, conversation) {
 const base=`/api/dashboard/projects/${owner.projectId}`;
 const request=async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(runtime.origin+base+path,{method,headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.ok(response.ok,await response.clone().text());return (await response.json()).data;
 };
 const me=await fetch(runtime.origin+'/api/management/bootstrap',{headers:{Authorization:`Bearer ${owner.token}`}}).then(response=>response.json());
 const group=await request('/ticket-groups',{name:'Recovery team',members:[me.currentAgent.id]});
 const field=await request('/ticket-fields',{name:'Order reference',type:'text'});
 const status=await request('/ticket-statuses',{name:'Waiting for carrier',category:'pending'});
 await request(`/conversations/${conversation.id}/ticket`,{subject:'Retain this ticket and its history',priority:'high',group_id:group.id,agent_id:me.currentAgent.id,status_id:status.id,fields:{[field.id]:'REC-48213'}},'PATCH');
 await request('/ticket-views',{name:'Carrier follow-up',visibility:'shared',filters:[{field:'status_id',operator:'eq',value:status.id}],sort:[{field:'priority',direction:'desc'}]});
 const recoveryWorkflows=await seedRecoveryWorkflows(runtime,owner,conversation,{operatorId:me.currentAgent.id,groupId:group.id,fieldId:field.id});
 return {...await request(`/conversations/${conversation.id}/ticket`),recoveryWorkflows};
}

export async function verifyRecoveryTicket(runtime,state){
 const response=await fetch(`${runtime.origin}/api/dashboard/projects/${state.owner.projectId}/conversations/${state.conversation.id}/ticket`,{headers:{Authorization:`Bearer ${state.owner.token}`}});
 assert.equal(response.status,200);const actual=(await response.json()).data;
 for(const key of ['subject','priority','status_id','status_category','group_id','agent_id','fields','history'])assert.deepEqual(actual[key],state.ticket[key],`retained ticket ${key}`);
 await verifyRecoveryWorkflows(runtime,state.owner,state.conversation,state.ticket.recoveryWorkflows);
}
