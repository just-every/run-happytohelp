import assert from 'node:assert/strict'
import {accessToken} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

// Extend the existing signed MCP journey. Roles use the native API; only stored
// scope and synthetic business records are SQL fixtures.
export async function agentDoorTicketScope({app,native,call,rpc,context,owner,member,memberSub,memberEmail},{before=false}={}){
 const p=owner.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}`,X=`/api/customer-context/${p}`
 const phase=before?'BEFORE':'AFTER',probe=(point,input,output)=>console.log(`PROBE ACCESS-001 ${point} ${phase}: ${input} -> ${JSON.stringify(output)}`)
 const role=(await native(P+'/roles',{body:{name:'Synthetic MCP scope',base:'operator',permissions:['conversations.reply','reports.view']}})).data.id
 await native(P+'/agents/'+member.actor.id,{method:'PUT',body:{role}})
 const groups=['synthetic-hh-90','synthetic-hh-91'],mixed='synthetic-hh-92',visible='synthetic-hh-93',ticketless='synthetic-hh-94'
 const selected={groupIds:[groups[0]],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
 const scope=value=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(value===null?null:JSON.stringify(value),p,role).run()
 for(const id of groups)await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(id,p,id).run()
 for(const id of [mixed,visible,ticketless])await app.db.batch([
  app.db.prepare('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,1)').bind(id,p,id,id+'@example.test'),
  app.db.prepare('INSERT INTO context_subjects(project_id,subject_id,consent) VALUES(?,?,1) ON CONFLICT(project_id,subject_id) DO UPDATE SET consent=1').bind(p,id),
  app.db.prepare("INSERT INTO context_evidence(id,project_id,subject_id,source,content,visibility,occurred_at) VALUES(?,?,?,'customer_message',?,'private_operational_evidence',1)").bind(id+'-evidence',p,id,id===mixed?'synthetic-hh-96 hidden evidence':'Synthetic visible evidence '+id),
  app.db.prepare("INSERT INTO context_profiles(project_id,subject_id,type,profile) VALUES(?,?,'contact',?)").bind(p,id,JSON.stringify({summary:id===mixed?'synthetic-hh-96 hidden profile':'Synthetic visible profile '+id})),
 ])
 const at=Date.parse('2026-03-08T12:00:00Z'),rows=[['synthetic-hh-95',mixed,groups[0],1,'ai',10],['synthetic-hh-96',mixed,groups[1],-1,'human',20],['synthetic-hh-97',visible,groups[0],-1,'human',40]]
 for(const [id,contact,group,rating,outcome,seconds] of rows)await app.db.batch([
  app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,group_id,subject,status_id,status_category,revision,created_at,updated_at,resolved_at) VALUES(?,?,?,?,?,'solved','solved',2,?,?,?)").bind(id,p,contact,group,id,at,at,at+seconds*1000),
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(id+'-question',p,id,id+'-question',contact,'Synthetic question '+id,at),
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'owner','Synthetic answer',2,?)").bind(id+'-answer',p,id,id+'-answer',owner.userId,at+1000),
  app.db.prepare('INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_at,first_resolved_at) VALUES(?,?,1,1,?,?)').bind(id,p,at,at+seconds*1000),
  app.db.prepare("INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json) VALUES(?,?,?,?,1,?,2,0,?,'{}')").bind(id+'-resolution',p,id,contact,at+seconds*1000,outcome),
  app.db.prepare('INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision) VALUES(?,?,?,?,1)').bind(id+'-resolution',rating,'Synthetic CSAT '+id,at+seconds*1000),
 ])
 const credential=()=>accessToken(context,{sub:memberSub,email:memberEmail,act:{sub:'synthetic-hh-99',name:'Synthetic scoped helper',specialist:context.surface.specialist}})
 const tool=async(name,args,token)=>call('happytohelp.'+name,args,token??await credential())
 const resource=(id,token,project=p)=>rpc('resources/read',{uri:`happytohelp://projects/${project}/conversations/${id}/context`},token)
 const packet=(id,token)=>app.ok(X+'/'+id,{token})
 const reportArgs={start:'2026-03-08',end:'2026-03-09'},reportPath=D+'/reports?period=custom&start=2026-03-08&end=2026-03-09'
 const report=async token=>{const {campaigns,...ordinary}=await app.ok(reportPath,{token});return ordinary}
 const resourcePacket=r=>{assert.equal(r.data.error,undefined,JSON.stringify(r.data));return JSON.parse(r.data.result.contents[0].text)}
 probe('P1','none','read actor propagation only; no new concurrency guarantee')
 probe('P2','none','erasure and retention untouched')
 probe('P3','none','money and AI ceilings untouched')
 try{
  await scope(selected)
  for(const [id,subject] of [[rows[0][0],mixed],[rows[2][0],visible]]){
   const nativePacket=await packet(subject,member.token),expected=before?await packet(subject,owner.token):nativePacket
   const t=await tool('context.read',{id}),r=resourcePacket(await resource(id,await credential()))
   assert.equal(t.outcome,'done',JSON.stringify(t));assert.deepEqual(t.result.context,expected);assert.deepEqual(r,expected)
   if(subject===mixed){
    assert.deepEqual(nativePacket.evidence,[]);assert.deepEqual(nativePacket.profiles,{});assert.equal(nativePacket.consent,false)
    assert.equal(JSON.stringify(t.result.context).includes('synthetic-hh-96'),before)
   }else assert.deepEqual(t.result.context,await packet(subject,owner.token))
   probe('P4',`/mcp context.read AND resources/read ${id}`,{nativeEquality:JSON.stringify(t.result.context)===JSON.stringify(nativePacket),evidence:t.result.context.evidence.length,profiles:t.result.context.profiles,consent:t.result.context.consent,fingerprint:t.result.context.evidence_fingerprint,hidden:JSON.stringify(t.result.context).includes('synthetic-hh-96')})
  }
  assert.deepEqual(await packet(ticketless,member.token),await packet(ticketless,owner.token))
  probe('P4','native ticketless context',{unchanged:true,evidence:(await packet(ticketless,member.token)).evidence.length})
  const denied=await tool('context.read',{id:rows[1][0]}),deniedResource=await resource(rows[1][0],await credential())
  assert.equal(denied.code,'not_found');assert.equal(deniedResource.data.error.data.code,'resource_unavailable')
  const nativeReport=await report(member.token),expectedReport=before?await report(owner.token):nativeReport,t=await tool('reports.read',reportArgs)
  assert.equal(t.outcome,'done',JSON.stringify(t));assert.deepEqual(t.result.report,expectedReport)
  for(const [actual,expected] of [[nativeReport.volume,2],[nativeReport.aiResolution,{count:1,total:2,rate:0.5}],[nativeReport.satisfaction,{positive:1,total:2,rate:0.5}],[nativeReport.daily.map(r=>[r.conversations,r.resolved,r.ai,r.rated,r.positive]),[[2,2,1,2,1]]],[nativeReport.comments.map(r=>[r.conversationId,r.comment]),[['synthetic-hh-97','Synthetic CSAT synthetic-hh-97'],['synthetic-hh-95','Synthetic CSAT synthetic-hh-95']]]])assert.deepEqual(actual,expected)
  probe('P5','/mcp reports.read selected rated cohort',t.result.report)
  for(const [label,value,token] of [['NULL',null,member.token],['owner',empty,owner.token],['all',{groupIds:groups,includeUngrouped:true},member.token]]){
   await scope(value)
   const c=label==='owner'?await accessToken(context):await credential(),expected=await packet(mixed,token)
   assert.deepEqual((await tool('context.read',{id:rows[0][0]},c)).result.context,expected)
   assert.deepEqual(resourcePacket(await resource(rows[0][0],c)),expected)
   assert.deepEqual((await tool('reports.read',reportArgs,c)).result.report,await report(token))
   probe('P7',`${label} context tool/resource and report`,{evidence:expected.evidence.length,volume:(await report(token)).volume,nativeEquality:true})
  }
  await scope(empty)
  assert.equal((await tool('context.read',{id:rows[0][0]})).code,'not_found')
  assert.equal((await resource(rows[0][0],await credential())).data.error.data.code,'resource_unavailable')
  const emptyReport=await tool('reports.read',reportArgs)
  assert.deepEqual(emptyReport.result.report,await report(before?owner.token:member.token))
  assert.equal(emptyReport.result.report.volume,before?3:0)
  const foreign=await app.seedWorkspace('synthetic-hh-98')
  const foreignURI=await resource(rows[0][0],await credential(),foreign.projectId)
  assert.equal(foreignURI.data.error.data.code,'resource_unavailable')
  // A Business-linked native person who belongs only to another project is
  // refused before any changed reader, including the resource path.
  await app.db.prepare("INSERT INTO memberships VALUES(?,?,'operator')").bind(foreign.projectId,member.actor.id).run()
  await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(p,member.actor.id).run()
  try{
   for(const [method,params] of [['tools/call',{name:'happytohelp.context.read',arguments:{id:rows[0][0]}}],['tools/call',{name:'happytohelp.reports.read',arguments:reportArgs}],['resources/read',{uri:`happytohelp://projects/${p}/conversations/${rows[0][0]}/context`}]]){
    const r=await rpc(method,params,await credential());assert.equal(r.status,401);assert.equal(r.data.result,undefined)
   }
  }finally{await app.db.prepare("INSERT INTO memberships VALUES(?,?,'operator')").bind(p,member.actor.id).run()}
  probe('P7','empty scope; unreadable named ticket; foreign linked person/project URI',{emptyContext:'not_found/resource_unavailable',emptyReportVolume:emptyReport.result.report.volume,unreadable:'not_found/resource_unavailable',foreignPerson:401,foreignURI:'resource_unavailable'})
 }finally{
  await native(P+'/agents/'+member.actor.id,{method:'PUT',body:{role:'operator'}})
 }
}
