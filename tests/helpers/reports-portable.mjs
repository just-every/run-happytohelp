import assert from 'node:assert/strict';
import {archiveStorage} from './rer-archive.mjs';

export async function seedReportsPortable(origin,projectId,contactId,incidentId,visitorToken,token){
 const base=`/api/dashboard/projects/${projectId}`;
 const api=async(path,body,method=body?'POST':'GET',as=token)=>{
  const response=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+as,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,await response.clone().text());const data=await response.json();return data.data??data;
 };
 const timer=await api(`${base}/conversations/${incidentId}/timer/start`,{});
 await api(`${base}/conversations/${incidentId}/timer/stop`,{});
 await api(`${base}/conversations/${incidentId}/timer/adjust`,{sessionId:timer.running,durationMs:60000,reason:'Retained archive handle time'});
 const problem=await api('/api/conversations',{projectId,contactId});
 await api(`/api/conversations/${problem.id}/messages`,{localId:'archive-problem',content:'Track the retained parcel incident',expectedRevision:0},'POST',visitorToken);
 const path=`${base}/conversations/${problem.id}/ticket/problem`,frontier=(await api(path)).ticket;
 await api(path,{...frontier,is_problem:true},'PATCH');
 const incident=(await api(`${base}/conversations/${incidentId}/ticket/problem`)).ticket;
 await api(path+'/incidents/preview',{action:'link',tickets:[incident]});
 const linked=await api(path+'/incidents/apply',{action:'link',tickets:[incident]});assert.equal(linked.results[0].status,'applied');
 const preview=await api(path+'/solve/preview',{reply:'The retained parcel is ready.',solve_incidents:true});
 const solved=await api(path+'/solve/apply',{preview_id:preview.preview_id});assert.equal(solved.results[0].status,'solved');
 const resolution=(await api(`/api/conversations/${incidentId}/messages`,undefined,'GET',visitorToken)).resolution;
 assert.ok(resolution);
 await api(`/api/conversations/${incidentId}/widget-events`,{action:'rateResolution',data:{resolutionId:resolution.id,value:-1,recovery:'not_recovered',comment:'Retain the customer recovery outcome'}},'POST',visitorToken);
 const owner=await api('/api/identity/session');
 const schedule=await api(base+'/report-schedules',{name:'Retained leadership report',frequency:'weekly',hour:9,weekday:1,recipients:[owner.id]});
 return {projectId,incidentId,problemId:problem.id,previewId:preview.preview_id,scheduleId:schedule.id,recipientId:owner.id};
}

/** Recovery fixture at the stopped storage boundary: the process died after its
 * durable claim and before an observable provider result. Import must fence it. */
export async function seedReportClaimedRecovery(root,state){
 await archiveStorage(root,async({DB})=>DB.prepare("INSERT INTO report_schedule_deliveries(id,schedule_id,project_id,window_date,recipient_id,state,claimed_at) VALUES(?,?,?,'2026-10-19',?,'claimed',?)").bind('fixture-report-claim-'+state.scheduleId,state.scheduleId,state.projectId,state.recipientId,Date.now()).run());
}
export async function verifyReportsPortable(origin,state,token,json){
 const base=`/api/dashboard/projects/${state.projectId}`;
 const timer=await json(`${base}/conversations/${state.incidentId}/timer`,undefined,token);assert.equal(timer.totalMs,60000);assert.equal(timer.running,null);
 const problem=(await json(`${base}/conversations/${state.problemId}/ticket/problem`,undefined,token)).data;assert.equal(problem.incident_count,1);assert.equal(problem.recent_preview_id,state.previewId);
 const result=(await json(`${base}/conversations/${state.problemId}/ticket/problem/solve/${state.previewId}`,undefined,token)).data;assert.equal(result.results[0].status,'solved');
 const schedules=await json(base+'/report-schedules',undefined,token);assert.equal(schedules.schedules.find(s=>s.id===state.scheduleId).paused,true);
 const outcomes=await json(`/api/outcomes/projects/${state.projectId}/results`,undefined,token),response=outcomes.results.find(row=>row.conversationId===state.incidentId).response;
 assert.equal(response.recovery,'not_recovered');assert.equal(response.comment,'Retain the customer recovery outcome');
}
