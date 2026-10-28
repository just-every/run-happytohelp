import {workspaceBrand} from './workspace-brand.mjs'
import {workspaceLibrary} from './workspace-library.mjs'
import {companyRecordsJourney} from '../company-records.mjs'
import {customerCsvJourney} from '../customer-csv.mjs'
import assert from 'node:assert/strict'
import {startApp,sha,applyMigrations} from '../../journeys/kit/app.mjs'

// Workspace management on the real application: scoped settings, resources and bootstrap, last-owner and
// global-admin boundaries, dashboard notes and contact participants, transcript mail, widget settings and
// origins, observed presence, mailbox ownership. Only the mail provider and DNS are fixtures.
export async function managementJourney(){
 const network={requests:[],reject:false}
 // Migration 129 runs on the seeded workspaces below, as an upgrade would run it on existing ones.
 const ownerAlerts=name=>name.startsWith('129_')
 const app=await startApp({captureQueue:true,origin:'https://app.example',migrate:name=>!ownerAlerts(name),outbound:async request=>{
  if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]})
  assert.equal(request.url,'https://api.resend.com/emails','only the mail provider is called');network.requests.push(await request.json())
  return network.reject?new Response('unavailable',{status:503}):Response.json({id:'provider-transcript'})
 }})
 // The D1 handle survives configuration restarts.
 const DB={prepare:sql=>app.db.prepare(sql),batch:statements=>app.db.batch(statements),exec:sql=>app.db.exec(sql)},hashToken=async value=>sha(value)
 const call=(prefix,path,method='GET',body,token='token')=>app.request(prefix+path,{raw:true,method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 try{
await DB.batch([DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('p','Project','widget','https://widget.example',1)"),DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('q','Other','other','https://other.example',1)"),DB.prepare("INSERT INTO users VALUES('u','owner@example.com','Owner',1)"),DB.prepare("INSERT INTO memberships VALUES('p','u','owner')"),DB.prepare("INSERT INTO sessions VALUES(?,'u','p','owner',NULL,?,NULL)").bind(await hashToken('token'),Date.now()+999999),DB.prepare("INSERT INTO session_factors VALUES(?,'u','password',?)").bind(await hashToken('token'),Date.now()),DB.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('contact','p','Visitor','visitor@example.com',1)"),DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('c','p','contact',1,1)")]);
// An existing workspace where no member gets new-conversation alerts alerts its owner after the upgrade; one where a
// member already gets them is unchanged.
await DB.batch([DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('team','Team','team','https://team.example',1)"),DB.prepare("INSERT INTO users VALUES('team-owner','team-owner@example.com','Team owner',1),('team-admin','team-admin@example.com','Team admin',1)"),DB.prepare("INSERT INTO memberships VALUES('team','team-owner','owner'),('team','team-admin','admin')"),DB.prepare("INSERT INTO user_project_preferences(project_id,user_id,is_notified_on_unassigned_activity) VALUES('team','team-admin',1)")])
await applyMigrations(app.db,ownerAlerts)
assert.deepEqual((await DB.prepare('SELECT project_id,user_id,is_notified_on_unassigned_activity alerted FROM user_project_preferences ORDER BY project_id,user_id').all()).results,[{project_id:'p',user_id:'u',alerted:1},{project_id:'team',user_id:'team-admin',alerted:1}])
assert.equal((await call('/api/management','/projects/q/settings')).status,403)
assert.equal((await call('/api/management','/projects/p/settings','PUT',{name:'Renamed',timezone:'UTC',is_contact_tracking_enabled:true})).status,200)
const macro=await(await call('/api/management','/projects/p/macros','POST',{title:'Welcome',content:'Hello'})).json();assert.ok(macro.data.id)
assert.equal((await call('/api/management','/projects/q/macros/'+macro.data.id,'PUT',{title:'Stolen'})).status,403)
// Established directories and reply libraries remain reachable through the scoped public routes.
const directory=Array.from({length:211},(_,i)=>({id:`directory-${String(i).padStart(3,'0')}`,name:`Person ${String(i).padStart(3,'0')}`,email:`person${String(i).padStart(3,'0')}@example.test`,seen:i+1,country:i%2?'Australia':'Canada'}))
await DB.batch(directory.flatMap((row,i)=>[
 DB.prepare('INSERT INTO contacts(id,project_id,name,email,created_at,metadata_json) VALUES(?,?,?,?,?,?)').bind(row.id,'p',row.name,row.email,1,JSON.stringify({provided_name:i===0?'Supplied Person':null,provided_email:i===0?'supplied@example.test':null,last_seen_at:row.seen,country_name:row.country})),
 DB.prepare('INSERT INTO macros VALUES(?,?,?,?,?,?,?)').bind(`reply-${row.id}`,'p',`Reply ${String(i).padStart(3,'0')}`,i===210?'Needle in the saved body':'Reusable content','u',i+1,i+1),
]))
await DB.batch([
 DB.prepare("INSERT INTO contacts(id,project_id,name,email,created_at,metadata_json) VALUES('foreign-directory','q','Foreign','foreign@example.test',1,'{}')"),
 DB.prepare("INSERT INTO contacts(id,project_id,name,created_at,metadata_json) VALUES('deleted-directory','p','Deleted',1,'{\"is_deleted\":true}')"),
 DB.prepare("INSERT INTO macros VALUES('foreign-reply','q','Foreign reply','Needle in the saved body','u',1,1)"),
])
async function listed(path){const result=await call('/api/management',path);assert.equal(result.status,200,await result.clone().text());return result.json()}
async function allPages(path){const rows=[];for(let page=1;;page++){const result=await listed(`${path}${path.includes('?')?'&':'?'}page=${page}`);rows.push(...result.data);if(!result.pagination.hasMore)return rows;assert.ok(page<20,'pagination terminates')}}
const contacts=await allPages('/projects/p/contacts?sort=last_seen_at&direction=desc')
assert.deepEqual(contacts.filter(row=>row.id.startsWith('directory-')).map(row=>row.id),directory.toReversed().map(row=>row.id))
assert.ok(!contacts.some(row=>['foreign-directory','deleted-directory'].includes(row.id)))
for(const [term,id] of [['Person 210','directory-210'],['person210@example.test','directory-210'],['Supplied Person','directory-000'],['supplied@example.test','directory-000']])assert.deepEqual((await listed('/projects/p/contacts?search='+encodeURIComponent(term))).data.map(row=>row.id),[id])
for(const [sort,field] of [['name','name'],['email','email'],['country','country']]){
 const result=(await allPages(`/projects/p/contacts?sort=${sort}&direction=asc`)).filter(row=>row.id.startsWith('directory-'))
 const value=row=>sort==='country'?JSON.parse(row.metadata_json).country_name:JSON.parse(row.metadata_json)[`provided_${field}`]||row[field]
 assert.deepEqual(result.map(value),result.map(value).toSorted((a,b)=>a<b?-1:a>b?1:0),`${sort} orders the complete directory`)
}
assert.deepEqual((await listed('/projects/p/macros?search=Needle')).data.map(row=>row.id),['reply-directory-210'],'body search crosses the old cap without foreign results')
assert.deepEqual((await listed('/projects/p/macros?search=Reply%20210')).data.map(row=>row.id),['reply-directory-210'])
const replies=(await allPages('/projects/p/macros?sort=title&direction=asc')).filter(row=>row.id.startsWith('reply-directory-'))
assert.deepEqual(replies.map(row=>row.id),directory.map(row=>`reply-${row.id}`),'paging reaches every reply')
assert.deepEqual((await allPages('/projects/p/macros?sort=created_at&direction=desc')).filter(row=>row.id.startsWith('reply-directory-')).map(row=>row.id),directory.toReversed().map(row=>`reply-${row.id}`))
assert.deepEqual((await listed('/projects/p/macros?search=%25')).data,[],'search treats SQL wildcard characters as text')
for(const query of ['page=0','limit=0','sort=content%20DESC','direction=sideways'])assert.equal((await call('/api/management','/projects/p/contacts?'+query)).status,400)
// A profile includes all its own and participant conversations, with deterministic pages and tenant fences.
const profileConversations=Array.from({length:55},(_,i)=>({id:`profile-${String(i).padStart(3,'0')}`,updated:i+1}))
await DB.batch(profileConversations.map(row=>DB.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(row.id,'p','directory-000',1,row.updated)))
await DB.batch([
 DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('participant-thread','p','contact',1,100)"),
 DB.prepare("INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('participant-link','participant-thread','directory-000',1)"),
 DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('foreign-profile','q','foreign-directory',1,1000)"),
 DB.prepare("INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('foreign-participant-link','foreign-profile','directory-000',1)"),
])
assert.deepEqual((await allPages('/projects/p/contacts/directory-000/conversations')).map(row=>row.id),['participant-thread',...profileConversations.toReversed().map(row=>row.id)])
assert.equal((await call('/api/management','/projects/p/contacts/foreign-directory/conversations')).status,404)
assert.equal((await call('/api/management','/projects/q/contacts/foreign-directory/conversations')).status,403)
await DB.batch([
 DB.prepare("DELETE FROM conversation_participants WHERE id IN ('participant-link','foreign-participant-link')"),
 DB.prepare("DELETE FROM conversations WHERE id LIKE 'profile-%' OR id IN ('participant-thread','foreign-profile')"),
 DB.prepare("DELETE FROM macros WHERE id LIKE 'reply-directory-%' OR id='foreign-reply'"),
 DB.prepare("DELETE FROM contacts WHERE id LIKE 'directory-%' OR id IN ('foreign-directory','deleted-directory')"),
])


// Notification preferences belong to a current member, independent of their role.
assert.equal((await call('/api/management','/projects/p/agents/u','PUT',{role:'owner',is_notified_on_unassigned_activity:true})).status,200)
assert.equal((await call('/api/management','/projects/p/agents/u','PUT',{role:'operator'})).status,409,'real demotion still protects the sole owner')
for(const role of ['admin','operator']){
 const memberToken='preference-'+role
 await DB.batch([DB.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(role,role+'@example.test',role),DB.prepare('INSERT INTO memberships VALUES(?,?,?)').bind('p',role,role),DB.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(await hashToken(memberToken),role,'p',role,Date.now()+60000)])
 assert.equal((await call('/api/management','/projects/p/agents/'+role,'PUT',{role,is_notified_on_unassigned_activity:true},memberToken)).status,200)
 assert.equal((await call('/api/management','/profile?projectId=p','PUT',{name:role,is_notified_on_unassigned_activity:false},memberToken)).status,200)
 assert.equal((await(await call('/api/management','/profile?projectId=p','GET',undefined,memberToken)).json()).data.is_notified_on_unassigned_activity,0)
 assert.equal((await call('/api/management','/profile?projectId=q','PUT',{name:role,is_notified_on_unassigned_activity:true},memberToken)).status,403,'foreign workspace membership is checked on the server')
 assert.equal((await call('/api/management','/projects/p/agents/'+role,'PUT',{role:'owner'},memberToken)).status,403,'preferences cannot elevate a member')
 await DB.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind('p',role).run()
 assert.equal((await call('/api/management','/projects/p/agents/'+role,'PUT',{is_notified_on_unassigned_activity:true},memberToken)).status,401,'removed members lose session authority before saving preferences')
}
assert.equal((await call('/api/management','/projects/p/agents/u','DELETE')).status,409,'last owner protected')
assert.equal((await call('/api/management','/admin/users')).status,403,'project owner is not global administrator')
const bootstrap=await(await call('/api/management','/bootstrap')).json();assert.equal(bootstrap.currentAgent.id,'u');assert.equal(bootstrap.projects.p.name,'Renamed');assert.equal(bootstrap.projects.q,undefined)
// Workspace scoping: bootstrap reports the session's project and whether the account administers the platform; a project the account does not belong to is refused with an explanation, not a bare 403.
assert.equal(bootstrap.sessionProjectId,'p','bootstrap names the session project');assert.equal(bootstrap.isPlatformAdmin,false,'a project owner is not a platform administrator')
const foreign=await call('/api/management','/bootstrap?projectId=q');assert.equal(foreign.status,403);assert.match(await foreign.text(),/not found, or you do not have access/)
const missing=await call('/api/management','/bootstrap?projectId=00000000-0000-4000-8000-000000000000');assert.equal(missing.status,403,'an unknown project is indistinguishable from a foreign one');assert.equal(await missing.text(),await(await call('/api/management','/bootstrap?projectId=q')).text())
const crossBound=await(await call('/api/management','/bootstrap?projectId=p')).json();assert.equal(crossBound.project.id,'p')
await DB.prepare("INSERT INTO platform_admins(user_id) VALUES('u')").run();assert.equal((await(await call('/api/management','/bootstrap')).json()).isPlatformAdmin,true,'a platform_admins row is reported to the client');await DB.prepare("DELETE FROM platform_admins WHERE user_id='u'").run()
// A member whose role is too low for an owner/admin action is told so, not told the project is missing.
await DB.prepare("INSERT INTO memberships VALUES('q','u','operator')").run();const lowRole=await call('/api/management','/projects/q/widget-settings','PUT',{settings:{}});assert.equal(lowRole.status,403);assert.match(await lowRole.text(),/owner or admin role required/);await DB.prepare("DELETE FROM memberships WHERE project_id='q' AND user_id='u'").run()
assert.equal((await call('/api/dashboard','/projects/q/conversations/c')).status,404)
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/notes','POST',{content:'Private note'})).status,201)
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:'other@example.com'})).status,201)
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/actions','POST',{action:'markAsRead'})).status,200)
const detail=await(await call('/api/dashboard','/projects/p/conversations/c')).json();assert.equal(detail.data.contact.display_name,'Visitor');assert.equal(detail.data.participants.length,1)
// The add result and the detail loaded again use one contact + pivot shape.
const addedParticipant=detail.data.participants[0]
assert.ok(addedParticipant.pivot.id);assert.equal(addedParticipant.id,addedParticipant.contact_id)
assert.equal((await call('/api/dashboard',`/projects/p/conversations/c/participants/${addedParticipant.pivot.id}`,'DELETE')).status,200)
assert.deepEqual((await(await call('/api/dashboard','/projects/p/conversations/c')).json()).data.participants,[])
await DB.batch([
 DB.prepare("INSERT INTO contacts(id,project_id,name,email,metadata_json,created_at) VALUES('supplied','p','Colleague','canonical@example.com','{\"provided_email\":\"supplied@example.com\"}',1)"),
 DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('foreign','q','supplied@example.com',1)"),
])
const supplied=await(await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:' SUPPLIED@example.com '})).json()
assert.equal(supplied.data.id,'supplied');assert.equal(supplied.data.provided_email,'supplied@example.com')
assert.deepEqual((await(await call('/api/dashboard','/projects/p/conversations/c')).json()).data.participants[0].pivot,supplied.data.pivot)
assert.equal((await call('/api/dashboard','/projects/q/conversations/c/participants','POST',{email:'supplied@example.com'})).status,404)
await DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('ambiguous','p','supplied@example.com',1)").run()
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:'supplied@example.com'})).status,409)
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:'bad@example.com, other@example.com'})).status,400)
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:'visitor@example.com'})).status,409)
await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erased',1) WHERE id='ambiguous'").run()
assert.equal((await call('/api/dashboard','/projects/p/conversations/c/participants','POST',{email:'supplied@example.com'})).status,409,'erased identities do not remove ambiguity')
assert.equal((await call('/api/management','/projects/p/email-settings/test','POST',{idempotencyKey:'test'})).status,503)
assert.equal((await app.request('/api/widget/settings?widgetKey=widget',{raw:true,headers:{Origin:'https://other.example'}})).status,403)
const widget=await(await app.request('/api/widget/settings?widgetKey=widget',{raw:true,headers:{Origin:'https://widget.example'}})).json();assert.equal(widget.currentAgent.name,'Owner');assert.equal(widget.collectorEnabled,true)
await DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('m','p','c','local','contact','contact','Hello',1,10)").run()
await DB.prepare("UPDATE conversations SET revision=1,last_message_id='m',assigned_to='u' WHERE id='c'").run()
const buckets=await(await call('/api/dashboard','/projects/p/conversations/c/buckets')).json();assert.equal(buckets.data[0].counts.contact_messages,1);assert.equal(buckets.data[0].messages.find(m=>m.id==='m').type,undefined);assert.equal(buckets.data[0].events[0].type,'INTERNAL_NOTE')
const mine=await(await call('/api/dashboard','/conversations?status=unresolved&assigned_to=myself')).json();assert.equal(mine.data.length,1)
const none=await(await call('/api/dashboard','/conversations?status=unresolved&assigned_to=none')).json();assert.equal(none.data.length,0)
await DB.prepare("INSERT INTO conversation_buckets VALUES('old-bucket','c',1,'{}')").run()
await DB.prepare("UPDATE messages SET bucket_id='old-bucket' WHERE id='m'").run()
const historical=await(await call('/api/dashboard','/projects/p/conversations/c/buckets/old-bucket')).json();assert.equal(historical.data.messages[0].id,'m');assert.equal(historical.data.id,'old-bucket')
// Send through the authenticated dashboard with only the paid network edge faked.
await DB.batch([
 DB.prepare("INSERT INTO conversation_buckets VALUES('latest-customer','c',20,'{}')"),
 DB.prepare("INSERT INTO conversation_buckets VALUES('only-operator','c',30,'{}')"),
 DB.prepare("INSERT INTO conversation_buckets VALUES('automatic-only','c',40,'{}')"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('transcript-question','p','c','question','contact','contact','Customer **question**',2,20,'latest-customer')"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('transcript-answer','p','c','answer','u','owner','Helpful [answer](https://example.com/help)',3,21,'latest-customer')"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('transcript-ai','p','c','ai','import:helpscout:assistant','ai','Authored assistant answer',4,22,'latest-customer')"),
 DB.prepare(`INSERT INTO move_in_message_sources(message_id,project_id,author_json,source_id,time_provenance) VALUES('transcript-ai','p','{"name":"Imported assistant","role":"ai"}','original-assistant-reply','source')`),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('transcript-system','p','c','system','system','system','System-only content',5,23,'latest-customer')"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('later-operator','p','c','later-op','u','owner','Later operator-only segment',6,30,'only-operator')"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('automatic-email','p','c','email:automatic','contact','contact','Automatic receipt',7,40,'automatic-only')"),
 DB.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at,local_id,message_id,automatic) VALUES('automatic','p','c','fixture','delivered',40,'email:automatic','automatic-email',1)"),
 DB.prepare("UPDATE conversations SET revision=7 WHERE id='c'"),
 DB.prepare("INSERT INTO email_settings VALUES('p','Support','support@example.com','inbound@example.com',1,1)"),
])
await (await app.files).put('transcript-image',new Uint8Array([1,2,3]));await (await app.files).put('transcript-file',new TextEncoder().encode('Retained file'))
await DB.batch([
 DB.prepare("INSERT INTO media VALUES('transcript-image','p','c','contact','transcript-image','screenshot.png','image/png',3,'transcript-question',20)"),
 DB.prepare("INSERT INTO media VALUES('transcript-file','p','c','contact','transcript-file','details.txt','text/plain',13,'transcript-question',20)"),
])
await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.com',INBOUND_EMAIL_TOKEN:'fixture-inbound'});const requests=network.requests
const transcriptBody={send_transcript_to:'chosen@example.com',idempotencyKey:'transcript-command',transcript_revision:7}
async function transcript(body=transcriptBody){return app.request('/api/dashboard/projects/p/conversations/c',{raw:true,method:'PUT',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify(body)})}
try{
 const sent=await transcript();assert.equal(sent.status,200);assert.equal((await sent.json()).transcript_delivery.state,'sent')
 const delivered=requests[0];assert.equal(delivered.to[0],'chosen@example.com');assert.match(delivered.reply_to,/^inbound\+r\./,'the transcript carries a reply address')
 assert.ok(delivered.text.includes('Authored assistant answer'));assert.match(delivered.text,/Imported assistant/);assert.match(delivered.text,/Visitor/);assert.match(delivered.text,/Owner/);assert.match(delivered.html,/<strong>question<\/strong>/);assert.match(delivered.html,/href="https:\/\/example.com\/help"/)
 for(const excluded of ['Hello','System-only content','Later operator-only segment','Automatic receipt','Private note'])assert.ok(!delivered.text.includes(excluded))
 assert.ok(delivered.attachments.some(file=>file.filename==='screenshot.png'&&file.content_id));assert.ok(delivered.attachments.some(file=>file.filename==='details.txt'&&Buffer.from(file.content,'base64').toString()==='Retained file'))
 assert.match(delivered.html,/src="cid:/)
 await DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,bucket_id) VALUES('after-send','p','c','after-send','contact','contact','A later question',8,41,'latest-customer')").run()
 await DB.prepare("UPDATE conversations SET revision=8 WHERE id='c'").run()
 assert.equal((await(await transcript()).json()).transcript_delivery.state,'sent');assert.equal(requests.length,1,'lost-response retry keeps the original frontier and never sends twice')
 assert.equal((await transcript({...transcriptBody,send_transcript_to:'different@example.com'})).status,409)
 assert.equal((await DB.prepare("SELECT count(*) total FROM contacts WHERE email='chosen@example.com'").first()).total,0,'transcript recipient gains no inbound identity')
 network.reject=true
 const uncertain={...transcriptBody,idempotencyKey:'unknown-transcript'}
 assert.equal((await(await transcript(uncertain)).json()).transcript_delivery.state,'uncertain')
 assert.equal((await(await transcript(uncertain)).json()).transcript_delivery.state,'uncertain');assert.equal(requests.length,2,'uncertain sends are never replayed')
 assert.equal((await transcript({...transcriptBody,send_transcript_to:'bad,address'})).status,400)
 await DB.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='u'").run()
 assert.equal((await transcript()).status,401,'revoked operators cannot send or recover transcripts')
 await DB.prepare("INSERT INTO memberships VALUES('p','u','owner')").run()
}finally{network.reject=false;await app.configure({EMAIL_PROVIDER:undefined,EMAIL_API_KEY:undefined,EMAIL_FROM:undefined,INBOUND_EMAIL_TOKEN:undefined})}
assert.equal((await call('/api/management','/projects/p/agents','POST',{email:'invite@example.com',role:'operator'})).status,201)
await DB.prepare("INSERT INTO sessions VALUES(?,'contact','p','contact','contact',?,NULL)").bind(await hashToken('contact-token'),Date.now()+999999).run()
const widgetContact=await app.request('/api/conversations/c/widget-events',{raw:true,method:'POST',headers:{Authorization:'Bearer contact-token','Content-Type':'application/json'},body:JSON.stringify({action:'contact',data:{provided_name:'Updated',provided_email:'updated@example.com'}})});assert.equal(widgetContact.status,200)
assert.equal((await DB.prepare("SELECT name FROM contacts WHERE id='contact'").first()).name,'Updated')
// Editing from the conversation returns the exact profile shape its sidebar reads.
await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.last_seen_at',?,'$.timezone','Asia/Tokyo','$.language','ja','$.country_code','JP','$.ip_address','203.0.113.8','$.user_agent','Browser/1.0','$.account_tier','plus') WHERE id='contact'").bind(Date.now()).run()
const edited=await(await call('/api/management','/projects/p/contacts/contact','PUT',{name:'Canonical name',email:'canonical@example.com',provided_name:'Visitor name',provided_email:'visitor-alias@example.com'})).json()
assert.deepEqual(edited.data,(await(await call('/api/dashboard','/projects/p/conversations/c')).json()).data.contact)
assert.equal(edited.data.display_name,'Canonical name');assert.equal(edited.data.provided_name,'Visitor name');assert.equal(edited.data.provided_email,'visitor-alias@example.com');assert.equal(edited.data.is_online,true);assert.equal(edited.data.timezone,'Asia/Tokyo');assert.equal(edited.data.account_tier,'plus')
const blocked=await(await call('/api/management','/projects/p/contacts/contact','PUT',{is_blocked:true})).json()
assert.equal(blocked.data.is_blocked,true);assert.ok(Number.isFinite(new Date(blocked.data.blocked_at).getTime()))
const blockedAgain=await(await call('/api/management','/projects/p/contacts/contact','PUT',{is_blocked:true})).json();assert.equal(blockedAgain.data.blocked_at,blocked.data.blocked_at)
async function contactPresence(data={}){return app.request('/api/conversations/c/widget-events',{raw:true,method:'POST',headers:{Authorization:'Bearer contact-token','Content-Type':'application/json'},body:JSON.stringify({action:'instruction',data})})}
assert.equal((await contactPresence()).status,401,'blocking immediately denies an existing visitor session')
const unblocked=await(await call('/api/management','/projects/p/contacts/contact','PUT',{is_blocked:false})).json();assert.equal(unblocked.data.is_blocked,false);assert.equal(unblocked.data.blocked_at,null);assert.equal((await contactPresence()).status,200)
await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_blocked',1,'$.blocked_at','2025-01-02T03:04:05.000Z') WHERE id='contact'").run()
const importedUnblocked=await(await call('/api/management','/projects/p/contacts/contact','PUT',{is_blocked:false})).json();assert.equal(importedUnblocked.data.is_blocked,false);assert.equal(importedUnblocked.data.blocked_at,null);assert.equal((await contactPresence()).status,200,'an imported block can be cleared from the same conversation control')
// Session context comes from browser preferences and request headers, never JSON claims.
await DB.prepare("UPDATE projects SET verification_secret='context-fixture-secret' WHERE id='p'").run()
await DB.prepare("UPDATE contacts SET external_id='known-context',is_verified=1 WHERE id='contact'").run()
const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode('context-fixture-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign'])
async function sign(value){return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
const identitySignature=await sign('known-context')
async function contextSession(body,headers={}){return app.request('/api/identity/widget/session',{raw:true,method:'POST',headers:{Origin:'https://widget.example','Content-Type':'application/json',...headers},body:JSON.stringify({widgetKey:'widget',identifier:'known-context',contact_hash:identitySignature,...body})})}
const business={plan:'pro',ip_address:'forged',country_code:'ZZ',user_agent:'forged',is_blocked:true,blocked_at:1,provided_name:'forged'}
assert.equal((await contextSession({timezone:'Europe/Paris',language:'fr-fr',ip_address:'forged',country_code:'ZZ',user_agent:'forged',metadata:{...business,hash:await sign(JSON.stringify(business))}},{'CF-Connecting-IP':'203.0.113.10','CF-IPCountry':'FR','User-Agent':'Observed Browser/1.0'})).status,201)
let contextProfile=(await(await call('/api/dashboard','/projects/p/conversations/c')).json()).data.contact
assert.equal(contextProfile.timezone,'Europe/Paris');assert.equal(contextProfile.language,'fr-FR');assert.equal(contextProfile.ip_address,'203.0.113.10');assert.equal(contextProfile.country_code,'FR');assert.equal(contextProfile.user_agent,'Observed Browser/1.0');assert.equal(contextProfile.provided_name,'Visitor name');assert.equal(contextProfile.is_blocked,false);assert.equal(contextProfile.plan,'pro')
const replacement={plan:'enterprise'}
assert.equal((await contextSession({timezone:'Not/AZone',language:'invalid_language',ip_address:'forged',country_code:'ZZ',user_agent:'forged',metadata:{...replacement,hash:await sign(JSON.stringify(replacement))}},{'CF-Connecting-IP':'203.0.113.10','CF-IPCountry':'FR','User-Agent':'Observed Browser/1.0'})).status,201)
contextProfile=(await(await call('/api/dashboard','/projects/p/conversations/c')).json()).data.contact
assert.equal(contextProfile.timezone,'Europe/Paris');assert.equal(contextProfile.language,'fr-FR');assert.equal(contextProfile.ip_address,'203.0.113.10');assert.equal(contextProfile.country_code,'FR');assert.equal(contextProfile.user_agent,'Observed Browser/1.0');assert.equal(contextProfile.provided_email,'visitor-alias@example.com');assert.equal(contextProfile.plan,'enterprise')
const newContext=await(await app.request('/api/identity/widget/session',{raw:true,method:'POST',headers:{Origin:'https://widget.example','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.11','CF-IPCountry':'NZ','User-Agent':'New Browser/2.0'},body:JSON.stringify({widgetKey:'widget',timezone:'Pacific/Auckland',language:'en-NZ',ip_address:'forged'})})).json()
const newProfile=JSON.parse((await DB.prepare('SELECT metadata_json FROM contacts WHERE id=?').bind(newContext.contactId).first()).metadata_json)
assert.equal(newProfile.timezone,'Pacific/Auckland');assert.equal(newProfile.ip_address,'203.0.113.11');assert.equal(newProfile.country_code,'NZ');assert.equal(newProfile.user_agent,'New Browser/2.0')

assert.equal((await call('/api/integrations','/email/inbound','POST',{messageId:'mail'})).status,403)
await call('/api/management','/projects/p/email-settings','PUT',{from_name:'Support',from_address:'support@example.com',inbound_address:'inbound@example.com',is_enabled:true})
const input={messageId:'mail-1',from:'mail-contact@example.com',to:'inbound@example.com',text:'Help by email'}
await app.configure({INBOUND_EMAIL_TOKEN:'inbound-token'})
async function email(){return app.request('/api/integrations/email/inbound',{raw:true,method:'POST',headers:{Authorization:'Bearer inbound-token','Content-Type':'application/json'},body:JSON.stringify(input)})}
assert.equal((await email()).status,201);assert.equal((await email()).status,200)
assert.equal((await DB.prepare("SELECT count(*) n FROM messages WHERE content='Help by email'").first()).n,1)
await DB.batch([DB.prepare("UPDATE projects SET verification_secret='private-proof' WHERE id='p'"),DB.prepare("INSERT INTO users VALUES('op','op@example.com','Operator',1)"),DB.prepare("INSERT INTO memberships VALUES('p','op','operator')"),DB.prepare("INSERT INTO sessions VALUES(?,'op','p','operator',NULL,?,NULL)").bind(await hashToken('operator-token'),Date.now()+999999)])
for(const path of ['/bootstrap','/projects','/projects/p/settings','/projects/p/widget-settings']){const response=await app.request('/api/management'+path,{raw:true,headers:{Authorization:'Bearer operator-token'}});assert.equal(response.status,200);assert.ok(!(await response.text()).includes('private-proof'),path+' must not expose verification secret')}
const ownerSettings=await(await call('/api/management','/projects/p/widget-settings')).json();assert.equal(ownerSettings.verificationSecret,'private-proof');assert.equal(ownerSettings.appOrigin,'https://app.example')
// Widget settings are stored exactly as sent: the body is the settings object, so the widget's own `settings` section is not mistaken for a wrapper.
const widgetBody={theme:{avatar:{background:'#ff0000'}},settings:{show_glow:{on_insight:false}},text:{message:{button_send:'Go'}}}
assert.equal((await call('/api/management','/projects/p/widget-settings','PUT',widgetBody)).status,200)
assert.deepEqual((await(await call('/api/management','/projects/p/widget-settings')).json()).settings,widgetBody)
assert.equal((await app.request('/api/management/projects/p/widget-settings',{raw:true,method:'PUT',headers:{Authorization:'Bearer operator-token','Content-Type':'application/json'},body:'{}'})).status,403)
assert.deepEqual((await(await call('/api/management','/projects/p/widget-settings')).json()).settings,widgetBody)
// Every project created through the API gets its own server secret, readable by its owner and hidden from other roles.
const fresh=await(await call('/api/management','/projects','POST',{name:'Fresh',allowed_origin:'https://fresh.example'})).json(),freshSettings=await(await call('/api/management',`/projects/${fresh.id}/widget-settings`)).json()
assert.match(freshSettings.verificationSecret,/^[0-9a-f]{64}$/);assert.notEqual(freshSettings.verificationSecret,ownerSettings.verificationSecret)
assert.equal((await app.request(`/api/management/projects/${fresh.id}/widget-settings`,{raw:true,headers:{Authorization:'Bearer operator-token'}})).status,403)
// The owner who creates a workspace is alerted to its new conversations, and can switch that off.
const freshProfile=async()=>(await(await call('/api/management',`/profile?projectId=${fresh.id}`)).json()).data.is_notified_on_unassigned_activity
assert.equal(await freshProfile(),1)
assert.equal((await call('/api/management',`/profile?projectId=${fresh.id}`,'PUT',{name:'Owner',is_notified_on_unassigned_activity:false})).status,200)
assert.equal(await freshProfile(),0)
await DB.prepare("INSERT INTO memberships VALUES('q','u','owner')").run()
await DB.prepare("INSERT INTO sessions VALUES(?,'u','q','owner',NULL,?,NULL)").bind(await hashToken('q-token'),Date.now()+999999).run()
async function callQ(path,method='GET',body){return app.request('/api/management'+path,{raw:true,method,headers:{Authorization:'Bearer q-token','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})}
assert.equal((await callQ('/projects/q/email-settings','PUT',{from_name:'Other Support',from_address:'other@example.com',inbound_address:'INBOUND@example.com',is_enabled:true})).status,409,'case-insensitive active mailbox conflict is explicit')
await workspaceBrand(app)
await workspaceLibrary(app)
await companyRecordsJourney(app)
await customerCsvJourney(app)
const liveSettings=(await DB.prepare("SELECT settings_json FROM project_settings WHERE project_id='p'").first()).settings_json
// The workspace is deleted after the request is admitted but before the mailbox write commits.
const raced=await app.request('/api/management/projects/p/email-settings',{method:'PUT',token:'token',headers:{'x-test-statement':'^\\s*INSERT INTO email_settings','x-test-before-statement':"UPDATE project_settings SET settings_json=json_set(settings_json,'$.deleted_at',123),updated_at=123 WHERE project_id='p'"},body:{from_name:'Stale',from_address:'stale@example.com',inbound_address:'stale@example.com',is_enabled:true}})
assert.equal(raced.status,409,'a mailbox write that reaches the database after deletion must be rejected')
const staleWrite=await DB.prepare("SELECT from_address,inbound_address,is_enabled FROM email_settings WHERE project_id='p'").first()
assert.equal(staleWrite.from_address,'support@example.com');assert.equal(staleWrite.inbound_address,'inbound@example.com');assert.equal(staleWrite.is_enabled,1)
await DB.prepare("UPDATE project_settings SET settings_json=?,updated_at=1 WHERE project_id='p'").bind(liveSettings).run()
assert.equal((await call('/api/management','/projects/p','DELETE')).status,200,'project deletion releases mailbox ownership')
const archivedEmail=await DB.prepare("SELECT inbound_address,is_enabled FROM email_settings WHERE project_id='p'").first();assert.equal(archivedEmail.inbound_address,null);assert.equal(archivedEmail.is_enabled,0)
const archivedSettings=JSON.parse((await DB.prepare("SELECT settings_json FROM project_settings WHERE project_id='p'").first()).settings_json);assert.equal(archivedSettings.retired_inbound_address,'inbound@example.com','deleted mailbox remains in project history')
assert.equal((await callQ('/projects/q/email-settings','PUT',{from_name:'Other Support',from_address:'other@example.com',inbound_address:'Support <Inbound@example.com>',is_enabled:true})).status,200,'display-form mailbox is accepted after release')
const reclaimed=await DB.prepare("SELECT inbound_address,is_enabled FROM email_settings WHERE project_id='q'").first();assert.equal(reclaimed.inbound_address,'inbound@example.com');assert.equal(reclaimed.is_enabled,1)
 }finally{await app.close()}
}
