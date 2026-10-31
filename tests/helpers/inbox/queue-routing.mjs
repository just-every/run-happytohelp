import assert from 'node:assert/strict'

// Continue the existing desk journey through its settings, widget and inbox
// doors. A redeploy replaces the Worker while retaining its real D1 state.
export async function queueRoutingProof(f,{group,team,route,arrivals,overflow}){
 const {app,w,ok,get,patch}=f
 const decision=async id=>(await ok(`/conversations/${id}/routing`)).decision
 const operators=async()=>(await ok('/routing-operators')).operators
 const setOperators=rows=>ok('/routing-operators',{operators:rows},'PUT')
 const operator=(user_id,available=true,capacity=100)=>({user_id,available,capacity,skills:['returns']})
 const admit=async content=>{
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
  const ticket=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:w.projectId}})
  const message=await app.ok(`/api/conversations/${ticket.id}/messages`,{token:visitor.token,body:{localId:crypto.randomUUID(),content,expectedRevision:0}})
  assert.equal(message.accepted,true,'the real widget route admits the customer message')
  return ticket.id
 }
 const groups=await ok('/ticket-groups')
 for(const [configured,name,members] of [[group,'Returns',[w.users.owner,w.users.operator]],[team,'Shipping',[w.users.admin,w.users.operator]]]){
  const saved=groups.find(row=>row.id===configured.id)
  assert.equal(saved.name,name,'both teams are configured through settings')
  assert.deepEqual(saved.members.sort(),members.sort(),'settings retains each team membership')
 }
 const savedRule=(await ok('/workflow-rules')).rules.find(row=>row.id===route.id)
 assert.equal(savedRule.state,'published')
 assert.equal(savedRule.published.routing.strategy,'round_robin')
 assert.equal(savedRule.published.routing.group_id,team.id)
 for(const id of arrivals){
  const routed=await decision(id)
  assert.equal(routed.rule_id,route.id)
  assert.equal(routed.group_id,team.id)
  assert.match(routed.explanation,/Rule Replacement dispatch won at position 0; strategy round_robin/)
 }

 // A positive capacity equal to live workload proves exclusion of a genuinely
 // full teammate, independently of the separate offline switch.
 const full=(await operators()).find(row=>row.user_id===w.users.admin)
 assert.ok(full.workload>0)
 await setOperators([operator(w.users.admin,true,full.workload),operator(w.users.operator)])
 const atCapacity=await admit('Replacement while the other teammate is full')
 assert.equal((await get(atCapacity)).assigned_to,w.users.operator)
 assert.deepEqual((await decision(atCapacity)).candidates.map(row=>row.user_id),[w.users.operator],'full owner is excluded')
 await setOperators([operator(w.users.admin,false),operator(w.users.operator)])
 const offline=await admit('Replacement while the other teammate is offline')
 assert.equal((await get(offline)).assigned_to,w.users.operator)
 assert.deepEqual((await decision(offline)).candidates.map(row=>row.user_id),[w.users.operator],'offline assignee is skipped')
 assert.deepEqual((await operators()).find(row=>row.user_id===w.users.operator).skills,['returns'])

 // Concurrent customer arrivals must be balanced at admission, not repaired by
 // a test-side assignment. Observe the last decision before replacing Worker.
 await setOperators([operator(w.users.admin),operator(w.users.operator)])
 const concurrent=await Promise.all([admit('Concurrent widget replacement one'),admit('Concurrent widget replacement two')])
 const owners=await Promise.all(concurrent.map(async id=>(await get(id)).assigned_to))
 assert.deepEqual(owners.sort(),[w.users.admin,w.users.operator].sort(),'concurrent widget admissions share the round robin fairly')
 const checkpoint=await admit('Last round-robin turn before restart')
 const previous=await decision(checkpoint),beforeOperators=await operators(),beforeOverflow=await get(overflow),overflowDecision=await decision(overflow)
 assert.equal(beforeOverflow.assigned_to,null)
 assert.equal(beforeOverflow.group_id,team.id)
 await app.configure({})
 assert.deepEqual(await operators(),beforeOperators,'availability, capacity, skills and workload survive restart')
 assert.deepEqual(await decision(checkpoint),previous,'winning decision survives restart')
 assert.deepEqual(await get(overflow),beforeOverflow,'overflow keeps its responsible group after restart')
 assert.deepEqual(await decision(overflow),overflowDecision,'overflow explanation survives restart')
 let last=previous.winner_id
 const rotation=[last]
 for(let turn=0;turn<3;turn++){
  const id=await admit('Replacement after restart '+turn),routed=await decision(id)
  const expected=last===w.users.admin?w.users.operator:w.users.admin
  assert.equal((await get(id)).assigned_to,expected,'persisted last turn prevents starvation after restart')
  assert.equal(routed.winner_id,expected)
  assert.ok(routed.explanation.includes('previous turn '+last+'.'),'public decision reads back the persisted fairness cursor')
  assert.equal(routed.rule_id,route.id)
  assert.equal(routed.group_id,team.id)
  rotation.push(expected);last=expected
 }
 for(const user of [w.users.admin,w.users.operator])assert.equal(rotation.filter(id=>id===user).length,2,'rotation stays balanced across restart')

 // Takeover works with current authority. Keep the same signed-in token while
 // its role loses manage permission; both public assignment doors must refuse.
 await patch(overflow,{agent_id:w.users.operator},'operator')
 assert.equal((await get(overflow)).assigned_to,w.users.operator)
 await patch(overflow,{agent_id:w.users.admin})
 assert.equal((await get(overflow)).assigned_to,w.users.admin,'manual reassignment keeps a responsible team')
 const management=`/api/management/projects/${w.projectId}`
 const restricted=(await app.ok(management+'/roles',{token:w.tokens.owner,body:{name:'Queue reader',base:'operator',permissions:['conversations.reply']}})).data
 try{
  await app.ok(management+'/agents/'+w.users.operator,{token:w.tokens.owner,method:'PUT',body:{role:restricted.id}})
  const before=await get(overflow)
  for(const [suffix,method,body] of [['','PUT',{assigned_to:w.users.operator}],['/ticket','PATCH',{agent_id:w.users.operator,expected_version:before.ticket_version}]]){
   const refused=await app.call(`/api/dashboard/projects/${w.projectId}/conversations/${overflow}`+suffix,{token:w.tokens.operator,method,body})
   assert.equal(refused.status,403,'current role refuses manual takeover with an existing session')
   assert.deepEqual(await get(overflow),before,'refusal preserves ownership, group, version and history')
  }
 }finally{
  await app.ok(management+'/agents/'+w.users.operator,{token:w.tokens.owner,method:'PUT',body:{role:'operator'}})
 }
 await patch(overflow,{agent_id:null})
 const queue=await ok('/conversations?filters='+encodeURIComponent(JSON.stringify([{field:'group_id',operator:'eq',value:team.id}])))
 assert.ok(queue.some(row=>row.id===overflow),'unassigned overflow remains visible in its responsible queue')
}
