import assert from 'node:assert/strict'

// Ordinary roles and HTTP doors; only stored selections and concurrent changes
// are SQL fixtures. There is no public scope-writing API in this slice.
export async function ticketScopeSchedule(app){
 for(const area of ['dashboard','management'])await scheduleScopeDoors(app,area)
}
async function scheduleScopeDoors(app,area){
 const w=await app.seedWorkspace('synthetic-hh-schedule-'+area+'-1'),foreign=await app.seedWorkspace('synthetic-hh-schedule-'+area+'-2')
 const p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/${area}/projects/${p}`,now=Date.parse('2026-11-03T09:00:00Z'),due=now+60000
 const call=(path,body,method,token=w.tokens.admin,headers)=>app.call(path,{body,method,token,headers})
 const summary=body=>Array.isArray(body)?body.map(({conversation_id,dependency_id,state})=>({conversation_id,dependency_id,state})):body?.schedules?{schedules:body.schedules.map(({state,reason})=>({state,reason}))}:body?.runs?{runs:body.runs.map(({id,state})=>({id,state}))}:Object.fromEntries(Object.entries(body??{}).filter(([key])=>['id','state','reason','error','code'].includes(key)))
 let number=0
 const probe=(point,door,response,status,check)=>{
  const body=response.data?.data??response.data
  console.log(`PROBE ${++number} ${point}: ${door} -> ${response.status}/${JSON.stringify(summary(body))}`)
  assert.equal(response.status,status,point)
  if(check)check(body)
  return body
 }
 const role=await call(`${P}/roles`,{name:'Synthetic schedule authority',base:'admin',permissions:['settings.manage','conversations.manage','conversations.reply']},'POST',w.tokens.owner)
 assert.equal(role.status,201)
 const roleId=role.data.data.id
 assert.equal((await call(`${P}/agents/${w.users.admin}`,{role:roleId},'PUT',w.tokens.owner)).status,200)
 const a=`synthetic-hh-schedule-${area}-a`,b=`synthetic-hh-schedule-${area}-b`,other=`synthetic-hh-schedule-${area}-foreign`
 for(const [project,group] of [[p,a],[p,b],[foreign.projectId,other]])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,project,group).run()
 const contact='synthetic-hh-schedule-'+area+'-contact'
 await app.db.prepare('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,1)').bind(contact,p,'Synthetic customer','synthetic-hh-schedule-3@example.test').run()
 const tickets={}
 for(const [key,group] of [['allowed',a],['hidden',b],['revoked',b],['sleep',a],['null',b]]){
  const row=await call('/api/conversations',{projectId:p,contactId:contact},'POST',w.tokens.owner);assert.equal(row.status,201)
  tickets[key]=row.data.id
  await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind(group,row.data.id).run()
 }
 const selected={groupIds:[a],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
 const select=scope=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(scope===null?null:JSON.stringify(scope),p,roleId).run()
 const revokeSql=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE project_id='${p}' AND id='${roleId}'`
 const input=(ticket,extra={})=>({conversation_id:ticket,kind:'reply',due_at:due,timezone:'UTC',body:'Synthetic scheduled answer',owner_id:w.users.admin,...extra})
 const schedule=(ticket,extra={},token=w.tokens.admin)=>call(`${D}/workflow-schedules`,input(ticket,extra),'POST',token)
 const edit=(row,body,token=w.tokens.admin,headers)=>call(`${D}/workflow-schedules/${row.id}`,body,'PATCH',token,headers)
 const list=(token=w.tokens.admin)=>call(`${D}/workflow-schedules`,undefined,undefined,token)
 const detail=(ticket,token=w.tokens.admin)=>call(`${D}/conversations/${ticket}/workflows`,undefined,undefined,token)
 const read=async(row,token=w.tokens.owner)=>(await detail(row.conversation_id,token)).data.data.schedules.find(value=>value.id===row.id)
 const accepted=async response=>{assert.equal(response.status,201);return response.data.data}
 const unchanged=async(row,before)=>assert.deepEqual(await read(row),before,'refusal preserves every schedule field')
 const clock=value=>app.configure({H2H_WORKFLOW_NOW:String(value)})
 const originalClock=app.bindings.H2H_WORKFLOW_NOW
 await clock(now)
 try{
  await select(null)
  const hidden=await accepted(await schedule(tickets.hidden)),hiddenSleep=await accepted(await schedule(tickets.hidden,{kind:'snooze'}))
  await select(selected)
  const allowed=probe('selected schedule create',`POST ${D}/workflow-schedules allowed group`,await schedule(tickets.allowed),201)
  const sleeping=probe('selected snooze create',`POST ${D}/workflow-schedules snooze allowed group`,await schedule(tickets.sleep,{kind:'snooze'}),201)
  probe('hidden schedule create',`POST ${D}/workflow-schedules hidden group`,await schedule(tickets.hidden),404)
  probe('hidden snooze create',`POST ${D}/workflow-schedules snooze hidden group`,await schedule(tickets.revoked,{kind:'snooze'}),404)
  const hiddenBefore=await read(hidden),sleepBefore=await read(hiddenSleep)
  probe('hidden schedule edit',`PATCH ${D}/workflow-schedules/${hidden.id} body`,await edit(hidden,{body:'Synthetic forbidden edit'}),404)
  await unchanged(hidden,hiddenBefore)
  probe('hidden snooze cancel',`PATCH ${D}/workflow-schedules/${hiddenSleep.id} cancel`,await edit(hiddenSleep,{action:'cancel'}),404)
  await unchanged(hiddenSleep,sleepBefore)
  probe('scope listing',`GET ${D}/workflow-schedules`,await list(),200,rows=>assert.ok(rows.every(row=>![tickets.hidden,tickets.revoked].includes(row.conversation_id))))
  probe('hidden ticket work',`GET ${D}/conversations/${tickets.hidden}/workflows`,await detail(tickets.hidden),404)
  probe('hidden dependency create',`POST ${D}/workflow-schedules allowed -> hidden dependency`,await schedule(tickets.allowed,{kind:'snooze',due_at:null,dependency_id:tickets.hidden}),404)
  probe('hidden dependency edit',`PATCH ${D}/workflow-schedules/${sleeping.id} hidden dependency`,await edit(sleeping,{due_at:null,dependency_id:tickets.hidden}),404)
  const visibleBefore=await read(sleeping)
  probe('snooze cancel commit revocation',`PATCH ${D}/workflow-schedules/${sleeping.id} cancel; selection removed before UPDATE`,await edit(sleeping,{action:'cancel'},w.tokens.admin,{'x-test-statement':'UPDATE workflow_schedules SET state','x-test-before-statement':revokeSql}),409)
  await unchanged(sleeping,visibleBefore)
  await select(selected)
  probe('snooze edit commit revocation',`PATCH ${D}/workflow-schedules/${sleeping.id} due_at; selection removed before UPDATE`,await edit(sleeping,{due_at:due+1000},w.tokens.admin,{'x-test-statement':'UPDATE workflow_schedules SET due_at','x-test-before-statement':revokeSql}),409)
  await unchanged(sleeping,visibleBefore)
  await select(empty)
  probe('empty schedule create',`POST ${D}/workflow-schedules empty selection`,await schedule(tickets.allowed),404)
  probe('empty schedule edit',`PATCH ${D}/workflow-schedules/${allowed.id} empty selection`,await edit(allowed,{body:'Synthetic empty edit'}),404)
  probe('empty listing',`GET ${D}/workflow-schedules empty selection`,await list(),200,rows=>assert.deepEqual(rows,[]))
  probe('owner recovery',`PATCH ${D}/workflow-schedules/${hidden.id} as native owner`,await edit(hidden,{body:'Synthetic owner recovery'},w.tokens.owner),200)
  await select({groupIds:[a,other],includeUngrouped:false})
  probe('foreign group fail closed',`POST ${D}/workflow-schedules stored foreign group`,await schedule(tickets.allowed),404)
  probe('foreign group list fail closed',`GET ${D}/workflow-schedules stored foreign group`,await list(),200,rows=>assert.deepEqual(rows,[]))
  await select(selected)
  for(const [point,response] of [
   ['schedule create',await schedule(tickets.allowed,{},foreign.tokens.admin)],
   ['snooze create',await schedule(tickets.allowed,{kind:'snooze'},foreign.tokens.admin)],
   ['schedule edit',await edit(hidden,{body:'Synthetic foreign edit'},foreign.tokens.admin)],
   ['snooze cancel',await edit(sleeping,{action:'cancel'},foreign.tokens.admin)],
   ['list',await list(foreign.tokens.admin)],
   ['ticket work',await detail(tickets.allowed,foreign.tokens.admin)]
  ]){console.log(`PROBE ${++number} foreign ${point}: native schedule door as other workspace -> ${response.status}/${JSON.stringify(response.data)}`);assert.ok([403,404].includes(response.status))}

  // Seed terminal run history, then inspect/reconcile exclusively through routes.
  const definition={name:'Synthetic schedule review',kind:'event',position:0,conditions:{all:[]},actions:[{type:'priority',priority:'high'}]}
  const rule=await call(`${D}/workflow-rules`,definition,'POST',w.tokens.owner);assert.equal(rule.status,201)
  const runs={}
  for(const key of ['allowed','hidden']){
   const run='synthetic-hh-schedule-run-'+area+'-'+key;runs[key]=run
   await app.db.prepare("INSERT INTO workflow_runs(id,project_id,conversation_id,rule_id,version,event_id,rule_name,state,explanation,actions_json,frontier_json,created_at,updated_at) VALUES(?,?,?,?,1,?,?,'failed','{}','[]','{}',1,1)").bind(run,p,tickets[key],rule.data.rule.id,run,definition.name).run()
  }
  const reconcile=(run,token=w.tokens.admin,headers)=>call(`${D}/workflow-runs/${run}/reconcile`,{expected_updated_at:1,note:'Synthetic reviewed failure',reference:'synthetic-hh-review'},'POST',token,headers)
  probe('run read scope',`GET ${D}/workflow-runs`,await call(`${D}/workflow-runs`),200,body=>assert.deepEqual(body.runs.map(row=>row.id),[runs.allowed]))
  probe('hidden run query',`GET ${D}/workflow-runs?conversation_id=hidden`,await call(`${D}/workflow-runs?conversation_id=${tickets.hidden}`),200,body=>assert.deepEqual(body.runs,[]))
  probe('hidden run reconcile',`POST ${D}/workflow-runs/${runs.hidden}/reconcile`,await reconcile(runs.hidden),404)
  probe('foreign run read',`GET ${D}/workflow-runs as other workspace`,await call(`${D}/workflow-runs`,undefined,undefined,foreign.tokens.admin),403)
  probe('foreign run reconcile',`POST ${D}/workflow-runs/${runs.allowed}/reconcile as other workspace`,await reconcile(runs.allowed,foreign.tokens.admin),403)
  probe('run reconcile commit revocation',`POST ${D}/workflow-runs/${runs.allowed}/reconcile; selection removed before audit`,await reconcile(runs.allowed,w.tokens.admin,{'x-test-statement':'INSERT INTO audit_events','x-test-before-statement':revokeSql}),409)
  await select(selected)
  probe('selected run reconcile',`POST ${D}/workflow-runs/${runs.allowed}/reconcile`,await reconcile(runs.allowed),200,body=>assert.equal(body.state,'cancelled'))
  await select(null)
  probe('NULL hidden run read',`GET ${D}/workflow-runs NULL scope`,await call(`${D}/workflow-runs`),200,body=>assert.ok(body.runs.some(row=>row.id===runs.hidden)))
  const unrestricted=probe('NULL hidden schedule create',`POST ${D}/workflow-schedules hidden group NULL scope`,await schedule(tickets.null),201)
  probe('NULL hidden schedule edit',`PATCH ${D}/workflow-schedules/${unrestricted.id} NULL scope`,await edit(unrestricted,{body:'Synthetic unrestricted answer'}),200)
  probe('NULL hidden run reconcile',`POST ${D}/workflow-runs/${runs.hidden}/reconcile NULL scope`,await reconcile(runs.hidden),200)
  // Distinguish current scope from role timestamp pinning at send time.
  const revoked=await accepted(await schedule(tickets.revoked))
  await select(selected)
  await clock(due);await app.scheduled()
  probe('selected scheduled admission',`GET ${D}/conversations/${tickets.allowed}/workflows after due tick`,await detail(tickets.allowed,w.tokens.owner),200,body=>assert.equal(body.schedules.find(row=>row.id===allowed.id).state,'sent'))
  const admitted=await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${allowed.id}`);assert.equal(admitted.n,1)
  const refused=await read(revoked)
  console.log(`PROBE ${++number} scope revoked admission: scheduled tick then owner GET workflows -> 200/${JSON.stringify({state:refused.state,reason:refused.reason,messages:(await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${revoked.id}`)).n})}`)
  assert.equal(refused.state,'cancelled');assert.ok(refused.reason)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${revoked.id}`)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox WHERE conversation_id=?',tickets.revoked)).n,0)
  assert.equal((await read(sleeping)).state,'woken','in-scope snooze wakes')
  assert.equal((await read(hiddenSleep)).state,'pending','out-of-scope sender cannot wake the snooze')
  await select(null);await app.scheduled()
  assert.equal((await read(hiddenSleep)).state,'woken','NULL-scope compatibility resumes the snooze')
  console.log(`PROBE_TOTAL=${number} schedule authority area=${area}`)
 }finally{await app.configure({H2H_WORKFLOW_NOW:originalClock})}
}
