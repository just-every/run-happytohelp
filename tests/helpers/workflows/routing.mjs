import assert from 'node:assert/strict'
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
 f.routingId=available
}
