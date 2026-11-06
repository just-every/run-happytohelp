import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative,resolve} from 'node:path'
import {startApp} from '../../journeys/kit/app.mjs'

// Public native doors over the usual D1/R2 fixture. Stored scope and the
// deterministic concurrent revocation are SQL fixtures; only provider I/O is fake.
// Extend the existing ticket journey without adding a runner registration.
export async function ticketResidualScopeAssertions({before=false}={}){
 const temporary=await mkdtemp(join(tmpdir(),'hh-residual-')),root=resolve('.'),entry=join(temporary,'worker.ts')
 await writeFile(entry,`import worker from ${JSON.stringify(join(root,'tests/journeys/kit/app-worker.ts'))};export {ConversationSocket} from ${JSON.stringify(join(root,'tests/journeys/kit/app-worker.ts'))};export default {...worker,fetch(request,env,ctx){if(request.headers.has('x-residual-forbid-file-get'))env={...env,FILES:new Proxy(env.FILES,{get(target,key){if(key==='get')return ()=>{throw Error('Unexpected FILES.get')};const value=target[key];return typeof value==='function'?value.bind(target):value}})};return worker.fetch(request,env,ctx)}}`)
 const provider=[],templates=[{id:'synthetic-hh-80-template',name:'support_update',status:'APPROVED',language:'en_US',category:'UTILITY',components:[{type:'BODY',text:'Your order {{1}} is ready.'}]}]
 const app=await startApp({entry:relative(root,entry),captureQueue:true,bindings:{INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update('synthetic-hh-80').digest('base64')},outbound:async request=>{
  const url=new URL(request.url);provider.push(url.pathname)
  if(url.hostname==='graph.facebook.com'&&url.pathname.endsWith('/message_templates'))return Response.json({data:templates})
  if(url.hostname==='graph.facebook.com'&&request.method==='POST')return Response.json({messages:[{id:'synthetic-hh-80-send'}]})
  throw Error('Unexpected residual provider request: '+url.hostname+url.pathname)
 }})
 const phase=before?'BEFORE':'AFTER',check=(actual,expected,label)=>{if(!before)assert.deepEqual(actual,expected,label)}
 const probe=(point,input,output)=>console.log(`PROBE ACCESS-001 ${point} ${phase}: ${input} -> ${JSON.stringify(output)}`)
 try{
  const w=await app.seedWorkspace('synthetic-hh-80'),foreign=await app.seedWorkspace('synthetic-hh-81'),p=w.projectId,P=`/api/management/projects/${p}`,C=`/api/support-channels/projects/${p}`,M='/api/mobile/v1',X=`/api/customer-context/${p}`
  const call=(path,body,token=w.tokens.admin,method,headers)=>app.call(path,{body,token,method,headers})
  const ok=async(path,body,token=w.tokens.owner,method)=>{const r=await call(path,body,token,method);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data}
  const permissions=['conversations.manage','conversations.reply','conversations.notes','conversations.follow','contacts.manage','integrations.install','settings.manage']
  const roles=[]
  for(const [user,name] of [['admin','Selected'],['operator','Empty']]){
   const role=(await ok(P+'/roles',{name:'Synthetic residual '+name,base:'admin',permissions})).data.id;roles.push(role)
   await ok(`${P}/agents/${w.users[user]}`,{role},w.tokens.owner,'PUT')
  }
  await app.db.prepare("UPDATE sessions SET role='admin',revoked_at=NULL WHERE actor_id=?").bind(w.users.operator).run()
  const selected={groupIds:['synthetic-hh-80-a'],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false}
  const select=(scope,role=roles[0])=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(scope===null?null:JSON.stringify(scope),p,role).run()
  const revoke=`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(empty)}' WHERE project_id='${p}' AND id='${roles[0]}'`
  for(const group of ['synthetic-hh-80-a','synthetic-hh-80-b'])await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(group,p,group).run()
  for(const group of ['synthetic-hh-80-a','synthetic-hh-80-b'])for(const user of Object.values(w.users))await app.db.prepare('INSERT INTO ticket_group_members(project_id,group_id,user_id) VALUES(?,?,?)').bind(p,group,user).run()
  const mixed='synthetic-hh-80-mixed',visible='synthetic-hh-80-visible',unticketed='synthetic-hh-80-none'
  for(const contact of [mixed,visible,unticketed])await app.db.prepare('INSERT INTO contacts(id,project_id,name,email,created_at) VALUES(?,?,?,?,1)').bind(contact,p,contact,contact+'@example.test').run()
  const allowed=['synthetic-hh-80-ticket-a','synthetic-hh-80-ticket-b'],hidden=Array.from({length:101},(_,i)=>`synthetic-hh-80-hidden-${String(i).padStart(3,'0')}`)
  for(const [ids,group,stamp] of [[allowed,'synthetic-hh-80-a',1],[hidden,'synthetic-hh-80-b',1000]])for(const id of ids){
   const contact=id===allowed[1]?visible:mixed
   await app.db.batch([
    app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,subject,assigned_to,revision,last_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,1,?)').bind(id,p,contact,group,'Synthetic subject '+id,w.users.admin,id+'-message',stamp),
    app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,1)").bind(id+'-message',p,id,id+'-local',contact,'Synthetic content '+id),
   ])
  }
  const target=allowed[0],secret=hidden[0],files=await app.files
  for(const id of [target,secret]){
   await files.put(id+'-object','Synthetic bytes '+id)
   await app.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,'synthetic.txt','text/plain',30,?,1)").bind(id+'-media',p,id,w.users.owner,id+'-object',id+'-message').run()
  }
  const connection=(await ok(C+'/connections',{provider:'whatsapp',account:'synthetic-hh-80-account',sender:'synthetic-hh-80-sender',token:'synthetic-hh-80-credential',signing_secret:'synthetic-hh-80-signing',registered:true})).data
  for(const id of [target,secret])await app.db.prepare('INSERT INTO support_channel_threads(id,project_id,connection_id,contact_id,conversation_id,identity_hash,recipient,channel_id,thread_key,last_inbound_at,template_consent) VALUES(?,?,?,?,?,?,?,?,?,0,1)').bind(id+'-thread',p,connection.id,mixed,id,id+'-identity','synthetic-hh-80-recipient','synthetic-hh-80-channel',id).run()
  const now=Date.now()
  const hold=async(id,candidate)=>{
   await app.db.batch([
    app.db.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at) VALUES(?,?,?,'synthetic-hh-80-intent','suspended',?)").bind(id+'-receipt',p,candidate,now),
    app.db.prepare("INSERT INTO suspended_emails(id,project_id,receipt_id,from_address,to_json,subject,text,reason,auth_json,headers_json,candidate_conversation_id,input_json,created_at,expires_at) VALUES(?,?,?,?,'[]','Synthetic held subject','Synthetic held content','sender_unproven','{}','{}',?, ?,?,?)").bind(id,p,id+'-receipt',mixed+'@example.test',candidate,JSON.stringify({attachments:[]}),now,now+86400000),
   ])
  }
  await hold('synthetic-hh-80-hold',secret)
  await app.db.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at,claim_token) VALUES(?,?,?,'synthetic-hh-80-intent','processing',?,'synthetic-hh-80-claim')").bind('synthetic-hh-80-receipt',p,secret,now).run()
  await app.db.prepare("INSERT INTO inbound_emails(id,project_id,intent_hash,state,created_at) VALUES(?,?,'synthetic-hh-80-intent','processing',?)").bind('synthetic-hh-80-ticketless',p,now).run()
  for(const subject of [mixed,visible,unticketed])await app.db.batch([
   app.db.prepare('INSERT INTO context_subjects(project_id,subject_id,consent,bot_enabled) VALUES(?,?,1,1) ON CONFLICT(project_id,subject_id) DO UPDATE SET consent=1,bot_enabled=1').bind(p,subject),
   app.db.prepare("INSERT INTO context_evidence(id,project_id,subject_id,source,content,visibility,occurred_at) VALUES(?,?,?,'customer_message',?,'private_operational_evidence',1)").bind(subject+'-evidence',p,subject,subject===mixed?'Synthetic content '+secret:'Synthetic visible evidence'),
   app.db.prepare("INSERT INTO context_profiles(project_id,subject_id,type,profile) VALUES(?,?,'contact',?)").bind(p,subject,JSON.stringify({summary:subject===mixed?'Synthetic content '+secret:'Synthetic visible profile'})),
   app.db.prepare("INSERT INTO context_insights(id,project_id,subject_id,help_type,content,buttons,evidence_ids,created_at) VALUES(?,?,?,'support',?,'[]','[]',1)").bind(subject+'-insight',p,subject,subject===mixed?'Synthetic content '+secret:'Synthetic visible insight'),
   app.db.prepare("INSERT INTO context_jobs(id,project_id,subject_id,kind,state,source_revision,packet_json,model,created_at,result_json) VALUES(?,?,?,'contact','completed',0,'{}','synthetic-hh-80-model',1,?)").bind(subject+'-job',p,subject,JSON.stringify({summary:subject===mixed?'Synthetic content '+secret:'Synthetic visible job'})),
  ])
  await app.db.prepare("INSERT INTO mailbox_connections(id,project_id,provider,status,address,created_at,updated_at,connected_by) VALUES(?,?,'forwarding','connected','synthetic-hh-80-support@example.test',1,1,?)").bind('synthetic-hh-80-mailbox',p,w.users.owner).run()
  await select(selected);await select(empty,roles[1])
  const pair=async token=>(await ok(M+'/devices',{platform:'ios',scopes:['read','push','attachments']},token)).token
  const devices={selected:await pair(w.tokens.admin),empty:await pair(w.tokens.operator),owner:await pair(w.tokens.owner),foreign:await pair(foreign.tokens.owner)}
  await call(M+'/push',{enabled:true},devices.selected,'PUT')
  const addNotice=async(id,ticket)=>app.db.prepare("INSERT INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,created_at) VALUES(?,?,?,?,'assignment',1,0,?)").bind(id,p,ticket,w.users.admin,Date.now()+1000).run()
  await addNotice('synthetic-hh-80-notice-a',target)
  await call(M+'/push/prepared',undefined,devices.selected)
  const link=await app.first('SELECT id FROM mobile_links WHERE conversation_id=? AND device_id=(SELECT id FROM mobile_devices WHERE user_id=?)',target,w.users.admin);assert.ok(link)
  const snapshot=async()=>({conversations:await app.sql('SELECT id FROM conversations ORDER BY id'),commands:await app.sql('SELECT * FROM operator_ticket_commands ORDER BY local_id'),history:await app.sql('SELECT * FROM ticket_history ORDER BY id'),audits:await app.sql("SELECT id FROM audit_events WHERE action='ticket.created' ORDER BY id")})
  const ticketBody=(localId,group='synthetic-hh-80-a')=>({kind:'call',localId,requesterId:visible,subject:'Synthetic created ticket',content:'Synthetic call',groupId:group})
  // Concurrency first: the stored selection changes without changing the role
  // timestamp, isolating this predicate from the older role-version guard.
  const frontier=await snapshot(),race=await call(P+'/tickets',ticketBody('synthetic-hh-80-race'),w.tokens.admin,'POST',{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':revoke})
  const narrowed=await call(M+'/links/'+link.id,undefined,devices.selected)
  probe('P1', 'POST /tickets scope narrowed before INSERT; GET /links minted while visible', {create:race.status,unchanged:JSON.stringify(await snapshot())===JSON.stringify(frontier),link:narrowed.status})
  check(race.status,409,'creation revocation');check(await snapshot(),frontier,'scope loss creates no ticket/command/history/audit');assert.equal(narrowed.status,401,'stored role update retains native device retirement')
  await select(selected)
  devices.selected=await pair(w.tokens.admin)
  await call(M+'/push',{enabled:true},devices.selected,'PUT')
  await app.db.prepare('UPDATE notification_inbox SET created_at=? WHERE id=?').bind(Date.now()+1000,'synthetic-hh-80-notice-a').run()
  await call(M+'/push/prepared',undefined,devices.selected)
  const currentLink=await app.first('SELECT l.id FROM mobile_links l JOIN mobile_devices d ON d.id=l.device_id WHERE l.conversation_id=? AND d.user_id=? AND d.revoked_at IS NULL',target,w.users.admin)
  assert.ok(currentLink)
  await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind('synthetic-hh-80-b',target).run()
  const movedLink=await call(M+'/links/'+currentLink.id,undefined,devices.selected)
  probe('P1','visible-minted link after ticket leaves current selected cohort',{link:movedLink.status})
  check(movedLink.status,404,'link rechecks ticket cohort')
  await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind('synthetic-hh-80-a',target).run()
  probe('P2 erasure','none','no erasure/retention code changed; context schema and erasure custody retained')
  probe('P3 money','none','no money path changed or invoked')
  for(const [principal,token,expected] of [['selected',devices.selected,allowed],['empty',devices.empty,[]],['foreign',devices.foreign,[]]]){
   const r=await call(M+'/tickets',undefined,token),ids=r.data.tickets?.map(t=>t.id).sort()
   probe('P4',`GET /mobile/tickets ${principal}`,{status:r.status,ids});assert.equal(r.status,200);check(ids,[...expected].sort(),'mobile permitted cohort before LIMIT')
  }
  await addNotice('synthetic-hh-80-notice-b',secret)
  const prepared=await call(M+'/push/prepared',undefined,devices.selected),hiddenLinks=await app.sql('SELECT id FROM mobile_links WHERE conversation_id=?',secret)
  const bytes=await call(M+`/tickets/${secret}/attachments/${secret}-media`,undefined,devices.selected,'GET',before?{}:{'x-residual-forbid-file-get':'1'})
  probe('P5','GET hidden mobile bytes/prepared/link',{bytes:bytes.status,body:bytes.data,payloads:prepared.data.payloads?.length,hiddenLinks:hiddenLinks.length})
  check(bytes.status,404,'hidden bytes refused before FILES.get');check(hiddenLinks.length,0,'no hidden link minted');check(prepared.data.payloads.length,1,'hidden prepared omitted')
  for(const token of [devices.empty,devices.foreign]){
   const r=await call(M+`/tickets/${target}/attachments/${target}-media`,undefined,token,'GET',before?{}:{'x-residual-forbid-file-get':'1'})
   check(r.status,404,'empty/foreign mobile bytes')
  }
  if(!before){
   const missing=await call(M+'/tickets/synthetic-hh-80-missing/attachments/synthetic-hh-80-missing',undefined,devices.selected)
   assert.deepEqual(bytes.data,missing.data,'hidden and missing mobile attachments')
  }
  const goodBytes=await call(M+`/tickets/${target}/attachments/${target}-media`,undefined,devices.selected);assert.equal(goodBytes.status,200);assert.match(goodBytes.data,/Synthetic bytes/)
  for(const [principal,token,ticket,visibleThread] of [['allowed',w.tokens.admin,target,true],['denied',w.tokens.admin,secret,false],['empty',w.tokens.operator,target,false],['other-tenant',foreign.tokens.owner,target,false]]){
   const path=C+'/conversations/'+ticket,thread=await call(path,undefined,token),count=provider.length,list=await call(path+'/templates',undefined,token),send=await call(path+'/templates',{template_id:templates[0].id,local_id:'synthetic-hh-80-template-'+principal,parameters:['123'],expected_revision:1},token)
   probe('P6',`channel thread/templates list/send ${principal}`,{thread:thread.status,data:thread.data,templates:list.status,send:send.status,provider:provider.length-count})
   if(principal==='other-tenant'){assert.equal(thread.status,403);assert.equal(list.status,403);assert.equal(send.status,403)}else if(visibleThread){assert.equal(thread.status,200);assert.ok(thread.data.data);assert.equal(list.status,200);assert.equal(send.status,200)}else{check(thread.data,{data:null},'hidden thread shape');check(list.status,404,'hidden template read');check(send.status,404,'hidden template send');check(provider.length,count,'no hidden provider request')}
  }
  const mailSnapshot=async()=>({notes:await app.sql('SELECT * FROM conversation_notes ORDER BY id'),messages:await app.sql('SELECT id FROM messages ORDER BY id'),held:await app.sql('SELECT * FROM suspended_emails ORDER BY id'),receipts:await app.sql('SELECT * FROM inbound_emails ORDER BY id'),audit:await app.sql("SELECT id FROM audit_events WHERE action LIKE 'email.suspended_recovered%' ORDER BY id")})
  const list=await call(P+'/suspended'),detail=await call(P+'/suspended/synthetic-hh-80-hold'),prior=await mailSnapshot(),recover=await call(P+'/suspended/synthetic-hh-80-hold/recover',{conversationId:secret,asNote:true})
  probe('P7','suspended hidden candidate list/detail; recover as note',{candidate:list.data.data.find(r=>r.id==='synthetic-hh-80-hold')?.candidate_conversation_id,detail:detail.data.data.candidate_conversation_id,recover:recover.status,unchanged:JSON.stringify(await mailSnapshot())===JSON.stringify(prior)})
  check(list.data.data.find(r=>r.id==='synthetic-hh-80-hold').candidate_conversation_id,null,'masked candidate list');check(detail.data.data.candidate_conversation_id,null,'masked candidate detail');check(recover.status,404,'hidden recovery');check(await mailSnapshot(),prior,'no hidden recovery effect')
  await hold('synthetic-hh-80-hold-release',secret)
  await app.db.prepare("UPDATE suspended_emails SET auth_json='{\"verified\":true}' WHERE id=?").bind('synthetic-hh-80-hold-release').run()
  const releasePrior=await mailSnapshot(),release=await call(P+'/suspended/synthetic-hh-80-hold-release/recover',{conversationId:secret})
  probe('P7','verified suspended release into hidden ticket',{status:release.status,unchanged:JSON.stringify(await mailSnapshot())===JSON.stringify(releasePrior)})
  check(release.status,404,'hidden public recovery');check(await mailSnapshot(),releasePrior,'no release/receiveEmail/deletion/audit')
  if(!before){
   const missing=await call(P+'/suspended/synthetic-hh-80-hold/recover',{conversationId:'synthetic-hh-80-missing',asNote:true})
   assert.deepEqual(recover.data,missing.data,'hidden and missing recovery target')
   await hold('synthetic-hh-80-hold-race',target)
   const beforeRace=await mailSnapshot(),noteRace=await call(P+'/suspended/synthetic-hh-80-hold-race/recover',{conversationId:target,asNote:true},w.tokens.admin,'POST',{'x-test-statement':'INSERT OR IGNORE INTO conversation_notes','x-test-before-statement':revoke})
   probe('P7','scope lost at recovery note INSERT',{status:noteRace.status,unchanged:JSON.stringify(await mailSnapshot())===JSON.stringify(beforeRace)})
   assert.equal(noteRace.status,409);assert.deepEqual(await mailSnapshot(),beforeRace,'note revocation changes no receipt, note, message or success audit')
   await select(selected)
  }
  if(before)await hold('synthetic-hh-80-hold-allowed',target)
  const allowHold=before?'synthetic-hh-80-hold-allowed':'synthetic-hh-80-hold'
  const allowedRecovery=await call(P+'/suspended/'+allowHold+'/recover',{conversationId:target,asNote:true});assert.equal(allowedRecovery.status,200)
  await hold('synthetic-hh-80-hold-new',null)
  const newPrior=await snapshot(),newRecovery=await call(P+'/suspended/synthetic-hh-80-hold-new/recover',{conversationId:'',asNote:true})
  probe('P7','suspended allowed target; ungrouped recovery',{allowed:allowedRecovery.status,ungrouped:newRecovery.status,unchanged:JSON.stringify(await snapshot())===JSON.stringify(newPrior)})
  check(newRecovery.status,403,'new recovery obeys ungrouped destination');check(await snapshot(),newPrior,'no recovery ticket')
  const receiptPath=P+'/inbound-emails/synthetic-hh-80-receipt',receipt=await call(receiptPath),receiptPrior=await app.first('SELECT * FROM inbound_emails WHERE id=?','synthetic-hh-80-receipt'),reconcile=await call(receiptPath+'/reconcile',{createdAt:now,intentHash:'synthetic-hh-80-intent',conversationId:secret,claimToken:'synthetic-hh-80-claim',priorExecutionEnded:true})
  probe('P8','GET/reconcile hidden inbound receipt',{get:receipt.status,reconcile:reconcile.status,unchanged:JSON.stringify(await app.first('SELECT * FROM inbound_emails WHERE id=?','synthetic-hh-80-receipt'))===JSON.stringify(receiptPrior)})
  check(receipt.status,404,'hidden receipt');check(reconcile.status,404,'hidden receipt reconcile');check(await app.first('SELECT * FROM inbound_emails WHERE id=?','synthetic-hh-80-receipt'),receiptPrior,'receipt unchanged')
  assert.equal((await call(receiptPath,undefined,w.tokens.owner)).status,200);assert.equal((await call(P+'/inbound-emails/synthetic-hh-80-ticketless')).status,200)
  for(const [name,group,expected] of [['inside','synthetic-hh-80-a',201],['outside','synthetic-hh-80-b',403],['ungrouped',null,403]]){
   const prior=await snapshot(),r=await call(P+'/tickets',ticketBody('synthetic-hh-80-create-'+name,group))
   probe('P9',`POST /tickets ${name}`,{status:r.status,unchanged:JSON.stringify(await snapshot())===JSON.stringify(prior)})
   if(name==='inside'){
    assert.equal(r.status,201)
    const created=r.data.conversation.id
    await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind('synthetic-hh-80-b',created).run()
    const replayPrior=await snapshot(),replay=await call(P+'/tickets',ticketBody('synthetic-hh-80-create-'+name,group))
    probe('P9','replay of a created ticket that moved outside selection',{status:replay.status,hiddenId:JSON.stringify(replay.data).includes(created)})
    check(replay.status,404,'hidden creation replay');check(JSON.stringify(replay.data).includes(created),false,'replay conceals hidden id');check(await snapshot(),replayPrior,'hidden replay changes no ticket history')
    await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind(group,created).run()
   }else{check(r.status,expected,'destination refused');check(r.data.error,'Your role does not allow the destination group.','S1 destination refusal text');check(await snapshot(),prior,'destination refused before writes')}
  }
  const emptyPrior=await snapshot(),emptyCreate=await call(P+'/tickets',ticketBody('synthetic-hh-80-create-empty'),w.tokens.operator)
  check(emptyCreate.status,403,'empty selection cannot create');check(await snapshot(),emptyPrior,'empty destination creates nothing')
  const notices={kind:'email',localId:'synthetic-hh-80-notices',requesters:[visible+'@example.test',unticketed+'@example.test'],subject:'Synthetic notice',content:'Synthetic service notice',mailboxId:'synthetic-hh-80-mailbox'}
  const preview=await call(P+'/tickets/notices/preview',notices),noticesPrior=await snapshot(),notice=await call(P+'/tickets/notices',{...notices,confirmation:preview.data.confirmation})
  const native=await call('/api/conversations',{projectId:p,contactId:visible})
  probe('P9','ungrouped notice preview/send and POST /api/conversations',{preview:preview.status,send:notice.status,native:native.status})
  check(preview.status,403,'ungrouped notice preview');check(notice.status,403,'whole notice refused');check(native.status,403,'native ungrouped 404 becomes 403');check(await snapshot(),noticesPrior,'all ungrouped creation refused before writes')
  const clean=r=>!JSON.stringify(r.data).includes(secret)
  for(const subject of [mixed,visible,unticketed]){
   const outputs=[]
   for(const suffix of ['', '/insights','/jobs']){
    const r=await call(X+'/'+subject+suffix);outputs.push({door:suffix||'packet',status:r.status,clean:clean(r)})
    if(subject===mixed){check(clean(r),true,'no hidden contact evidence');if(suffix)check(r.data,[],'missing-subject collection');else{check(r.data.evidence,[],'missing packet evidence');check(r.data.profiles,{},'missing packet profiles')}}else{assert.equal(r.status,200);if(!suffix)assert.equal(r.data.evidence.length,1,'visible/no-ticket context unchanged')}
   }
   const generation=await call(X+'/'+subject+'/generate/contact',{model:'synthetic-hh-80-model'});outputs.push({door:'generate',status:generation.status})
   if(subject===mixed){check(generation.status,409,'missing-subject generate');check(generation.data.error,'Error: Context subject missing','missing generation shape')}
   probe('P10',`context subject ${subject}`,outputs)
  }
  const inventory=await call(X+'/insights');probe('P10','context insights inventory',{status:inventory.status,subjects:inventory.data.data.map(i=>i.subject_id),clean:clean(inventory)})
  check(inventory.data.data.map(i=>i.subject_id).sort(),[visible,unticketed].sort(),'hidden-contact inventory filtered');check(clean(inventory),true,'inventory no hidden content')
  if(!before){
   const frozen=await app.sql('SELECT * FROM context_subjects ORDER BY subject_id')
   for(const [suffix,body,method] of [['/consent',{consent:false},'PUT'],['/monitoring',{enabled:false,helpTypes:[]},'PUT'],['/evidence',{source:'customer_message',content:'Synthetic refusal'},'POST'],['/profiles/contact',{profile:{},evidenceFingerprint:'synthetic-hh-80'},'PUT'],['/insights',{},'POST'],['/insights/'+mixed+'-insight/dismiss',{},'POST'],['/jobs/'+mixed+'-job/abandon',{reason:'Synthetic refusal'},'POST']]){
    const r=await call(X+'/'+mixed+suffix,body,w.tokens.admin,method);assert.equal(r.status,404,suffix+' hidden contact write')
   }
   assert.deepEqual(await app.sql('SELECT * FROM context_subjects ORDER BY subject_id'),frozen,'context refusal changes no consent or monitoring')
  }
  // Retained recovery and NULL scope use the same public doors. The foreign
  // actor has no data at any of these project-bound doors.
  await select(null)
  devices.selected=await pair(w.tokens.admin)
  for(const [principal,token,device] of [['NULL',w.tokens.admin,devices.selected],['owner',w.tokens.owner,devices.owner]]){
   const mobile=await call(M+'/tickets',undefined,device),template=await call(C+'/conversations/'+secret+'/templates',undefined,token),held=await call(P+'/suspended',undefined,token),preview=await call(P+'/tickets/notices/preview',{...notices,localId:'synthetic-hh-80-compatibility-'+principal},token),bytes=await call(M+`/tickets/${secret}/attachments/${secret}-media`,undefined,device),thread=await call(C+'/conversations/'+secret,undefined,token),packet=await call(X+'/'+mixed,undefined,token),receipt=await call(receiptPath,undefined,token),creation=await call('/api/conversations',{projectId:p,contactId:visible},token)
   assert.equal(mobile.status,200);assert.equal(mobile.data.tickets.length,100);assert.equal(bytes.status,200);assert.ok(thread.data.data);assert.ok(JSON.stringify(packet.data).includes(secret));assert.equal(receipt.status,200);assert.equal(creation.status,201);assert.equal(template.status,200);assert.ok(held.data.data.some(row=>row.candidate_conversation_id===secret));assert.equal(preview.status,200)
   probe('P11',principal+' mobile/bytes/channel/context/receipt/ungrouped native create',{mobile:mobile.status,bytes:bytes.status,channel:thread.status,context:packet.status,receipt:receipt.status,native:creation.status,templates:template.status,noticePreview:preview.status})
  }
  for(const path of [P+'/suspended',receiptPath,C+'/conversations/'+target,X+'/'+mixed,X+'/insights'])assert.equal((await call(path,undefined,foreign.tokens.owner)).status,403,'other tenant '+path)
  for(const [path,body] of [[P+'/tickets',ticketBody('synthetic-hh-80-foreign')],[P+'/tickets/notices/preview',notices],[P+'/tickets/notices',notices],[P+'/suspended/synthetic-hh-80-hold-release/recover',{asNote:true,conversationId:target}],[X+'/'+mixed+'/consent',{consent:true}]]){
   const r=await call(path,body,foreign.tokens.owner,path.endsWith('/consent')?'PUT':'POST');assert.equal(r.status,403,'foreign mutation '+path)
  }
  await select(selected)
  await select({groupIds:['synthetic-hh-80-a'],includeUngrouped:true})
  const noticePreview=await call(P+'/tickets/notices/preview',{...notices,localId:'synthetic-hh-80-allowed-notice'})
  assert.equal(noticePreview.status,200)
  const noticeSend=await call(P+'/tickets/notices',{...notices,localId:'synthetic-hh-80-allowed-notice',confirmation:noticePreview.data.confirmation});assert.equal(noticeSend.status,200);assert.ok(noticeSend.data.results.every(r=>r.accepted),JSON.stringify(noticeSend.data))
  const nativeAllowed=await call('/api/conversations',{projectId:p,contactId:visible});assert.equal(nativeAllowed.status,201)
  probe('P9','includeUngrouped native/notices remain served',{native:nativeAllowed.status,preview:noticePreview.status,send:noticeSend.status,accepted:noticeSend.data.results.map(r=>r.accepted)})
  probe('P12','five retained helper journeys and frozen paths','reported separately from this residual-door extension')
 }finally{await app.close();await rm(temporary,{recursive:true,force:true})}
}
