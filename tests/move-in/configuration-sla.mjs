import assert from 'node:assert/strict'
import {startApp} from '../journeys/kit/app.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}
export const slaSchedule={schedule:{id:501,name:'Reviewed UTC support',time_zone:'UTC',intervals:[1,2,3,4,5].map(day=>({start_time:day*1440+540,end_time:day*1440+1020})),holidays:[{start_date:'2026-11-26',end_date:'2026-11-26'}],...dates}}
export const slaSource={sla_policy:{id:502,title:'Normal first response',position:0,filter:{all:[],any:[]},move_in_schedule_id:501,policy_metrics:[{priority:'normal',metric:'first_reply_time',target:120,business_hours:true}],...dates}}
const jsonl=(...records)=>records.map(JSON.stringify).join('\n'),post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export async function configurationSlaJourney(imported){
 const unsupported=structuredClone(slaSource);unsupported.sla_policy.id=503;unsupported.sla_policy.title='Unsupported multi-target policy';unsupported.sla_policy.policy_metrics.push({...unsupported.sla_policy.policy_metrics[0],metric:'next_reply_time'})
 const source=jsonl(slaSchedule,slaSource,unsupported)
 await imported('zendesk',source,{before:h=>h.snapshot(),check:async({h,initial,review,plan,omissions,rejection,rows})=>{
  assert.equal(plan.counts.rejected,1)
  assert.equal(rejection('sla_policy/503'),'sla_policy_single_metric_required')
  assert.equal(plan.decisions.find(d=>d.sourceId==='503').location.row,3)
  const target=plan.decisions.find(d=>d.sourceId==='502').targets[0];assert.equal(target.status,'inactive');assert.equal(target.label,'Normal first response')
  assert.ok(omissions('sla_policy/502').includes('sla_policy_calendar_reviewed:501:Reviewed UTC support'));assert.ok(omissions('sla_policy/502').includes('sla_policy_commitment_reviewed:normal:120'))
  const p=(await h.call('/api/dashboard/projects/p/sla-policies')).data[0]
  assert.equal(p.active,false);assert.deepEqual(p.conditions.priorities,['normal']);assert.equal(p.first_response_minutes,120);assert.equal(p.next_response_minutes,null);assert.equal(p.resolution_minutes,null)
  assert.equal((await rows('SELECT count(*) n FROM sla_alerts'))[0].n,0)
  const snapshot=await h.snapshot(),repeat=(await h.call('/api/move-in/projects/p/imports?vendor=zendesk',{method:'POST',headers:{'X-Import-Filename':'sla-repeat.jsonl'},body:source+'\n\n\n\n'})).data
  await h.drain();const ready=(await h.call(`/api/move-in/projects/p/imports/${repeat.id}`)).data
  await h.call(`/api/move-in/projects/p/imports/${repeat.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assertBusinessEquality(snapshot,await h.snapshot())
  await h.call(`/api/move-in/projects/p/imports/${review.id}/undo`,post({}));await h.drain();assertBusinessEquality(initial,await h.snapshot())
 }})
 await imported('zendesk',source,{check:async({h,review})=>{
  const policy=(await h.call('/api/dashboard/projects/p/sla-policies')).data[0]
  await h.call('/api/dashboard/projects/p/sla-policies/'+policy.id,{...post({name:'Reviewed inactive policy',expected_updated_at:policy.updated_at}),method:'PATCH'})
  await h.call(`/api/move-in/projects/p/imports/${review.id}/undo`,post({}));await h.drain()
  assert.equal((await h.call('/api/dashboard/projects/p/sla-policies')).data[0].name,'Reviewed inactive policy')
  assert.equal((await h.call('/api/dashboard/projects/p/workflow-calendars')).data[0].active,false,'a remaining policy protects even an unchanged inactive calendar')
 }})
 const negatives=[
  [p=>p.policy_metrics.push({...p.policy_metrics[0],metric:'next_reply_time'}),'sla_policy_single_metric_required'],
  [p=>p.policy_metrics[0].business_hours=false,'sla_policy_metric_unsupported'],
  [p=>p.policy_metrics[0].metric='total_resolution_time','sla_policy_metric_unsupported'],
  [p=>p.policy_metrics[0].priority='unknown','sla_policy_priority_unsupported'],
  [p=>p.filter.all.push({field:'priority',operator:'is',value:'urgent'}),'sla_policy_priority_unsupported'],
  [p=>p.filter.all.push({field:'group_id',operator:'is',value:'1'}),'sla_policy_conditions_unsupported'],
  [p=>p.filter.any.push({field:'priority',operator:'is',value:'normal'}),'sla_policy_conditions_unsupported'],
  [p=>delete p.move_in_schedule_id,'sla_policy_calendar_review_required'],
  [p=>p.move_in_schedule_id=999,'sla_policy_calendar_unavailable'],
  [p=>p.policy_metrics[0].extra_semantic=true,'sla_policy_structure_unsupported'],
 ]
 const refused=negatives.map(([change],i)=>{const r=structuredClone(slaSource);r.sla_policy.id=600+i;change(r.sla_policy);return r})
 await imported('zendesk',jsonl(slaSchedule,...refused),{check:async({plan,rejection,rows})=>{
  assert.equal(plan.counts.rejected,negatives.length);for(const [i,[,reason]] of negatives.entries()){assert.equal(rejection(`sla_policy/${600+i}`),reason);assert.equal(plan.decisions.find(d=>d.sourceId===String(600+i)).location.row,i+2)}
  assert.equal((await rows('SELECT count(*) n FROM sla_policies'))[0].n,0)
 }})
 await activationJourney(source)
}
async function activationJourney(source){
 source+='\n'+jsonl({user:{id:700,role:'end-user',name:'Historical customer',email:'historical-sla@example.test',created_at:dates.created_at}},{ticket:{id:701,requester_id:700,subject:'Historical request',status:'open',via:{channel:'email'},comments:[{id:702,author_id:700,body:'Old request',public:true,created_at:dates.created_at}],...dates}})

 const now=Date.parse('2026-11-25T16:00:00Z'),app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',H2H_LOCAL:'true',H2H_WORKFLOW_NOW:String(now),EMAIL_PROVIDER:'development'}})
 try{
  const w=await app.seedWorkspace('sla-import'),root=`/api/move-in/projects/${w.projectId}/imports`,native=`/api/dashboard/projects/${w.projectId}`
  const call=(path,body,method='POST',role='owner')=>app.call(path,{body,method,token:w.tokens[role]})
  const ok=(path,body,method,role)=>app.ok(path,{body,...(method?{method}:{}),token:w.tokens[role??'owner']})
  const upload=async()=>{const r=await app.ok(root+'?vendor=zendesk',{token:w.tokens.owner,body:source+'\n',raw:true,headers:{'X-Import-Filename':'sla.jsonl'}});await app.drainJobs();return (await ok(root+'/'+r.data.id)).data}
  let review=await upload()
  await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.owner).run()
  assert.equal((await call(root+'/'+review.id+'/apply',{fingerprint:review.plan.fingerprint})).status,401)
  assert.equal((await app.first('SELECT count(*) n FROM sla_policies')).n,0)
  await app.db.prepare("UPDATE memberships SET role='owner' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.owner).run()
  await ok(root+'/'+review.id+'/apply',{fingerprint:review.plan.fingerprint});await app.drainJobs()
  const calendar=(await ok(native+'/workflow-calendars')).data[0],policy=(await ok(native+'/sla-policies')).data[0]
  assert.equal((await call(native+'/sla-policies/'+policy.id,{active:true},'PATCH')).status,400,'calendar must be deliberately activated first')
  const customer=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'SLA customer',email:'sla-customer@example.test'},headers:{Origin:w.allowedOrigin}})
  const ticket=await app.ok('/api/conversations',{token:customer.token,body:{projectId:w.projectId}})
  await app.ok(`/api/conversations/${ticket.id}/messages`,{token:customer.token,body:{content:'Please help',localId:'synthetic-hh-1',expectedRevision:0}});await app.drainJobs()
  assert.equal((await ok(native+`/conversations/${ticket.id}/sla`)).data.policy,null,'inactive policy creates no clocks')
  await ok(native+'/workflow-calendars/'+calendar.id,{active:true},'PATCH')
  assert.equal((await call(native+'/sla-policies/'+policy.id,{active:true},'PATCH','operator')).status,403)
  await ok(native+'/sla-policies/'+policy.id,{active:true},'PATCH')
  const historical=await app.first('SELECT conversation_id FROM move_in_conversations WHERE project_id=?',w.projectId)
  assert.equal((await call(native+`/conversations/${historical.conversation_id}/sla`,undefined,'GET')).status,404)
  assert.equal((await app.first('SELECT count(*) n FROM ticket_sla_state WHERE conversation_id=?',historical.conversation_id)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM sla_alerts WHERE conversation_id=?',historical.conversation_id)).n,0)
  const sla=(await ok(native+`/conversations/${ticket.id}/sla`)).data
  // Wednesday 16:00 plus 120 business minutes: 60 Wednesday, holiday Thursday,
  // then 60 Friday from 09:00, giving Friday 10:00 UTC.
  assert.equal(sla.clocks.find(c=>c.metric==='first_response').due_at,Date.parse('2026-11-27T10:00:00Z'))
  const ticketData=(await ok(native+`/conversations/${ticket.id}/ticket`)).data
  await ok(native+`/conversations/${ticket.id}/ticket`,{expected_version:ticketData.ticket_version,priority:'urgent'},'PATCH')
  assert.equal((await ok(native+`/conversations/${ticket.id}/sla`)).data.policy,null,'an unlisted priority never gains this commitment')
  await ok(root+'/'+review.id+'/undo',{});await app.drainJobs()
  assert.equal((await ok(native+'/sla-policies')).data[0].active,true,'undo preserves a natively activated policy')
  assert.equal((await ok(native+'/workflow-calendars')).data[0].active,true,'undo preserves its referenced calendar')
  assert.deepEqual(app.requests,[],'configuration import and SLA evaluation send nothing')
 }finally{await app.close()}
}
