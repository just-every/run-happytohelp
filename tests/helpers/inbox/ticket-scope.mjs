import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// Extend the native ticket journey: public reads and staged uploads must use
// the same stored role selection as ticket mutations. Only provider I/O is fake.
export async function ticketDataScopeAssertions(){
 const provider=[]
 const app=await startApp({captureQueue:true,bindings:{INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update('synthetic-hh-10').digest('base64')},outbound:async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://api.hubapi.com');provider.push(u.pathname)
  if(u.pathname==='/oauth/v2/private-apps/get/access-token-info')return Response.json({hubId:123,scopes:['crm.objects.contacts.read','crm.objects.companies.read']})
  if(u.pathname==='/crm/v3/objects/contacts/11')return Response.json({id:'11',properties:{email:'synthetic-hh-11@example.test'},associations:{companies:{results:[]}}})
  throw Error('Unexpected synthetic provider request')
 }})
 const verify=(actual,expected,label)=>assert.deepEqual(actual,expected,label)
 let number=0
 const probe=(point,principal,door,r,summary)=>console.log(`PROBE ${++number} ${point} ${principal}: ${door} -> ${r.status}/${JSON.stringify(summary??r.data)}`)
 try{
  const w=await app.seedWorkspace('synthetic-hh-10'),foreign=await app.seedWorkspace('synthetic-hh-12'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}/conversations`,global='/api/dashboard/conversations',contact='synthetic-hh-11'
  const call=(path,token=w.tokens.admin,body,method,headers)=>app.call(path,{token,body,method,headers})
  const owner=(path,body,method)=>call(path,w.tokens.owner,body,method)
  const permissions=['conversations.manage','conversations.reply','conversations.notes','conversations.follow','contacts.manage','integrations.install','settings.manage']
  const roles=[]
  for(const [user,name] of [['admin','Synthetic selected'],['operator','Synthetic empty']]){
   const r=await owner(P+'/roles',{name,base:'admin',permissions},'POST');assert.equal(r.status,201)
   roles.push(r.data.data.id)
   assert.equal((await owner(`${P}/agents/${w.users[user]}`,{role:r.data.data.id},'PUT')).status,200)
  }
  await app.db.prepare("UPDATE sessions SET role='admin',revoked_at=NULL WHERE actor_id=?").bind(w.users.operator).run()
  const selected={groupIds:['synthetic-hh-allowed'],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
  const select=(scope,role=roles[0])=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(scope===null?null:JSON.stringify(scope),p,role).run()
  for(const id of ['synthetic-hh-allowed','synthetic-hh-hidden'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(id,p,id).run()
  await app.db.prepare('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,1)').bind(contact,p,'Synthetic customer','synthetic-hh-11@example.test').run()
  const allowed=Array.from({length:32},(_,i)=>`synthetic-hh-visible-${String(i).padStart(2,'0')}`),hidden=Array.from({length:35},(_,i)=>`synthetic-hh-hidden-${String(i).padStart(2,'0')}`)
  for(const [ids,group,stamp] of [[allowed,'synthetic-hh-allowed',1],[hidden,'synthetic-hh-hidden',1000]])for(const id of ids)await app.db.batch([
   app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,subject,revision,last_message_id,created_at,updated_at) VALUES(?,?,?,?,?,1,?,1,?)').bind(id,p,contact,group,'Synthetic scope '+id,id+'-message',stamp),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(id+'-message',p,id,id+'-local',contact,'Synthetic scope '+id,stamp),
   app.db.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) VALUES(?,?,?,1)').bind(p,id,id+'-message'),
  ])
  const target=allowed[0],secret=hidden[1]
  const company=await owner(P+'/companies',{name:'Synthetic scope company'},'POST');assert.equal(company.status,201)
  const companyId=company.data.company.id
  assert.equal((await owner(`${P}/companies/${companyId}/members/${contact}`,{},'PUT')).status,200)
  await app.db.batch([
   app.db.prepare("INSERT INTO conversation_merges(id,project_id,source_id,target_id,actor_id,created_at,source_version,target_version,source_revision,target_revision) VALUES('synthetic-hh-merge',?,?,?,?,1,0,0,1,1)").bind(p,hidden[0],target,w.users.owner),
   app.db.prepare('INSERT INTO ticket_problems(project_id,conversation_id,version,created_at) VALUES(?,?,1,1)').bind(p,target),
   ...[allowed[1],secret].map(id=>app.db.prepare('INSERT INTO ticket_problem_incidents(project_id,problem_id,incident_id,created_at) VALUES(?,?,?,1)').bind(p,target,id)),
   app.db.prepare('INSERT INTO email_followup_links(project_id,parent_id,conversation_id,created_at) VALUES(?,?,?,1)').bind(p,target,secret),
   app.db.prepare("INSERT INTO ticket_followups(id,project_id,original_id,conversation_id,command_key,created_at) VALUES('synthetic-hh-followup',?,?,?,'synthetic-hh-command',1)").bind(p,target,hidden[2]),
  ])
  for(const id of [target,secret])await app.db.batch([
   app.db.prepare("INSERT INTO notification_trigger_claims(id,project_id,conversation_id,event,claim_token,state,outcome_json,created_at) VALUES(?,?,?,'ticket_updated','synthetic-hh-claim','complete','{}',1)").bind(id+'-claim',p,id),
   ...['admin','operator'].map(user=>app.db.prepare("INSERT INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,created_at) VALUES(?,?,?,?,'follower',1,0,1)").bind(id+'-notice-'+user,p,id,w.users[user])),
  ])
  await app.db.prepare('UPDATE conversations SET assigned_to=? WHERE project_id=?').bind(w.users.admin,p).run()
  for(const group of ['synthetic-hh-allowed','synthetic-hh-hidden'])await app.db.prepare('INSERT INTO ticket_group_members(project_id,group_id,user_id) VALUES(?,?,?)').bind(p,group,w.users.admin).run()
  const crm=P+'/crm/hubspot'
  assert.equal((await owner(crm,{token:'synthetic-hh-13',account_id:'123',properties:{}},'PUT')).status,200)
  assert.equal((await owner(crm+'/contacts/'+contact,{source_contact_id:'11'},'PUT')).status,200)
  const files=await app.files
  for(const id of [target,secret]){
   await files.put(id+'-object','Synthetic stored bytes')
   await app.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,'synthetic.txt','text/plain',22,?,1)").bind(id+'-media',p,id,w.users.owner,id+'-object',id+'-message').run()
  }
  await select(selected);await select(empty,roles[1])
  const principals=[['allowed',w.tokens.admin],['denied',w.tokens.operator],['other-tenant',foreign.tokens.owner]]
  const clean=(r)=>!JSON.stringify(r.data).includes('synthetic-hh-hidden-')
  // Newer hidden rows outnumber a page. Both list/search and totals must first
  // select the permitted cohort, including global and contact-history lists.
  for(const [principal,token] of principals){
   for(const prefix of [D,global])for(const search of ['', '?search=Synthetic']){
    const path=prefix+search,r=await call(path,token),rows=r.data?.data??[]
    probe('cohort',principal,'GET '+path,r,{ids:rows.map(x=>x.id),pagination:r.data?.meta?.pagination})
    if(principal==='allowed'){verify(r.status,200,path);verify(rows.length,30,'full first page');verify(r.data.meta.pagination.total,32,'permitted total');verify(clean(r),true,'hidden list metadata')}
    else if(r.status===200){verify(rows.length,0,path);verify(r.data.meta.pagination.total,0,path)}else verify(r.status,403,path)
   }
   const native=await call('/api/conversations',token);probe('native-list',principal,'GET /api/conversations',native,{count:native.data?.conversations?.length,hidden:!clean(native)});verify(native.status,200,'native list');verify(native.data.conversations.length,principal==='allowed'?32:0,'native cohort');verify(clean(native),true,'native hidden metadata')
   for(const prefix of [D,global]){
    const path=prefix+'/counts',r=await call(path,token);probe('counts',principal,'GET '+path,r)
    if(r.status===200)for(const key of ['mine','open','unread'])verify(r.data.data[key],principal==='allowed'?32:0,key)
    else verify(r.status,403,path)
   }
   const paths=[`${D}/${target}`,`${D}/${target}/ticket`,`${D}/${target}/buckets`,`/api/conversations/${target}`,`/api/conversations/${target}/messages`,`/api/conversations/${target}/media/${target}-media`,`${P}/conversations/${target}/routing`,`${P}/conversations/${target}/email-followups`,`${P}/conversations/${target}/crm`,`${D}/${target}/ticket/problem`]
   for(const path of paths){
    const r=await call(path,token);probe('ticket',principal,'GET '+path,r,{visible:r.status===200,hidden:!clean(r)})
    verify(r.status,principal==='allowed'?200:principal==='other-tenant'&&path.startsWith(P)?403:404,path)
    verify(clean(r),true,path)
    if(r.status===200&&path.endsWith('/ticket/problem')){verify(r.data.data.incident_count,1,'visible incident count');verify(r.data.data.incidents.map(x=>x.id),[allowed[1]],'visible incident cohort')}
   }
   const related=[`${P}/companies/${companyId}`,`${D}/${target}/merged-history`,`${D}/${target}/merges`,`${D}/${target}/partner-forwards`,`${P}/notification-triggers`,`${P}/notification-inbox`,`${P}/contacts/${contact}/conversations`,`${P}/routing-operators`,`${D.slice(0,-14)}/ticket-problem-search?q=Synthetic`]
   for(const path of related){
    const r=await call(path,token);probe('related',principal,'GET '+path,r,{hidden:!clean(r),count:r.data?.data?.length??r.data?.tickets?.length})
    verify(clean(r),true,path)
    if(principal==='allowed')verify(r.status,200,path)
   }
   const previewPath=`${D}/${target}/ticket/problem/solve/preview`,preview=await call(previewPath,token,{reply:'Synthetic recovery',solve_incidents:false},'POST')
   probe('problem-preview',principal,'POST '+previewPath,preview,{error:preview.data?.error,hidden:!clean(preview),ids:preview.data?.data?.results?.map(x=>x.id)})
   verify(clean(preview),true,'problem preview cohort')
   if(principal==='allowed')verify(preview.status,200,'permitted problem preview')
   const beforeProvider=provider.length,refreshPath=`${P}/conversations/${target}/crm/refresh`,refresh=await call(refreshPath,token,{},'POST')
   probe('crm-refresh',principal,'POST '+refreshPath,refresh,{providerCalls:provider.length-beforeProvider,state:refresh.data?.state})
   verify(refresh.status,principal==='allowed'?200:principal==='other-tenant'?403:404,refreshPath)
   verify(provider.length>beforeProvider,principal==='allowed','provider admission')
  }
  // Selected role cannot use the hidden detail, byte or related-data doors.
  for(const path of [`${D}/${secret}`,`/api/conversations/${secret}`,`/api/conversations/${secret}/messages`,`/api/conversations/${secret}/media/${secret}-media`,`${P}/conversations/${secret}/email-followups`,`${P}/conversations/${secret}/crm/refresh`]){
   const r=await call(path,w.tokens.admin,path.endsWith('/refresh')?{}:undefined);probe('hidden-target','denied','GET/POST '+path,r);verify(r.status,404,path)
   const missing=await call(path.replaceAll(secret,'synthetic-hh-missing'),w.tokens.admin,path.endsWith('/refresh')?{}:undefined)
   verify(r.data,missing.data,'hidden and missing have the same refusal')
  }
  const snapshot=async()=>({rows:await app.sql('SELECT * FROM media ORDER BY id'),objects:(await files.list()).objects.map(o=>o.key).sort()})
  const upload=async(kind,id,token,headers={})=>{
   if(kind==='native')return app.call(`/api/conversations/${id}/media`,{token,method:'POST',raw:true,body:'Synthetic upload',headers:{'Content-Type':'text/plain','X-Filename':'synthetic.txt',...headers}})
   const form=new FormData();form.set('conversation_id',id);form.set('file',new File(['Synthetic upload'],'synthetic.txt',{type:'text/plain'}));const request=new Request('https://example.test',{method:'POST',body:form})
   return app.call(`/api/dashboard/projects/${p}/media`,{token,method:'POST',raw:true,body:await request.arrayBuffer(),headers:{'Content-Type':request.headers.get('Content-Type'),...headers}})
  }
  for(const kind of ['native','dashboard']){
   for(const [principal,token] of principals){const before=await snapshot(),r=await upload(kind,target,token);probe('upload',principal,kind+' '+target,r,{stored:(await snapshot()).rows.length-before.rows.length});verify(r.status,principal==='allowed'?201:principal==='other-tenant'&&kind==='dashboard'?403:404,kind);if(principal!=='allowed')verify(await snapshot(),before,'refused before persistence')}
   const before=await snapshot(),r=await upload(kind,secret,w.tokens.admin);probe('upload-hidden','denied',kind+' '+secret,r);verify(r.status,404,kind);verify(await snapshot(),before,'hidden upload stores nothing')
   const revoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE id='${roles[0]}' AND project_id='${p}'`,staged=await snapshot()
   const race=await upload(kind,target,w.tokens.admin,{'x-test-statement':'INSERT INTO media','x-test-before-statement':revoke})
   probe('upload-revocation','denied',kind+' scope narrowed after staging',race,{unchanged:JSON.stringify(await snapshot())===JSON.stringify(staged)})
   verify(race.status,409,'commit revocation');verify(await snapshot(),staged,'staged bytes removed');await select(selected)
  }
  // Merge admission cannot use a hidden source, even if its target is visible.
  for(const [principal,token] of principals){const path=`${D}/${target}/merge`,r=await call(path,token,{source_id:secret,source_version:0,target_version:0},'POST');probe('merge',principal,path,r);verify(r.status,404,'hidden merge source');verify((await app.first('SELECT count(*) n FROM conversation_merges')).n,1,'no hidden merge committed')}
  // NULL scope and native owner recovery retain the unscoped cohort.
  await select(null)
  for(const [principal,token] of [['NULL',w.tokens.admin],['owner',w.tokens.owner]]){
   const r=await call(D,token);probe('compatibility',principal,'GET '+D,r,{total:r.data?.meta?.pagination?.total});verify(r.status,200,'unrestricted');verify(r.data.meta.pagination.total,66,'unchanged native cohort')
  }
  await select(selected)
  await app.db.prepare("INSERT INTO conversation_merges(id,project_id,source_id,target_id,actor_id,created_at,source_version,target_version,source_revision,target_revision) VALUES('synthetic-hh-reverse',?,?,?,?,1,0,0,1,1)").bind(p,allowed[31],hidden[34],w.users.owner).run()
  for(const suffix of ['', '/merged-history','/merges','/partner-forwards']){
   const path=`${D}/${allowed[31]}${suffix}`,r=await call(path);probe('hidden-survivor','allowed','GET '+path,r,{hidden:!clean(r)});verify(r.status,200,path);verify(clean(r),true,'hidden merge survivor metadata')
  }
  console.log('SCOPE_DATA_TOTAL='+number)
 }catch(error){console.error(error);throw error}finally{await app.close()}
}
