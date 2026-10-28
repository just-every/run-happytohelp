import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {connector} from './connector.mjs';

export const report='I cannot turn on the Spanish version of my store. Please investigate.';
export async function until(read,accept,label){
 const end=Date.now()+30000;
 while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100))}
 throw Error(label+' did not reach its expected state');
}
export function client(origin,token){return async(path,body,{method=body===undefined?'GET':'POST',status=200}={})=>{
 const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return value;
}}
export async function newVisitor({origin,api,projectId}){
 const project=await api('/api/identity/projects/'+projectId);
 const session=await client(origin)('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Journey visitor'},{status:201});
 const visitor=client(origin,session.token),conversation=await visitor('/api/conversations',{projectId},{status:201});
 session.conversationId=conversation.id;
 const transcript=()=>visitor('/api/conversations/'+conversation.id+'/messages');
 const say=async content=>{const current=await transcript();return visitor('/api/conversations/'+conversation.id+'/messages',{localId:randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId})};
 await say(report);return {session,transcript,say};
}
export async function runCase({origin,api,actor,fixture,directory,ui,continueCase}){
 const projectId=actor.projectId;
 fixture.reset();
 const visitor=ui?await ui.visitor():await newVisitor({origin,api,projectId});
 const conversationId=visitor.session.conversationId;
 const path=`/api/projects/${projectId}/conversations/${conversationId}/delegations`;
 const jobs=async()=>(await api(path)).data;
 const lookup=async id=>(await jobs()).find(job=>job.id===id);
 const transcript=()=>visitor.transcript();
 const noReply=async()=>assert.equal((await transcript()).messages.filter(message=>message.actor_role!=='contact').length,0);
 const screenshot=async(step,caption)=>ui?.shot(step,caption);
 await noReply();await ui?.open(conversationId,{panel:false});await screenshot('a','Visitor reports the disabled Spanish setting; operator sees the same report.');
 const code=ui?await ui.pair():(await api(`/api/projects/${projectId}/local-agents/pairings`,{})).data.code;
 const worker=await connector({origin,directory:join(directory,'connector'),code});
 const task=phase=>({phase,fixture:fixture.origin,conversationId,projectId});
 const delegate=async(mode,instructions)=>{
  if(ui)return ui.delegate(worker.deviceId,mode,instructions,jobs);
  return (await api(path,{device_id:worker.deviceId,mode,instructions,request_id:randomUUID()})).data;
 };
 try{
  const investigation=await delegate('investigate','Investigate the Spanish setting on the disposable fixture. Read only; propose any change for my approval.');
  assert.equal(investigation.status,'queued');assert.equal(investigation.mode,'investigate');assert.equal(investigation.operator_id,actor.id);
  assert.equal(fixture.events.length,0);await screenshot('b','Owner pairs a computer and explicitly queues an investigation of this conversation.');
  const findingReceipt=await worker.run(task('investigate'));
  const finding=await lookup(investigation.id);assert.equal(finding.status,'completed');assert.equal(finding.result.verified,true);
  assert.equal(finding.context.conversation.id,conversationId);assert.equal(finding.context.workspace.id,projectId);
  assert.equal(findingReceipt.context.conversation.id,conversationId);assert.equal(finding.result.follow_up_actions[0].mode,'resolve');
  assert.equal((await jobs()).length,1);assert.equal(fixture.enabled,false);assert.equal(fixture.events.filter(e=>e.method==='POST').length,0);await noReply();
  await ui?.refresh();await screenshot('c','Read-only findings show evidence, a proposed resolve action and an unsent reply. No customer setting has changed.');
  const approvedAt=Date.now();
  const approval=ui?await ui.approve(path,investigation.id):(await api(path+'/'+investigation.id+'/result/follow-up-actions/enable',{})).data;
  const child=await lookup(approval.child_delegation_id);assert.ok(child);assert.equal(child.parent_delegation_id,investigation.id);assert.equal(child.source_proposal_id,'enable');assert.equal(child.mode,'resolve');assert.equal(child.operator_id,actor.id);assert.equal(child.status,'queued');
  assert.ok(Date.parse(child.created_at)>=approvedAt-1000);assert.equal(fixture.enabled,false);
  const replayApproval=(await api(path+'/'+investigation.id+'/result/follow-up-actions/enable',{})).data;assert.equal(replayApproval.child_delegation_id,child.id);assert.equal((await jobs()).length,2);
  await ui?.refresh();await screenshot('d','Owner approves Enable Spanish; only now does the resolve child exist, linked to its proposal.');
  await worker.run(task('resolve'));const changed=await lookup(child.id);assert.equal(changed.status,'completed');assert.equal(fixture.enabled,true);assert.equal(fixture.events.filter(e=>e.method==='POST').length,1);
  assert.match(changed.result.summary,/independent investigation is still required/);await noReply();
  const conversation=await api('/api/conversations/'+conversationId);assert.equal(conversation.resolved_at,null);
  await ui?.refresh();await screenshot('e','Resolve changes the real loopback fixture once; its report explicitly awaits independent observation.');
  const observation=await delegate('investigate','Independently read the Spanish setting from the disposable customer system. Do not rely on the resolve report. Do not write.');
  assert.notEqual(observation.id,child.id);const readsBefore=fixture.events.filter(e=>e.method==='GET').length;
  const observationReceipt=await worker.run(task('observe'));const observed=await lookup(observation.id);
  assert.equal(observed.status,'completed');assert.equal(observed.mode,'investigate');assert.equal(observed.result.verified,true);assert.equal(observationReceipt.before.enabled,true);
  assert.equal(fixture.events.filter(e=>e.method==='GET').length,readsBefore+1);assert.equal(fixture.events.filter(e=>e.method==='POST').length,1);
  assert.notEqual(observationReceipt.before.observationId,findingReceipt.before.observationId);
  assert.ok(observed.context.internal_notes.some(n=>n.id==='delegation:'+child.id));
  await noReply();await ui?.refresh();await screenshot('f','A distinct investigation reads the customer setting itself and confirms it; the operator sees both reports.');
  const reply=observed.result.replies[0];let sent;
  if(ui)sent=await ui.send(reply,observation.id);
  else{
   const before=await transcript();
   const draft=(await api(path+'/'+observation.id+'/result/draft',{proposal_id:reply.id,expected_revision:before.revision,expected_last_message_id:before.lastMessageId})).data;
   assert.equal(draft.body,reply.body);
   const command={localId:randomUUID(),content:draft.body,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,authoring:{kind:'local',jobId:observation.id,proposalId:reply.id}};
   sent=await api('/api/conversations/'+conversationId+'/messages',command);
   const replay=await api('/api/conversations/'+conversationId+'/messages',command);assert.equal(replay.duplicate,true);assert.equal(replay.message.id,sent.message.id);
  }
  assert.equal(sent.accepted,true);assert.equal(sent.message.actor_role,'owner');assert.equal(sent.message.actor_id,actor.id);
  const after=await transcript();assert.equal(after.messages.filter(m=>m.content===reply.body).length,1);
  await ui?.received(reply.body,sent.message.id);await screenshot('g','Person selects the independently confirmed reply and presses Send; replay admits no duplicate and the visitor receives it once.');
  const final=await jobs();
  for(const job of final){assert.equal(job.operator_id,actor.id);assert.ok(job.created_at);assert.ok(Date.parse(job.started_at)>=Date.parse(job.created_at));assert.ok(Date.parse(job.completed_at)>=Date.parse(job.started_at))}
  const parent=final.find(j=>j.id===investigation.id);assert.equal(parent.result.follow_up_actions[0].child_delegation_id,child.id);
  const bucket=(await api(`/api/dashboard/projects/${projectId}/conversations/${conversationId}/buckets/${conversationId}`)).data;
  const notes=bucket.events.filter(event=>event.type==='INTERNAL_NOTE');assert.equal(notes.length,3);
  for(const job of final){const note=notes.find(n=>n.id==='delegation:'+job.id);assert.ok(note);assert.equal(note.agent_id,actor.id);assert.ok(Date.parse(note.created_at)>=Date.parse(job.started_at));assert.ok(note.content.includes(job.result.summary));assert.ok(note.content.includes(job.result.actions[0].evidence))}
  await continueCase?.({origin,api,actor,fixture,worker,visitor,path,task,lookup});
  return {projectId,conversationId,deviceId:worker.deviceId,investigationId:investigation.id,childId:child.id,observationId:observation.id,messageId:sent.message.id,jobs:final,notes,fixtureEvents:[...fixture.events],operatorId:actor.id};
 }finally{await worker.close();await visitor.close?.()}
}
