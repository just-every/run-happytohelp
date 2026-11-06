import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative,resolve} from 'node:path'
import {startApp} from '../../journeys/kit/app.mjs'

/** The public router over real storage and sockets. A race pauses the committing
 * batch, runs a second HTTP request through that router, then resumes the first.
 * Notification faults are at the delivery edge, never in authorization. */
export async function ticketScopeRolesAssertions({before=false}={}){
 const root=resolve('.'),directory=await mkdtemp(join(tmpdir(),'hh-scope-roles-')),entry=join(directory,'worker.ts')
 await writeFile(entry,`import worker from ${JSON.stringify(join(root,'tests/journeys/kit/app-worker.ts'))};
 export {ConversationSocket} from ${JSON.stringify(join(root,'src/modules/conversations/socket.ts'))};
 export default {...worker,async fetch(request,env,ctx){
  const race=request.headers.get('x-scope-race');let nested;
  let current=env;
  if(request.headers.has('x-scope-publish-fail'))current={...current,CONVERSATIONS:{idFromName:env.CONVERSATIONS.idFromName.bind(env.CONVERSATIONS),get(){throw Error('Synthetic notification delivery failure')}}};
  if(race){
   const input=JSON.parse(race),DB=current.DB,raw=new WeakMap(),sqls=new WeakMap();let fired=false;
   const fire=async sqls=>{if(!fired&&sqls.some(sql=>new RegExp(input.pattern,'i').test(sql))){fired=true;const response=await worker.fetch(new Request(new URL(input.path,request.url),{method:input.method||'PUT',headers:{Authorization:'Bearer '+input.token,'Content-Type':'application/json'},...(input.body===undefined?{}:{body:JSON.stringify(input.body)})}),env,ctx);nested=response.status;await response.text()}};
   const wrap=(statement,sql)=>{const proxy=new Proxy(statement,{get(target,key){if(key==='bind')return(...values)=>wrap(target.bind(...values),sql);if(['run','all','first','raw'].includes(key))return async(...args)=>{await fire([sql]);return target[key](...args)};const value=target[key];return typeof value==='function'?value.bind(target):value}});raw.set(proxy,statement);sqls.set(proxy,sql);return proxy};
   current={...current,DB:{prepare:sql=>wrap(DB.prepare(sql),sql),exec:DB.exec.bind(DB),async batch(statements){
    await fire(statements.map(statement=>sqls.get(statement)||''));
    return DB.batch(statements.map(statement=>raw.get(statement)||statement));
   }}};
  }
  const response=await worker.fetch(request,current,ctx);
  if(nested!==undefined){const result=new Response(response.body,response);result.headers.set('x-scope-race-status',String(nested));return result}
  return response;
 }};`)
 const app=await startApp({entry:relative(root,entry),bindings:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development'}}),sockets=[]
 const check=(actual,expected,label)=>{if(!before)assert.deepEqual(actual,expected,label)}
 const probe=(point,door,result)=>console.log(`PROBE ACCESS-001 ${point} ${before?'BEFORE':'AFTER'}: ${door} -> ${JSON.stringify(result)}`)
 try{
  const w=await app.seedWorkspace('synthetic-hh-301'),foreign=await app.seedWorkspace('synthetic-hh-302'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`,R=P+'/roles'
  const a='synthetic-hh-301-a',b='synthetic-hh-301-b',empty={groupIds:[],includeUngrouped:false},selected={groupIds:[a],includeUngrouped:false}
  const call=(path,body,token=w.tokens.owner,method,headers)=>app.call(path,{body,token,method,headers})
  const good=async(path,body,token,method,headers)=>{const r=await call(path,body,token,method,headers);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data.data??r.data}
  for(const [id,project] of [[a,p],[b,p],['synthetic-hh-302-foreign',foreign.projectId]])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(id,project,id).run()
  await app.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('synthetic-hh-301-contact',?,'synthetic-hh-301@example.test','Synthetic customer',1)").bind(p).run()
  for(const [id,group] of [['synthetic-hh-301-visible',a],['synthetic-hh-301-hidden',b],['synthetic-hh-301-ungrouped',null]])await app.db.batch([
   app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,group_id,subject,revision,last_message_id,created_at,updated_at) VALUES(?,?,'synthetic-hh-301-contact',?,?,1,?,1,1)").bind(id,p,group,'Synthetic subject '+id,id+'-message'),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,'synthetic-hh-301-contact','contact',?,1,1)").bind(id+'-message',p,id,id+'-local','Synthetic transcript '+id),
  ])
  await app.db.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) SELECT project_id,conversation_id,id,created_at FROM messages').run()
  const definition={name:'Synthetic scope administration',base:'operator',permissions:['conversations.manage','conversations.reply','conversations.notes','conversations.follow']}
  const role=await good(R,definition),path=R+'/'+role.id,visible='synthetic-hh-301-visible',hidden='synthetic-hh-301-hidden'
  await good(`${P}/agents/${w.users.operator}`,{role:role.id},w.tokens.owner,'PUT')
  const store=async(value)=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=?').bind(value===null?null:typeof value==='string'?value:JSON.stringify(value),role.id).run()
  const stored=async()=>(await app.first('SELECT ticket_scope_json FROM project_roles WHERE id=?',role.id)).ticket_scope_json
  const save=(scope,extra={},headers)=>call(path,{...definition,...extra,...(scope===undefined?{}:{ticketScope:scope})},w.tokens.owner,'PUT',headers)
  const race=(pattern,path,body,method='PUT')=>({'x-scope-race':JSON.stringify({pattern,path,body,method,token:w.tokens.owner})})
  await app.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('synthetic-hh-303',?,'synthetic-hh-303@example.test','Synthetic recipient',1)").bind(p).run()
  // Concurrency first: a real role PUT, even a rename, invalidates a prepared write.
  await store(selected)
  const effects=async()=>({notes:await app.sql('SELECT * FROM conversation_notes'),participants:await app.sql('SELECT * FROM conversation_participants'),tags:await app.sql('SELECT * FROM workspace_tags'),contacts:await app.sql('SELECT * FROM contacts ORDER BY id')})
  const concurrency=[]
  for(const [door,body,pattern] of [[`${D}/${visible}/notes`,{content:'Synthetic stale note'},'INSERT INTO conversation_notes'],[`${D}/${visible}/participants`,{email:'synthetic-hh-303@example.test'},'INSERT INTO conversation_participants'],[`${D}/${visible}/tags`,{name:'Synthetic stale tag'},'INSERT INTO workspace_tags']]){
   const snapshot=await effects(),response=await call(door,body,w.tokens.operator,'POST',race(pattern,path,{...definition,name:'Synthetic renamed '+concurrency.length}))
   concurrency.push({status:response.status,roleSave:Number(response.headers.get('x-scope-race-status')),unchanged:JSON.stringify(snapshot)===JSON.stringify(await effects())});check(concurrency.at(-1),{status:409,roleSave:200,unchanged:true},door)
  }
  // Both serialization orders for group deletion and a role selecting it.
  const group=await good(P+'/ticket-groups',{name:'Synthetic raced group',members:[]}),selection={groupIds:[group.id],includeUngrouped:false}
  await store(null)
  const deleteFirst=await save(selection,{},race('UPDATE project_roles',P+'/ticket-groups/'+group.id,undefined,'DELETE'))
  check(deleteFirst.status,409,'deleted group cannot enter a role');check(Number(deleteFirst.headers.get('x-scope-race-status')),200)
  const second=await good(P+'/ticket-groups',{name:'Synthetic saved group',members:[]})
  await store(null)
  const saveFirst=await call(P+'/ticket-groups/'+second.id,undefined,w.tokens.owner,'DELETE',race('INSERT INTO audit_events',path,{...definition,ticketScope:{groupIds:[second.id],includeUngrouped:false}}))
  check(saveFirst.status,409,'role prevents group deletion');check(Number(saveFirst.headers.get('x-scope-race-status')),200)
  const dangling=await app.sql("SELECT r.id FROM project_roles r,json_each(CASE WHEN json_valid(r.ticket_scope_json) THEN r.ticket_scope_json ELSE NULL END,'$.groupIds') j LEFT JOIN ticket_groups g ON g.project_id=r.project_id AND g.id=j.value WHERE g.id IS NULL")
  check(dangling,[],'no dangling selection')
  const postGroup=await good(P+'/ticket-groups',{name:'Synthetic create race',members:[]})
  const postRace=await call(R,{...definition,name:'Synthetic create race',ticketScope:{groupIds:[postGroup.id],includeUngrouped:false}},w.tokens.owner,'POST',race('INSERT INTO project_roles',P+'/ticket-groups/'+postGroup.id,undefined,'DELETE'))
  check(postRace.status,409,'create rechecks group membership');check((await app.first("SELECT count(*) n FROM project_roles WHERE name='Synthetic create race'")).n,0)
  probe('P1','prepared note/participant/tag + role PUT rename; group DELETE / role PUT or POST in both orders',{commits:concurrency,deleteFirst:deleteFirst.status,saveFirst:saveFirst.status,post:postRace.status,dangling:dangling.length})
  probe('P2','none','erasure/retention untouched; role audit scope contains only group ids and a boolean')
  probe('P3','none','no money path changed or invoked')
  await store(null)
  const initial=await good(R),custom=initial.custom.find(r=>r.id===role.id)
  check((initial.groups??[]).map(g=>g.id).includes(a),true);check(custom.ticketScope,null);check(initial.builtIn.every(r=>!('ticketScope' in r)),true)
  const rejected=[]
  const rolesCount=async()=>(await app.first('SELECT count(*) n FROM project_roles WHERE project_id=?',p)).n
  for(const ticketScope of [{groupIds:['synthetic-hh-302-foreign'],includeUngrouped:false},{groupIds:'wrong',includeUngrouped:false},{groupIds:[a],includeUngrouped:1},{groupIds:[''],includeUngrouped:false},{groupIds:[a],includeUngrouped:false,extra:true},{groupIds:Array.from({length:1001},()=>a),includeUngrouped:false},[],false]){
   const snapshot=await app.first('SELECT * FROM project_roles WHERE id=?',role.id),result=await save(ticketScope)
   check(result.status,400);check(await app.first('SELECT * FROM project_roles WHERE id=?',role.id),snapshot);rejected.push(result.status)
   const count=await rolesCount(),created=await call(R,{...definition,name:'Synthetic invalid '+rejected.length,ticketScope});check(created.status,400);check(await rolesCount(),count)
  }
  for(const token of [w.tokens.operator,foreign.tokens.owner]){const r=await call(path,{...definition,ticketScope:selected},token,'PUT');check(r.status,403);rejected.push(r.status)}
  const adminRole=await good(R,{...definition,name:'Synthetic admin base',base:'admin'})
  if(!before){const snapshot=await app.first('SELECT * FROM project_roles WHERE id=?',role.id);check((await save(selected,{name:'Synthetic admin base'})).status,409);check(await app.first('SELECT * FROM project_roles WHERE id=?',role.id),snapshot)}
  check((await call(R+'/'+adminRole.id,{...definition,base:'admin',ticketScope:selected},w.tokens.admin,'PUT')).status,403)
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE user_id=?').bind(20*60*1000,w.users.owner).run()
  const stale=await save(selected);check(stale.status,403);check(stale.data.code,'step_up_required')
  await app.db.prepare('UPDATE session_factors SET verified_at=? WHERE user_id=?').bind(Date.now(),w.users.owner).run()
  check((await call(R+'/operator',{...definition,ticketScope:selected},w.tokens.owner,'PUT')).status,404)
  const dedup=await save({groupIds:[a,a],includeUngrouped:false});check(dedup.data.data.ticketScope,selected)
  probe('P4','GET roles; invalid/foreign scope, unauthorized/member/foreign, admin-base, built-in and stale-step-up PUT',{groups:initial.groups?.length??0,nullScope:custom.ticketScope,builtInUnscopable:initial.builtIn.every(r=>!('ticketScope' in r)),validation:rejected,stepUp:stale.status,admin:403,builtIn:404,dedup:dedup.data.data.ticketScope})
  const omissions=[]
  for(const value of ['{ "includeUngrouped": false, "groupIds": ["'+a+'"] }',JSON.stringify(empty),null]){await store(value);const response=await save(undefined);omissions.push({status:response.status,same:await stored()===value});check(omissions.at(-1),{status:200,same:true})}
  await save(selected);const reset=await save(null);check(reset.status,200);check(await stored(),null)
  const omitted=await good(R,{...definition,name:'Synthetic omitted scope'});check((await app.first('SELECT ticket_scope_json FROM project_roles WHERE id=?',omitted.id)).ticket_scope_json,null)
  await app.db.prepare('PRAGMA ignore_check_constraints=ON').run();await store('{')
  const corrupt=await save(undefined);check(corrupt.status,409);check(await stored(),'{');check((await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)).status,404)
  if(!before)for(const raw of ['null','{}','{"groupIds":[],"includeUngrouped":1}']){await store(raw);check((await save(undefined)).status,409);check(await stored(),raw)}
  await app.db.prepare('PRAGMA ignore_check_constraints=OFF').run()
  if(before)await store(null)
  await save(empty)
  const list=await call('/api/conversations',undefined,w.tokens.operator),counts=await call(`/api/dashboard/projects/${p}/conversations/counts`,undefined,w.tokens.operator),read=await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)
  check(list.data.conversations,[]);check(read.status,404);check(Object.values(counts.data.data).every(value=>value===0),true)
  probe('P5','omitted PUT selection/empty/null; explicit null; omitted POST; corrupt omission; explicit empty list/count/GET',{omissions,explicitNull:reset.status,post:omitted.ticketScope,corrupt:corrupt.status,emptyList:list.data.conversations?.length,counts:counts.data,read:read.status})
  // Audit before/after null, selection and empty, without ticket/customer text.
  const createdSelected=await good(R,{...definition,name:'Synthetic created selection',ticketScope:selected})
  const selectedAudit=JSON.parse((await app.first("SELECT detail_json FROM audit_events WHERE target_id=? AND action='role.created'",createdSelected.id)).detail_json).ticketScope
  check(selectedAudit,{before:null,after:selected})
  await save(null);await save(selected);await save(empty)
  const audit=(await app.sql("SELECT action,detail_json FROM audit_events WHERE target_id=? AND action IN ('role.created','role.updated') ORDER BY at,rowid",role.id)).map(row=>({action:row.action,...JSON.parse(row.detail_json)}))
  check(audit[0].ticketScope,{before:null,after:null});check(audit.slice(-3).map(r=>r.ticketScope),[{before:empty,after:null},{before:null,after:selected},{before:selected,after:empty}])
  check(audit.every(row=>!String(JSON.stringify(row.ticketScope)).includes('transcript')),true)
  probe('P6','role.created and role.updated audit detail',{created:audit[0].ticketScope,createdSelected:selectedAudit,transitions:audit.slice(-3).map(r=>r.ticketScope)})
  const connect=async(project=false,token=w.tokens.operator,after=0)=>{
   const response=await app.request(`${project?'/api/projects/'+p:'/api/conversations/'+visible}/socket?token=${token}&after=${after}`,{headers:{Upgrade:'websocket'}})
   if(response.status!==101)return {status:response.status,frames:[],closed:[]}
   const ws=response.webSocket,frames=[],closed=[];ws.accept();ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)));ws.addEventListener('close',event=>closed.push(event.code));sockets.push(ws);return {status:101,ws,frames,closed}
  }
  await save(null)
  const workspace=await connect(true),ticket=await connect(),ownerStream=await connect(false,w.tokens.owner)
  await app.until(()=>ticket.frames.some(frame=>frame.message))
  workspace.frames.length=0;ticket.frames.length=0
  const narrowed=await save(empty)
  if(!before)await app.until(()=>workspace.frames.some(frame=>frame.type==='access_changed'))
  ticket.ws.send(JSON.stringify({type:'ping'}))
  if(!before)await app.until(()=>ticket.closed.length)
  const denied=await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)
  check(denied.status,404);check(ticket.closed.includes(1008),true);check(ticket.frames.some(frame=>frame.message),false)
  const replay=await connect(false,w.tokens.operator);check(replay.status,404)
  await good(`${P}/agents/${w.users.operator}`,{role:'operator'},w.tokens.owner,'PUT')
  workspace.frames.length=0
  await good(`${P}/agents/${w.users.operator}`,{role:role.id},w.tokens.owner,'PUT')
  if(!before)await app.until(()=>workspace.frames.some(frame=>frame.type==='access_changed'))
  const assigned=workspace.frames.some(frame=>frame.type==='access_changed')
  await save(null);const failedPublish=await save(empty,{}, {'x-scope-publish-fail':'1'})
  check(failedPublish.status,200);check((await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)).status,404)
  probe('P7','open project/ticket streams + role narrowing; assignRole; forced notification failure',{save:narrowed.status,notified:workspace.frames.some(frame=>frame.type==='access_changed'),ticketClose:ticket.closed,hiddenFrames:ticket.frames.filter(f=>f.message).length,nextRequest:denied.status,replay:replay.status,assigned,publishFailureWrite:failedPublish.status})
  // Corrupt unrelated JSON must not make deletion crash.
  await app.db.prepare('PRAGMA ignore_check_constraints=ON').run();await app.db.prepare("UPDATE project_roles SET ticket_scope_json='{' WHERE id=?").bind(omitted.id).run();await app.db.prepare('PRAGMA ignore_check_constraints=OFF').run()
  const deletionGroup=await good(P+'/ticket-groups',{name:'Synthetic role-held group',members:[]})
  await save({groupIds:[deletionGroup.id],includeUngrouped:false})
  if(before)await store({groupIds:[deletionGroup.id],includeUngrouped:false})
  const inUse=await call(P+'/ticket-groups/'+deletionGroup.id,undefined,w.tokens.owner,'DELETE');check(inUse.status,409);check(/role.*uses.*remove.*selection/i.test(JSON.stringify(inUse.data)),true)
  await save(null);const removed=await call(P+'/ticket-groups/'+deletionGroup.id,undefined,w.tokens.owner,'DELETE');check(removed.status,200)
  const unused=await good(P+'/ticket-groups',{name:'Synthetic unused',members:[]});check((await call(P+'/ticket-groups/'+unused.id,undefined,w.tokens.owner,'DELETE')).status,200)
  probe('P8','DELETE selected group, then remove it from role and DELETE; corrupt unrelated row',{used:inUse.status,message:inUse.data,removed:removed.status,unused:200})
  await save(selected)
  if(before)await store(selected)
  const moving=await connect(),projectMoving=await connect(true)
  await app.until(()=>moving.frames.some(frame=>frame.message));moving.frames.length=0;projectMoving.frames.length=0
  const move=await call(`${D}/${visible}/ticket`,{group_id:b},w.tokens.owner,'PATCH');check(move.status,200)
  moving.ws.send(JSON.stringify({type:'replay'}));projectMoving.ws.send(JSON.stringify({type:'replay'}))
  if(!before)await app.until(()=>moving.closed.length)
  check(moving.closed.includes(1008),true);check(moving.frames.some(frame=>frame.message),false)
  check((await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)).status,404);check((await call(`${D}/${visible}/ticket`)).status,200)
  // A new hidden message exercises the project live frame and replay predicate.
  const frontier=await good('/api/conversations/'+visible,undefined,w.tokens.owner)
  await good('/api/conversations/'+visible+'/messages',{localId:'synthetic-hh-301-hidden-frame',content:'Synthetic hidden after move',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id},w.tokens.owner)
  projectMoving.ws.send(JSON.stringify({type:'ping'}));await app.until(()=>projectMoving.frames.some(frame=>frame.type==='pong'))
  check(JSON.stringify(projectMoving.frames).includes('Synthetic hidden after move'),false)
  await good(`${D}/${visible}/ticket`,{group_id:a},w.tokens.owner,'PATCH');check((await call(`${D}/${visible}/ticket`,undefined,w.tokens.operator)).status,200)
  probe('P9','owner moves visible ticket outside role selection; stream frame/replay/ping/GET, then moves back',{move:move.status,close:moving.closed,projectHidden:JSON.stringify(projectMoving.frames).includes('Synthetic hidden after move'),owner:200,hidden:404,restored:200})
 }finally{for(const socket of sockets)try{socket.close()}catch{}await app.close();await rm(directory,{recursive:true,force:true})}
}
