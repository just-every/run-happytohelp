import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
export async function routingFlow(f){
 const {app,w,ok,create,get,patch,publish}=f
 const group=await ok('/ticket-groups',{name:'US returns',members:[w.users.owner,w.users.admin,w.users.operator]})
 f.group=group
 const full=await create('Owner is handling this return');await patch(full,{assigned_to:w.users.owner})
 const initialLoad=Object.fromEntries((await ok('/routing-operators')).operators.map(o=>[o.user_id,o.workload]))
 await ok('/routing-operators',{operators:[{user_id:w.users.owner,available:true,capacity:initialLoad[w.users.owner],skills:['returns']},{user_id:w.users.admin,available:true,capacity:initialLoad[w.users.admin]+3,skills:['returns']},{user_id:w.users.operator,available:true,capacity:initialLoad[w.users.operator]+3,skills:['returns']}]},'PUT')
 const route=await publish({name:'Returns round robin',kind:'routing',position:1,conditions:{all:[]},actions:[],routing:{strategy:'round_robin',group_id:group.id,skills:['returns']}})
 const ids=await Promise.all(Array.from({length:6},(_,i)=>create(`Routing request ${i}`)))
 const owners=await Promise.all(ids.map(async id=>(await get(id)).assigned_to))
 assert.equal(owners.filter(id=>id===w.users.admin).length,3);assert.equal(owners.filter(id=>id===w.users.operator).length,3);assert.ok(!owners.includes(w.users.owner))
 const decision=(await ok(`/conversations/${ids[0]}/routing`)).decision;assert.equal(decision.rule_id,route.id);assert.ok(decision.explanation.includes('capacity')||decision.explanation.includes('workload'));assert.ok(decision.explanation.includes('won'))
 await app.configure({H2H_WORKFLOW_NOW:app.bindings.H2H_WORKFLOW_NOW})
 const overflow=await create('Overflow still needs a responsible group'),ticket=await get(overflow)
 assert.equal(ticket.assigned_to,null);assert.equal(ticket.group_id,group.id);assert.equal((await ok(`/conversations/${overflow}/routing`)).decision.winner_id,null)
 await ok('/routing-operators',{operators:[{user_id:w.users.admin,available:false,capacity:10,skills:['returns']},{user_id:w.users.operator,available:true,capacity:10,skills:['returns']}]},'PUT')
 const available=await create('Offline admin is skipped');assert.equal((await get(available)).assigned_to,w.users.operator)
 // Capacity-aware selection chooses the lower occupied share while respecting the same live eligibility checks.
 await ok(`/workflow-rules/${route.id}/pause`,{})
 await publish({name:'Available capacity',kind:'routing',position:1,conditions:{all:[]},actions:[],routing:{strategy:'capacity',group_id:group.id,skills:['returns']}})
 const capacity=await create('Capacity queue request');assert.equal((await get(capacity)).assigned_to,w.users.operator)
 // One workspace's refused routing commit cannot hold a neighbour's cron-only events.
 {const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',H2H_WORKFLOW_NOW:String(f.initial)}})
 try{
 const a=await app.seedWorkspace('routing-retry'),b=await app.seedWorkspace('routing-neighbour'),at=f.initial
 const api=async(ws,path,body,method)=>{const response=await app.call(`/api/dashboard/projects/${ws.projectId}${path}`,{token:ws.tokens.owner,body,method});assert.ok(response.status<300,JSON.stringify(response.data));return response.data.data??response.data}
 const named=async ws=>{await api(ws,'/routing-operators',{operators:[{user_id:ws.users.owner,available:true,capacity:100,skills:[]}]},'PUT');const {rule}=await api(ws,'/workflow-rules',{name:'Available owner',kind:'routing',position:1,conditions:{all:[]},actions:[],routing:{strategy:'named',user_id:ws.users.owner,skills:[]}});await api(ws,`/workflow-rules/${rule.id}/publish`,{});return rule}
 const ar=await named(a);await named(b)
 const {rule:high}=await api(b,'/workflow-rules',{name:'New tickets need attention',kind:'event',position:1,event_kind:'created',conditions:{all:[]},actions:[{type:'priority',priority:'high'}]});await api(b,`/workflow-rules/${high.id}/publish`,{})
 const visitor=async(ws,index)=>app.ok('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey,name:`Customer ${index}`,email:`routing-${ws.projectId}-${index}@example.test`},headers:{Origin:ws.allowedOrigin,'CF-Connecting-IP':`10.9.1.${index}`}})
 const customer=await visitor(a,1),stuck=await app.ok('/api/conversations',{token:customer.token,body:{projectId:a.projectId}})
 const contention={"x-test-before-batch":`UPDATE routing_state SET revision=revision+1 WHERE project_id='${a.projectId}' AND rule_id='${ar.id}'`}
 await app.ok(`/api/conversations/${stuck.id}/messages`,{token:customer.token,body:{localId:'first',content:'My parcel has not arrived.',expectedRevision:0},headers:contention})
 const neighbours=[];for(let i=0;i<5;i++){const person=await visitor(b,10+i);neighbours.push((await app.ok('/api/conversations',{token:person.token,body:{projectId:b.projectId}})).id)}
 for(let minute=1;minute<=5;minute++){await app.configure({H2H_WORKFLOW_NOW:String(at+minute*60000)});await app.ok('/_test/scheduled',{body:{},headers:contention})}
 for(const id of neighbours){const ticket=await api(b,`/conversations/${id}/ticket`);assert.equal(ticket.assigned_to,b.users.owner);assert.equal(ticket.priority,'high')}
 for(const minute of [6,21,81,82,87,102,162]){await app.configure({H2H_WORKFLOW_NOW:String(at+minute*60000)});await app.ok('/_test/scheduled',{body:{},headers:contention})}
 const outcomes=(await api(a,`/conversations/${stuck.id}/routing`)).events
 assert.ok(outcomes.length>0);assert.ok(outcomes.every(event=>event.state==='not_routed'&&event.error&&event.attempts>0&&event.next_attempt_at===null))
 assert.equal((await api(a,`/conversations/${stuck.id}/ticket`)).assigned_to,null)
 }finally{await app.close()}}
 f.routingId=available
}
