import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'

// Extend the existing computer/adoption journey. Only stored scope is a SQL
// fixture; ordinary roles, assignments, pairing and work use the public doors.
export async function delegatedTicketScopeAssertions(){
 const app=await startApp({captureQueue:true,bindings:{RER_INSTALLATION_ID:'synthetic-hh-s5'}})
 const check=(...args)=>assert.deepEqual(...args)
 const probe=(point,input,output)=>console.log(`PROBE ACCESS-001 ${point}: ${input} -> ${JSON.stringify(output)}`)
 try{
  const w=await app.seedWorkspace('synthetic-hh-50'),foreign=await app.seedWorkspace('synthetic-hh-51'),p=w.projectId,P=`/api/projects/${p}`,M=`/api/management/projects/${p}`
  const call=(path,token=w.tokens.admin,body,headers,method)=>app.call(path,{token,body,headers,method})
  const data=r=>r.data?.data
  const roles={}
  for(const user of ['admin','operator']){
   const role=await call(M+'/roles',w.tokens.owner,{name:'Synthetic S5 '+user,base:'admin',permissions:['integrations.install','conversations.manage','conversations.reply','conversations.notes','conversations.follow']})
   assert.equal(role.status,201,JSON.stringify(role.data));roles[user]=role.data.data.id
   assert.equal((await call(`${M}/agents/${w.users[user]}`,w.tokens.owner,{role:roles[user]},undefined,'PUT')).status,200)
  }
  await app.db.prepare("UPDATE sessions SET role='admin',revoked_at=NULL WHERE project_id=? AND actor_id=?").bind(p,w.users.operator).run()
  for(const group of ['synthetic-hh-50-allowed','synthetic-hh-50-hidden'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,p,group).run()
  const selected={groupIds:['synthetic-hh-50-allowed'],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
  const select=(scope,user='admin')=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=? AND project_id=?').bind(scope===null?null:JSON.stringify(scope),roles[user],p).run()
  const revoke=user=>`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE id='${roles[user]}' AND project_id='${p}'`
  const race=(statement,user='admin')=>({'x-test-statement':statement,'x-test-before-statement':revoke(user)})
  await app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('synthetic-hh-52',?,'Synthetic S5 customer','synthetic-hh-52@example.test',1)").bind(p).run()
  let serial=0
  const ticket=async(group='synthetic-hh-50-allowed')=>{
   const id='synthetic-hh-s5-'+(++serial)
   await app.db.batch([
    app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,created_at,updated_at,revision,last_message_id) VALUES(?,?,\'synthetic-hh-52\',?,1,1,1,?)').bind(id,p,group,id+'-message'),
    app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,1)").bind(id+'-message',p,id,id+'-local','synthetic-hh-52','Synthetic S5 private '+id),
   ]);return id
  }
  const pair=async(workspace,user)=>{
   const pairing=await call(`/api/projects/${workspace.projectId}/local-agents/pairings`,workspace.tokens[user],{})
   assert.equal(pairing.status,200,JSON.stringify(pairing.data))
   const paired=await call('/api/local-agents/pair',undefined,{code:data(pairing).code,name:'Synthetic S5 computer',provider:'codex',capabilities:[]})
   assert.equal(paired.status,200);return {id:data(paired).device.id,token:data(paired).token}
  }
  const workers={admin:await pair(w,'admin'),operator:await pair(w,'operator'),foreign:await pair(foreign,'owner'),owner:await pair(w,'owner')}
  const path=id=>`${P}/conversations/${id}/delegations`
  const queue=async(user='admin')=>{
   const conversation=await ticket(),r=await call(path(conversation),w.tokens[user],{request_id:'synthetic-hh-request-'+serial,device_id:workers[user].id,mode:'investigate',instructions:'Synthetic S5 inspection'})
   assert.equal(r.status,200,JSON.stringify(r.data));return {conversation,id:data(r).id,user}
  }
  const claim=(worker,headers)=>call('/api/local-agents/claim',worker.token,{claim_id:'synthetic-hh-claim-'+(++serial)},headers)
  const job=id=>app.first('SELECT status,context,result FROM local_jobs WHERE id=?',id)
  const counts=async id=>({events:(await app.first("SELECT COUNT(*) n FROM local_events WHERE job_id=? AND kind='result'",id)).n,effects:(await app.first('SELECT COUNT(*) n FROM local_result_effects WHERE job_id=?',id)).n,notes:(await app.first('SELECT COUNT(*) n FROM conversation_notes WHERE id=?','delegation:'+id)).n,media:(await app.first('SELECT COUNT(*) n FROM media WHERE conversation_id=(SELECT conversation_id FROM local_jobs WHERE id=?)',id)).n})
  const result={summary:'Synthetic S5 result',verified:true,actions:[],replies:[{id:'synthetic-hh-reply',title:'Synthetic reply',body:'Synthetic S5 editable reply'}]}
  const report=(j,c,token=workers[j.user].token,headers)=>call(`/api/local-agents/jobs/${j.id}/result`,token,{run_id:data(c).run_id,event_id:'synthetic-hh-result-'+j.id,status:'completed',result},headers)

  // Concurrency first: lose scope after the snapshot, immediately before claim.
  await select(selected)
  const prepared=await queue(),lost=await claim(workers.admin,race("UPDATE local_jobs SET status='running',claim_id")),lostState=await job(prepared.id)
  probe('P1','POST /api/local-agents/claim; allowed scope narrowed after snapshot',{status:lost.status,data:data(lost),stored:lostState})
  check([lost.status,data(lost),lostState],[200,null,{status:'queued',context:null,result:null}],'claim commit uses current scope')
  // Remove the refused queue item so later probes have a distinct frontier.
  await app.db.prepare("UPDATE local_jobs SET status='cancelled' WHERE id=?").bind(prepared.id).run()

  await select(selected)
  const active=await queue(),activeClaim=await claim(workers.admin);assert.equal(data(activeClaim).id,active.id)
  const raced=await report(active,activeClaim,workers.admin.token,race('INSERT OR IGNORE INTO local_events'))
  const resultState=await job(active.id),resultCounts=await counts(active.id)
  probe('P2','POST /api/local-agents/jobs/:job/result; allowed scope narrowed at result commit',{status:raced.status,stored:resultState,counts:resultCounts})
  check(raced.status,409);check(resultState.status,'running');check(resultState.result,null);check(resultCounts,{events:0,effects:0,notes:0,media:0})
  const adoptionPath=`${path(active.conversation)}/${active.id}/result/draft`,adoptionCommand={proposal_id:'synthetic-hh-reply',expected_revision:1,expected_last_message_id:active.conversation+'-message'}
  const refusedDraft=await call(adoptionPath,w.tokens.admin,adoptionCommand)
  check(refusedDraft.status,404);check((await counts(active.id)).media,0)
  await app.db.prepare("UPDATE local_jobs SET status='cancelled' WHERE id=?").bind(active.id).run()
  probe('P3','none',{reason:'No erasure or retention code touched; existing delegation journey exercises erased evidence'})
  probe('P4','none',{reason:'No money authority or provider effect changed'})

  // Source S's exact-target evidence assertions, adapted to current main.
  const visible=await ticket(),hidden=await ticket('synthetic-hh-50-hidden'),ungranted=await ticket()
  const targets=[visible,hidden].map(id=>`projects/${p}/conversations/${id}`)
  for(const [key,workspace,user] of [['allowed',w,'admin'],['denied',w,'operator'],['owner',w,'owner'],['other-tenant',foreign,'owner']]){
   await app.db.batch([
    app.db.prepare('INSERT INTO edition_clients(id,project_id,origin,redirect_uri) VALUES(?,?,?,?)').bind('synthetic-hh-client-'+key,workspace.projectId,'https://example.test','https://example.test/callback'),
    app.db.prepare('INSERT INTO edition_grants(id,installation_id,client_id,project_id,principal_id,scopes,targets,expires_at,token_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,1)').bind('synthetic-hh-grant-'+key,'synthetic-hh-s5','synthetic-hh-client-'+key,workspace.projectId,workspace.users[user],JSON.stringify(['support.conversation.read']),JSON.stringify(targets),Date.now()+3600000,sha('synthetic-hh-delegated-'+key)),
   ])
  }
  const evidence=(id,key='allowed',door='evidence')=>call('/api/delegation/v1/'+door+'?target='+encodeURIComponent(`projects/${p}/conversations/${id}`),'synthetic-hh-delegated-'+key)
  await select(selected);await select(empty,'operator')
  for(const [key,expected] of [['allowed',200],['denied',404],['other-tenant',403]]){
   const r=await evidence(visible,key);probe('P5',`GET /api/delegation/v1/evidence exact target as ${key}`,{status:r.status,text:r.data?.text,audience:r.data?.audience})
   check(r.status,expected);if(expected===200){check(r.data.text.includes('Synthetic S5 private '+visible),true);check(r.data.audience.principalIds.includes(w.users.operator),false)}else check(r.data?.text,undefined)
  }
  check((await evidence(hidden)).status,404,'hidden granted target');check((await evidence(ungranted)).status,403,'visible ungranted target')
  const a=await evidence(visible,'allowed','audience');check(a.status,200);check(a.data.principalIds.includes(w.users.operator),false)
  await select(empty);const narrowed=await evidence(visible);probe('P5','GET evidence on next request after narrowing',{status:narrowed.status});check(narrowed.status,404)

  // Allowed, empty-scope and foreign principals through the same local doors.
  await select(selected);await select(null,'operator')
  const allowed=await queue(),allowedClaim=await claim(workers.admin);assert.equal(data(allowedClaim).id,allowed.id)
  const denied=await queue('operator'),deniedActive=await claim(workers.operator);assert.equal(data(deniedActive).id,denied.id);assert.equal((await report(denied,deniedActive)).status,200)
  const deniedQueued=await queue('operator');await select(empty,'operator')
  const deniedClaim=await claim(workers.operator),foreignClaim=await claim(workers.foreign)
  probe('P6','POST claim as denied/other-tenant',{denied:{status:deniedClaim.status,data:data(deniedClaim)},foreign:{status:foreignClaim.status,data:data(foreignClaim)}})
  check([deniedClaim.status,data(deniedClaim),foreignClaim.status,data(foreignClaim)],[200,null,200,null]);check((await job(deniedQueued.id)).context,null)
  for(const [principal,token,device,expected] of [['allowed',w.tokens.admin,workers.admin,200],['denied',w.tokens.operator,workers.operator,403],['other-tenant',foreign.tokens.owner,workers.foreign,404]]){
   const j=principal==='denied'?denied:allowed,run=principal==='denied'?deniedActive:allowedClaim,c=await call(`/api/local-agents/jobs/${j.id}/context?run_id=${data(run).run_id}`,device.token),h=await call(path(allowed.conversation),token)
   probe('P6',`GET job context/history as ${principal}`,{contextStatus:c.status,context:data(c),historyStatus:h.status,history:data(h)})
   check(c.status,expected);check(h.status,principal==='allowed'?200:principal==='denied'?404:403)
   if(principal!=='allowed'){check(data(c),undefined);check(data(h),undefined);const r=await report(j,run,device.token);check(r.status,expected)}
  }
  const submitted=await report(allowed,allowedClaim);check(submitted.status,200);check((await counts(allowed.id)).notes,1)
  const draftPath=`${path(allowed.conversation)}/${allowed.id}/result/draft`,command={proposal_id:'synthetic-hh-reply',expected_revision:1,expected_last_message_id:allowed.conversation+'-message'}
  for(const [principal,token,status] of [['allowed',w.tokens.admin,200],['denied',w.tokens.operator,404],['other-tenant',foreign.tokens.owner,403]]){
   const r=await call(draftPath,token,command);probe('P7',`POST native result/draft as ${principal}`,{status:r.status,draft:data(r)});check(r.status,status)
  }
  const deniedDraft=await call(`${path(denied.conversation)}/${denied.id}/result/draft`,w.tokens.operator,{...command,expected_last_message_id:denied.conversation+'-message'});probe('P7','POST own completed draft as empty-scope principal',{status:deniedDraft.status,draft:data(deniedDraft)});check(deniedDraft.status,404)
  await select(empty);check((await call(draftPath,w.tokens.admin,command)).status,404)
  check((await app.first('SELECT COUNT(*) n FROM messages WHERE conversation_id=?',allowed.conversation)).n,1,'adoption never sends')

  // Same owner's native recovery remains native; neither credential inherits it.
  const ownerRole=await call(M+'/roles',w.tokens.owner,{name:'Synthetic S5 owner scope',base:'operator',permissions:['conversations.reply']});assert.equal(ownerRole.status,201)
  await app.db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,1)').bind(p,w.users.owner,ownerRole.data.data.id).run()
  const ownerJob=await queue('owner'),ownerClaim=await claim(workers.owner);assert.equal(data(ownerClaim).id,ownerJob.id)
  await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=?').bind(JSON.stringify(empty),ownerRole.data.data.id).run()
  const native=await call(`/api/dashboard/projects/${p}/conversations/${visible}/ticket`,w.tokens.owner),ownerEvidence=await evidence(visible,'owner'),ownerContext=await call(`/api/local-agents/jobs/${ownerJob.id}/context?run_id=${data(ownerClaim).run_id}`,workers.owner.token),ownerReport=await report(ownerJob,ownerClaim)
  probe('P8','owner membership with empty stored scope: native read/delegated evidence/machine context/result',{native:native.status,delegated:ownerEvidence.status,context:ownerContext.status,result:ownerReport.status})
  check([native.status,ownerEvidence.status,ownerContext.status,ownerReport.status],[200,404,403,403]);check((await counts(ownerJob.id)).events,0)
  check((await call(path(ownerJob.conversation),w.tokens.owner)).status,404)
  const ownerEmptyDraft=await call(`${path(ownerJob.conversation)}/${ownerJob.id}/result/draft`,w.tokens.owner,{...command,expected_last_message_id:ownerJob.conversation+'-message'});probe('P8','POST draft as owner with empty scope',{status:ownerEmptyDraft.status});check(ownerEmptyDraft.status,404)
  await app.db.prepare('UPDATE project_roles SET ticket_scope_json=NULL WHERE id=?').bind(ownerRole.data.data.id).run()
  check((await report(ownerJob,ownerClaim)).status,200)
  const ownerDraft=await call(`${path(ownerJob.conversation)}/${ownerJob.id}/result/draft`,w.tokens.owner,{...command,expected_last_message_id:ownerJob.conversation+'-message'});check(ownerDraft.status,200)
  await select(null)
  const nullEvidence=await evidence(hidden),nullHistory=await call(path(allowed.conversation)),nullDraft=await call(draftPath,w.tokens.admin,command)
  const nullJob=await queue(),nullClaim=await claim(workers.admin),nullContext=await call(`/api/local-agents/jobs/${nullJob.id}/context?run_id=${data(nullClaim).run_id}`,workers.admin.token),nullReport=await report(nullJob,nullClaim)
  probe('P9','NULL-scope role evidence/history/draft/claim/context/result and native owner',{evidence:nullEvidence.status,history:nullHistory.status,draft:nullDraft.status,claim:nullClaim.status,context:nullContext.status,result:nullReport.status,ownerDraft:ownerDraft.status,nativeOwner:native.status})
  check([nullEvidence.status,nullHistory.status,nullDraft.status,nullClaim.status,nullContext.status,nullReport.status,ownerDraft.status,native.status],[200,200,200,200,200,200,200,200])
 }finally{await app.close()}
}
