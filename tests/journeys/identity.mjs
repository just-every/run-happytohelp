import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {startApp,sha} from './kit/app.mjs'
import {twoFactorJourney,totp,encryptionKey} from '../helpers/identity/two-factor.mjs'
import {emailStepUpJourney} from '../helpers/identity/email-step-up.mjs'
import {rolesAuditJourney} from '../helpers/identity/roles-audit.mjs'

const ownerTicketTables=['workflow_rules','ticket_views','ticket_field_values','ticket_history','ticket_group_members','ticket_fields','ticket_groups','ticket_statuses']
const ownerSetupTables=['owner_setup','users','projects','project_settings','user_settings','user_project_preferences','memberships','credentials','sessions',...ownerTicketTables]
const migrationStatements=async name=>{const source=(await readFile('migrations/'+name,'utf8')).replace(/^\s*--[^\n]*$/gm,'');return [...source.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(match=>match[1]).filter(sql=>sql.trim()!==';')}
const mailOutbound=(mail,{reject=()=>false}={})=>async(request,entry)=>{const url=new URL(request.url);if(url.host==='api.resend.com'){if(reject(entry))return new Response('rejected',{status:400});const body=JSON.parse(entry.body);mail.push({to:body.to[0],text:body.text,subject:body.subject});return Response.json({id:'email-'+mail.length})}if(url.host==='api.sendgrid.com'){if(reject(entry))return new Response('rejected',{status:400});const body=JSON.parse(entry.body);mail.push({to:body.personalizations[0].to[0].email,text:body.content.find(part=>part.type==='text/plain').value,subject:body.subject});return new Response(null,{status:202,headers:{'x-message-id':'fixture-'+mail.length}})}throw new Error('Unexpected outbound request: '+request.url)}
const tokenOf=url=>new URL(url).searchParams.get('token')

test('first-owner setup validates, refuses cross-site claims, rolls back a failed claim, admits exactly one concurrent owner and then stays closed',async()=>{
 const app=await startApp({base:'http://127.0.0.1'})
 try{
  const local='http://127.0.0.1',count=async table=>(await app.first(`SELECT count(*) AS n FROM ${table}`)).n
  const empty=async()=>{for(const table of ownerSetupTables)assert.equal(await count(table),0,table)}
  const entry={email:'Owner@Example.invalid',password:randomBytes(24).toString('base64url'),allowedOrigin:'https://example.invalid/page'}
  const submit=(body=entry,headers={},base=local)=>app.request('/api/identity/bootstrap',{base,raw:typeof body==='string',body:typeof body==='string'?body:body,headers:{'content-type':'application/json',origin:base,...headers}})
  const state=async(base=local)=>(await app.call('/api/identity/setup',{base})).data
  assert.deepEqual(await state(),{available:true})
  for(const invalid of [{...entry,email:'bad'},{...entry,password:'short'},{...entry,allowedOrigin:'javascript:alert(1)'},{...entry,name:''},{...entry,ownerName:' '},{...entry,primaryColor:'red'},{...entry,primaryColor:'#123456;bad'},{...entry,primaryColor:null},'{',null])assert.equal((await submit(invalid)).status,400,JSON.stringify(invalid))
  assert.equal((await submit(entry,{origin:'https://hostile.invalid'})).status,403)
  assert.equal((await submit(entry,{'sec-fetch-site':'cross-site'})).status,403)
  await empty()
  await app.configure({RER_INSTALLATION_ID:'managed-fixture'})
  assert.deepEqual(await state(),{available:true,tokenRequired:true});assert.equal((await submit()).status,503)
  await app.configure({H2H_SETUP_TOKEN:'synthetic-private-owner-setup-fixture',H2H_SETUP_OWNER_EMAIL:'owner@example.invalid'})
  assert.equal((await submit()).status,403);assert.equal((await submit({...entry,setupToken:'incorrect'})).status,403)
  assert.equal((await submit({...entry,email:'attacker@example.invalid',setupToken:'synthetic-private-owner-setup-fixture'})).status,403)
  await empty()
  await app.configure({RER_INSTALLATION_ID:undefined,H2H_SETUP_TOKEN:undefined,H2H_SETUP_OWNER_EMAIL:undefined})
  // A database failure after claiming setup rolls back every write, including its marker.
  await app.db.prepare("CREATE TRIGGER reject_setup_credentials BEFORE INSERT ON credentials BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run()
  assert.equal((await submit({...entry,ownerName:'Actual Owner',primaryColor:'#AABBCC'})).status,500)
  await empty();await app.db.prepare('DROP TRIGGER reject_setup_credentials').run()
  // Local setup suppresses mail: two concurrent claims leave one owner and no provider request or stored delivery.
  await app.configure({H2H_LOCAL:'true',EMAIL_PROVIDER:'development',APP_ORIGIN:local,EMAIL_FROM:'HappyToHelp <noreply@localhost.test>'})
  const racers=[entry,{...entry,email:'racer@example.invalid'}],responses=await Promise.all(racers.map(body=>submit(body)))
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal(app.requests.length,0,'local setup contacts no mail provider')
  const success=responses.find(r=>r.status===201),winner=racers[responses.indexOf(success)].email.toLowerCase(),owner=await success.json()
  assert.equal(await count('email_deliveries'),0);assert.equal(await count('user_settings'),0)
  assert.equal((await app.first('SELECT name FROM projects')).name,'Example','the workspace is named from the website')
  assert.equal((await app.first('SELECT email FROM users')).email,winner)
  const settings=JSON.parse((await app.first('SELECT settings_json FROM project_settings')).settings_json),starter=await app.first('SELECT id,is_enabled FROM ai_profiles WHERE project_id=?',owner.projectId)
  assert.deepEqual(settings.derived,{name:'Example',colour:true});assert.match(settings.primary_color,/^#[0-9a-f]{6}$/)
  assert.deepEqual([settings.default_visitor_ai_id,starter.is_enabled],[starter.id,1],'setup provisions an enabled starter assistant')
  assert.match(success.headers.get('set-cookie'),/HttpOnly/);assert.doesNotMatch(success.headers.get('set-cookie'),/Secure/)
  for(const table of ['owner_setup','users','projects','memberships','credentials','sessions'])assert.equal(await count(table),1,table)
  const login=await app.request('/api/identity/login',{base:local,body:{email:winner,password:entry.password}});assert.equal(login.status,200);assert.doesNotMatch(login.headers.get('set-cookie'),/Secure/)
  const secure=await app.request('/api/identity/login',{base:'https://example.invalid',body:{email:winner,password:entry.password}});assert.equal(secure.status,200);assert.match(secure.headers.get('set-cookie'),/Secure/)
  assert.deepEqual(await state(),{available:false});assert.equal((await submit()).status,409)
  // Deleting every owner row never reopens setup, nor does a legacy partial installation or an import.
  for(const table of [...ownerTicketTables,'sessions','credentials','memberships','user_settings','user_project_preferences','project_settings','ai_profiles','users','projects'])await app.db.prepare(`DELETE FROM ${table}`).run()
  assert.deepEqual(await state(),{available:false});assert.equal((await submit()).status,409)
  await app.db.prepare('DROP TRIGGER owner_setup_on_user').run();await app.db.prepare('DROP TRIGGER owner_setup_on_project').run();await app.db.prepare('DROP TABLE owner_setup').run()
  await app.db.prepare("INSERT INTO users VALUES('legacy','legacy@example.invalid','Legacy',1)").run()
  for(const sql of await migrationStatements('0097_owner_setup.sql'))await app.db.prepare(sql).run()
  assert.deepEqual(await state(),{available:false});assert.equal((await submit()).status,409);assert.equal(await count('credentials'),0)
  await app.db.prepare("DELETE FROM users WHERE id='legacy'").run();assert.deepEqual(await state(),{available:false})
  await app.db.prepare('DELETE FROM owner_setup').run();await app.db.prepare("INSERT INTO users VALUES('imported','import@example.invalid','Imported',1)").run();await app.db.prepare('DELETE FROM users').run()
  assert.deepEqual(await state(),{available:false},'an imported owner durably consumes first-owner setup')
 }finally{await app.close()}
})

test('a managed install claims only with its credential; a dropped welcome mail stays uncertain and is never resent',async()=>{
 const mail=[],dropped=[]
 const app=await startApp({outbound:async(request,entry)=>{if(new URL(request.url).host==='api.resend.com'){dropped.push(JSON.parse(entry.body));throw new TypeError('connection lost')}throw new Error('Unexpected outbound request: '+request.url)},bindings:{RER_INSTALLATION_ID:'managed-fixture',H2H_SETUP_TOKEN:'synthetic-private-owner-setup-fixture',H2H_SETUP_OWNER_EMAIL:'OWNER@example.invalid',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'re_fixture',EMAIL_FROM:'HappyToHelp <welcome@example.invalid>'}})
 try{
  const local='http://127.0.0.1',password=randomBytes(24).toString('base64url')
  const managedEntry={name:'First Owner',ownerName:'  Actual Owner  ',email:'Owner@Example.invalid',password,allowedOrigin:'https://example.invalid/page',primaryColor:'#AABBCC',setupToken:'synthetic-private-owner-setup-fixture'}
  const submit=body=>app.request('/api/identity/bootstrap',{base:local,body,headers:{origin:local}})
  const responses=await Promise.all([submit(managedEntry),submit(managedEntry)])
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409])
  assert.equal((await app.first('SELECT name FROM users')).name,'Actual Owner');assert.equal((await app.first('SELECT name FROM projects')).name,'First Owner')
  assert.match((await app.first('SELECT verification_secret FROM projects')).verification_secret,/^[0-9a-f]{64}$/,'owner setup gives the first project a server secret')
  const settings=JSON.parse((await app.first('SELECT settings_json FROM project_settings')).settings_json);assert.deepEqual([settings.primary_color,settings.derived],['#aabbcc',{name:null,colour:false}])
  const owner=await responses.find(r=>r.status===201).json();assert.equal(owner.welcomeEmail,'uncertain')
  assert.equal(dropped.length,1);assert.deepEqual(dropped[0].to,['owner@example.invalid'])
  assert.equal((await app.first('SELECT state FROM email_deliveries WHERE id=?','welcome:'+owner.projectId)).state,'uncertain')
  await app.scheduled();assert.equal(dropped.length,1,'scheduled work never sends an uncertain welcome again');assert.equal(mail.length,0)
  assert.equal((await app.call('/api/identity/login',{base:local,body:{email:'owner@example.invalid',password}})).status,200)
  // Retired personal preferences stay historical data, untouched by profile edits.
  const profile=(method='GET',body)=>app.call('/api/management/profile',{base:local,method,body,token:owner.token})
  assert.equal('visual_inspiration' in (await profile()).data.data,false);assert.equal((await app.call('/api/management/profile',{base:local})).status,401)
  await app.db.prepare('INSERT INTO user_settings(user_id,visual_inspiration) VALUES(?,?)').bind(owner.userId,'Preserved historical preference').run()
  assert.equal((await profile('PUT',{name:'Renamed Owner',visual_inspiration:'Do not reactivate this field'})).status,200)
  assert.equal((await app.first('SELECT visual_inspiration FROM user_settings WHERE user_id=?',owner.userId)).visual_inspiration,'Preserved historical preference')
  for(const table of [...ownerTicketTables,'project_settings','sessions','credentials','memberships','user_settings','user_project_preferences','ai_profiles','users','projects'])await app.db.prepare(`DELETE FROM ${table}`).run()
  assert.equal((await submit(managedEntry)).status,409,'the managed credential shares the permanent claim, even after owner deletion')
 }finally{await app.close()}
})

test('a deployed install claims only with its private setup token or its owner-email deploy claim; loopback development stays tokenless',async()=>{
 // The public deploy command refuses the local trial owner before any build or provider work.
 for(const flags of [[],['--dry-run']]){
  const result=spawnSync(process.execPath,['node_modules/@runeditrun/rer/bin/rer.mjs','deploy',...flags,'--non-interactive'],{env:{...process.env,OWNER_EMAIL:'owner@run-happytohelp.test'},encoding:'utf8'})
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/real OWNER_EMAIL/);assert.doesNotMatch(result.stdout+result.stderr,/Building|Deploying the/)
 }
 const app=await startApp()
 try{
  const entry={name:'First Owner',email:'owner@example.invalid',password:'synthetic-long-test-password',allowedOrigin:'https://example.invalid'},deployed='https://help.example.test'
  const submit=(base,body=entry)=>app.request('/api/identity/bootstrap',{base,body,headers:{origin:base}})
  const state=async base=>(await app.call('/api/identity/setup',{base})).data
  const users=async()=>(await app.first('SELECT count(*) AS n FROM users')).n
  const reset=async(changes={})=>{for(const table of [...ownerTicketTables,'sessions','credentials','memberships','user_project_preferences','project_settings','ai_profiles','users','projects','owner_setup'])await app.db.prepare(`DELETE FROM ${table}`).run();await app.configure({H2H_SETUP_TOKEN:undefined,RER_INSTALLATION_ID:undefined,APP_ORIGIN:undefined,OWNER_EMAIL:undefined,...changes});assert.equal(await users(),0)}
  await reset()
  assert.deepEqual(await state(deployed),{available:true,tokenRequired:true})
  for(const body of [entry,{...entry,setupToken:''},{...entry,setupToken:'guessed-token'}]){const refused=await submit(deployed,body);assert.equal(refused.status,503);assert.match(await refused.text(),/requires a private H2H_SETUP_TOKEN/)}
  for(const origin of ['https://happytohelp.owner.workers.dev','http://192.168.1.20:5173','http://localhost.example.test'])assert.equal((await submit(origin)).status,503,origin)
  // A loopback address behind a proxy is still a deployment when APP_ORIGIN is public.
  await app.configure({APP_ORIGIN:deployed});assert.deepEqual(await state('http://127.0.0.1:8787'),{available:true,tokenRequired:true});assert.equal((await submit('http://127.0.0.1:8787')).status,503);assert.equal(await users(),0)
  const token='f'.repeat(64);await app.configure({APP_ORIGIN:undefined,H2H_SETUP_TOKEN:token})
  assert.equal((await submit(deployed)).status,403);assert.equal((await submit(deployed,{...entry,setupToken:'f'.repeat(63)})).status,403);assert.equal(await users(),0)
  const created=await submit(deployed,{...entry,setupToken:token});assert.equal(created.status,201);assert.match(created.headers.get('set-cookie'),/Secure/)
  assert.deepEqual(await state(deployed),{available:false,tokenRequired:true});assert.equal((await submit(deployed,{...entry,setupToken:token})).status,409)
  await app.configure({H2H_SETUP_TOKEN:undefined});assert.equal((await submit(deployed,{...entry,email:'second@example.invalid'})).status,503,'a redeploy without the token stays closed');assert.equal(await users(),1)
  for(const origin of ['http://127.0.0.1:5173','http://localhost:5173','http://[::1]:5173']){await reset();assert.deepEqual(await state(origin),{available:true});const local=await submit(origin);assert.equal(local.status,201,origin);assert.doesNotMatch(local.headers.get('set-cookie'),/Secure/)}
  for(const origin of ['http://127.0.0.1:5173',deployed]){
   await reset({RER_INSTALLATION_ID:'managed-fixture'});assert.deepEqual(await state(origin),{available:true,tokenRequired:true})
   const waiting=await submit(origin);assert.equal(waiting.status,503);assert.match(await waiting.text(),/awaiting its installation credential/)
   await app.configure({H2H_SETUP_TOKEN:'synthetic-managed-private-owner-setup-fixture'});assert.equal((await submit(origin)).status,403);assert.equal((await submit(origin,{...entry,setupToken:'synthetic-managed-private-owner-setup-fixture'})).status,201)
  }
  // The deploy claim takes its identity from this Worker's owner email, refusing rer's local default.
  const hosted='https://happytohelp.owner.workers.dev'
  await reset({H2H_SETUP_TOKEN:'hosted-owner-token',APP_ORIGIN:hosted,OWNER_EMAIL:'owner@run-happytohelp.test'})
  const trapped=await app.request('/auth/bootstrap',{base:hosted,body:{token:'hosted-owner-token'},headers:{origin:hosted}});assert.equal(trapped.status,503);assert.equal(await users(),0)
  await app.configure({OWNER_EMAIL:'ada.lovelace+support@example.test'})
  const claim=await app.request('/auth/bootstrap',{base:hosted,body:{token:'hosted-owner-token',displayName:'Owner',returnTo:'/setup'},headers:{origin:hosted}})
  assert.equal(claim.status,303);assert.equal(claim.headers.get('Location'),'/setup')
  assert.deepEqual(await app.first('SELECT email,name FROM users'),{email:'ada.lovelace+support@example.test',name:'Ada Lovelace'});assert.equal((await app.first('SELECT name FROM projects')).name,'My workspace')
 }finally{await app.close()}
})

test('native passwords: sign-in, change and owner reset revoke sessions, an invitation accepts once, foreign switching is refused and a removed member keeps account-only sign-in',async()=>{
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:'synthetic-identity-fixture-setup-token-0123456789abcdef',INTEGRATION_ENCRYPTION_KEY:encryptionKey()}})
 try{
  const call=(path,body,token)=>app.call('/api/identity'+path,{body,token})
  assert.equal((await call('/session')).status,401)
  const owner=(await call('/bootstrap',{password:'synthetic-test-setup-password-123',email:'owner@example.com',name:'Owner',allowedOrigin:'https://widget.example',setupToken:'synthetic-identity-fixture-setup-token-0123456789abcdef'})).data;assert.ok(owner.token)
  assert.equal((await call('/password',{currentPassword:'synthetic-test-setup-password-123',password:'test-correct-horse-battery'},owner.token)).status,200)
  assert.equal((await call('/session',undefined,owner.token)).status,401,'a password change revokes the setup session')
  assert.equal((await call('/login',{email:'owner@example.com',password:'synthetic-invalid-password'})).status,401)
  const login=await call('/login',{email:'owner@example.com',password:'test-correct-horse-battery'});assert.equal(login.status,200);assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);const session=login.data
  const cookieSession=await app.call('/api/identity/session',{headers:{Cookie:login.headers.get('Set-Cookie').split(';')[0]},status:200});assert.equal(cookieSession.data.id,owner.userId);assert.equal(cookieSession.data.projectId,owner.projectId);assert.equal(session.actor.role,'owner');assert.equal(session.accountOnly,false)
  const second=(await app.call('/api/management/projects',{token:session.token,body:{name:'Second native project',allowedOrigin:'https://widget.example'},status:201})).data
  const switched=(await call('/switch-project',{projectId:second.id},session.token)).data;assert.equal(switched.actor.projectId,second.id)
  const other=await app.seedWorkspace('foreign');assert.equal((await call('/switch-project',{projectId:other.projectId},session.token)).status,403)
  assert.equal((await call('/switch-project',{projectId:other.projectId},switched.token)).status,403)
  await app.call('/api/management/projects/'+second.id,{token:session.token,method:'DELETE',status:200});assert.equal((await call('/session',undefined,switched.token)).status,401)
  const survivor=(await call('/login',{email:'owner@example.com',password:'test-correct-horse-battery'})).data;assert.equal(survivor.memberships.length,1);assert.equal(survivor.actor.projectId,owner.projectId)
  const invitation={token:new URL((await app.call(`/api/management/projects/${owner.projectId}/agents`,{body:{email:'new@example.com'},token:session.token})).data.data.invitationUrl).searchParams.get('token')}
  assert.equal((await call('/accept-token',{token:invitation.token,name:'New',password:'new-correct-horse-battery'})).status,200);assert.equal((await call('/accept-token',{token:invitation.token,name:'New',password:'new-correct-horse-battery'})).status,400)
  const invited=(await call('/login',{email:'new@example.com',password:'new-correct-horse-battery'})).data;assert.equal(invited.actor.projectId,owner.projectId)
  // Issuing a teammate's reset link needs the owner's own second factor.
  const setup=(await call('/two-factor/totp',{},session.token)).data;assert.equal((await call('/two-factor/totp/confirm',{factorId:setup.factorId,code:totp(setup.secret)},session.token)).status,201)
  const reset=(await call('/password-reset',{userId:invited.actor.id},session.token)).data
  assert.equal((await call('/accept-token',{token:reset.token,password:'reset-correct-horse-battery'})).status,200);assert.equal((await call('/session',undefined,invited.token)).status,401,'an owner reset revokes the member session')
  assert.equal((await call('/login',{email:'new@example.com',password:'reset-correct-horse-battery'})).status,200)
  await app.call('/api/management/projects/'+owner.projectId,{token:session.token,method:'DELETE',status:200})
  const removed=(await call('/login',{email:'new@example.com',password:'reset-correct-horse-battery'})).data;assert.equal(removed.accountOnly,true)
  const recreated=(await app.call('/api/management/projects',{token:removed.token,body:{name:'Recreated native workspace',allowedOrigin:'https://widget.example'},status:201})).data
  assert.equal((await call('/switch-project',{projectId:recreated.id},removed.token)).status,200)
  const account=(await call('/login',{email:'owner@example.com',password:'test-correct-horse-battery'})).data;assert.equal(account.accountOnly,true);assert.equal(account.actor.projectId,null);assert.equal((await call('/session',undefined,account.token)).status,200)
 }finally{await app.close()}
})

test('signed widget identity resumes one contact, refuses forged or blocked identities, and every workspace holds its own unexposed server secret',async()=>{
 const app=await startApp({bindings:{REGISTRATION_ENABLED:'true'}})
 try{
  const ws=await app.seedWorkspace('signed',{allowedOrigin:'https://widget.example'})
  await app.db.prepare('UPDATE projects SET verification_secret=? WHERE id=?').bind('signature-secret',ws.projectId).run()
  const read=await app.request('/api/identity/projects/'+ws.projectId,{token:ws.tokens.operator}),body=await read.text();assert.equal(read.status,200)
  assert.ok(!body.includes('signature-secret'),'the project read never exposes the verification secret');assert.deepEqual(Object.keys(JSON.parse(body)).sort(),['allowed_origin','created_at','id','name','widget_key'])
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('signature-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('customer-verified'))).toString('hex')
  const widgetSession=extra=>app.call('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey,...extra},headers:{Origin:'https://widget.example'}})
  assert.equal((await app.call('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey},headers:{Origin:'https://foreign.example'}})).status,403)
  const verified1=(await widgetSession({identifier:'customer-verified',contact_hash:signature})).data,verified2=(await widgetSession({identifier:'customer-verified',contact_hash:signature})).data
  assert.equal(verified1.contactId,verified2.contactId,'a valid contact hash resumes the same contact')
  assert.notEqual((await widgetSession({identifier:'customer-verified'})).data.contactId,verified1.contactId,'an unsigned identifier is not that contact')
  assert.equal((await widgetSession({identifier:'customer-verified',contact_hash:'0'.repeat(64)})).status,403)
  await app.db.prepare(`UPDATE contacts SET metadata_json='{"is_blocked":true}' WHERE id=?`).bind(verified1.contactId).run()
  assert.equal((await widgetSession({identifier:'customer-verified',contact_hash:signature})).status,403);assert.equal((await app.call('/api/identity/session',{token:verified1.token})).status,401,'blocking ends the contact session')
  // A verified registration creates a workspace with its own 256-bit secret.
  const verify=async token=>{await app.db.prepare('INSERT INTO registrations VALUES(?,?,?,?,?,?,?,NULL)').bind(sha(token),token+'@example.test','Owner','hash','Project '+token,'https://'+token+'.example.test',Date.now()+60000).run();return (await app.call('/api/identity/verify-email',{body:{token},status:200})).data.projectId}
  const secrets=await Promise.all([await verify('first'),await verify('second')].map(async id=>(await app.first('SELECT verification_secret FROM projects WHERE id=?',id)).verification_secret))
  for(const secret of secrets)assert.match(secret,/^[0-9a-f]{64}$/);assert.notEqual(secrets[0],secrets[1])
  // The upgrade backfill gives every older project without a secret its own and keeps existing ones.
  for(const [id,secret] of [['null-secret',null],['empty-secret',''],['kept-secret','owner-chosen-secret']])await app.db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at,verification_secret) VALUES(?,?,?,?,1,?)').bind(id,id,'w-'+id,'https://'+id+'.test',secret).run()
  for(const sql of await migrationStatements('0106_project_verification_secret.sql'))await app.db.prepare(sql).run()
  const after=Object.fromEntries((await app.sql("SELECT id,verification_secret FROM projects WHERE id IN ('null-secret','empty-secret','kept-secret')")).map(row=>[row.id,row.verification_secret]))
  assert.equal(after['kept-secret'],'owner-chosen-secret');assert.match(after['null-secret'],/^[0-9a-f]{64}$/);assert.match(after['empty-secret'],/^[0-9a-f]{64}$/);assert.notEqual(after['null-secret'],after['empty-secret'])
 }finally{await app.close()}
})

test('pending invitations: owners and admins list, copy, resend and revoke within their role; links retire on acceptance, expiry, revocation and deleted workspaces',async()=>{
 const mail=[],emailBindings={APP_ORIGIN:'https://support.example.test',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'HappyToHelp <support@example.test>'}
 const app=await startApp({bindings:emailBindings,outbound:mailOutbound(mail)})
 try{
  const acme=await app.seedWorkspace('acme',{name:'Acme Desk'}),beta=await app.seedWorkspace('beta')
  const call=(path,{token,method,body}={})=>app.call('/api/management'+path,{token,method,body})
  const invite=async(workspace,email,role='operator',token=workspace.tokens.owner)=>{const response=await call(`/projects/${workspace.projectId}/agents`,{token,body:{email,role}});assert.equal(response.status,201,JSON.stringify(response.data));return response.data.data}
  const liveTokens=async(projectId,email)=>(await app.first("SELECT count(*) n FROM identity_tokens WHERE project_id=? AND lower(email)=? AND kind='invite' AND consumed_at IS NULL AND expires_at>?",projectId,email,Date.now())).n
  const pending=async(workspace,token=workspace.tokens.owner)=>{const response=await call(`/projects/${workspace.projectId}/agents`,{token});assert.equal(response.status,200);return {rows:response.data.data.filter(row=>row.pending),emailConfigured:response.data.emailConfigured}}
  const status=async(token,viewer)=>(await app.call('/api/identity/link-status',{body:{kind:'invitation',token},token:viewer})).data
  const accept=(url,name='New Person')=>app.call('/api/identity/accept-token',{body:{token:tokenOf(url),name,password:'synthetic-a-long-enough-password'}})
  // The list gives one row per email, its expiry, and who may manage it.
  const created=await invite(acme,'Pat@Example.test');await invite(acme,'pat@example.test');await invite(acme,'quinn@example.test','admin')
  const ownerView=await pending(acme);assert.equal(ownerView.emailConfigured,true);assert.equal(ownerView.rows.length,2,'two links for one email are one row')
  const pat=ownerView.rows.find(row=>row.email==='pat@example.test');assert.equal(pat.invitation_id,'pat@example.test');assert.equal(pat.role,'operator');assert.ok(pat.expires_at>Date.now());assert.ok(ownerView.rows.every(row=>row.canManage))
  const adminView=await pending(acme,acme.tokens.admin);assert.equal(adminView.rows.find(row=>row.email==='pat@example.test').canManage,true);assert.equal(adminView.rows.find(row=>row.email==='quinn@example.test').canManage,false,'an admin cannot manage an admin invitation')
  assert.ok((await pending(acme,acme.tokens.operator)).rows.every(row=>row.canManage===false));assert.equal((await pending(beta)).rows.length,0,'another workspace sees none of them')
  assert.equal(new URL(created.invitationUrl).origin,emailBindings.APP_ORIGIN);assert.match(created.invitationUrl,/\/accept-invitation\?token=/);assert.ok(mail[0].text.includes(emailBindings.APP_ORIGIN+'/accept-invitation'))
  // Copy link issues another working link without mail; earlier links stay valid.
  const first=await invite(acme,'copy@example.test'),copied=(await call(`/projects/${acme.projectId}/invitations/${encodeURIComponent('copy@example.test')}/link`,{token:acme.tokens.owner,method:'POST'})).data.data
  assert.equal(copied.email,'copy@example.test');assert.notEqual(tokenOf(copied.invitationUrl),tokenOf(first.invitationUrl));assert.equal(await liveTokens(acme.projectId,'copy@example.test'),2)
  const copiedStatus=await status(tokenOf(copied.invitationUrl));assert.deepEqual([copiedStatus.state,copiedStatus.workspace,copiedStatus.email,copiedStatus.role,copiedStatus.accountExists,copiedStatus.projectId],['valid','Acme Desk','copy@example.test','operator',false,acme.projectId]);assert.deepEqual(copiedStatus.viewer,{signedIn:false,email:null,matches:false})
  assert.equal(mail.filter(message=>message.to==='copy@example.test').length,1,'copying a link sends no email')
  // Resend mails a fresh link that creates the account.
  const resendFirst=await invite(acme,'resend@example.test'),before=mail.length,resent=await call(`/projects/${acme.projectId}/invitations/resend%40example.test/resend`,{token:acme.tokens.owner,method:'POST'})
  assert.equal(resent.status,201);assert.equal(resent.data.data.delivery,'sent');assert.equal(mail.length,before+1);const fresh=mail.at(-1).text.match(/https?:\/\/\S+/)[0];assert.notEqual(tokenOf(fresh),tokenOf(resendFirst.invitationUrl))
  assert.equal((await accept(fresh)).status,200);assert.equal((await app.first("SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND u.email='resend@example.test'",acme.projectId)).role,'operator')
  assert.deepEqual(await status(tokenOf(resendFirst.invitationUrl)),{state:'used'},'accepting retires the sibling links for the same email');assert.equal((await accept(resendFirst.invitationUrl)).status,400)
  // Revoke removes the row and every link.
  const one=await invite(acme,'revoke@example.test'),second=(await call(`/projects/${acme.projectId}/invitations/revoke%40example.test/link`,{token:acme.tokens.owner,method:'POST'})).data.data
  assert.equal((await call(`/projects/${acme.projectId}/invitations/revoke%40example.test`,{token:acme.tokens.owner,method:'DELETE'})).status,200);assert.equal(await liveTokens(acme.projectId,'revoke@example.test'),0)
  for(const url of [one.invitationUrl,second.invitationUrl]){assert.equal((await accept(url)).status,400);assert.equal((await status(tokenOf(url))).state,'invalid')}
  assert.equal(await app.first("SELECT 1 FROM users WHERE email='revoke@example.test'"),null);assert.equal((await call(`/projects/${acme.projectId}/invitations/revoke%40example.test`,{token:acme.tokens.owner,method:'DELETE'})).status,404)
  // Every management action re-checks the caller.
  for(const action of [{name:'revoke',method:'DELETE',suffix:''},{name:'copy-link',method:'POST',suffix:'/link'},{name:'resend',method:'POST',suffix:'/resend'}]){
   const email=`guard-${action.name}@example.test`,elevated=`admin-${action.name}@example.test`;await invite(acme,email);await invite(acme,elevated,'admin')
   const mailBefore=mail.length,linksBefore=await liveTokens(acme.projectId,email),path=(workspace,who)=>`/projects/${workspace.projectId}/invitations/${encodeURIComponent(who)}${action.suffix}`
   assert.equal((await call(path(acme,email),{method:action.method})).status,401);assert.equal((await call(path(acme,email),{token:acme.tokens.operator,method:action.method})).status,403)
   assert.equal((await call(path(acme,email),{token:beta.tokens.owner,method:action.method})).status,403);assert.equal((await call(path(beta,email),{token:beta.tokens.owner,method:action.method})).status,404)
   assert.equal((await call(path(acme,elevated),{token:acme.tokens.admin,method:action.method})).status,403)
   assert.equal(await liveTokens(acme.projectId,email),linksBefore);assert.equal(await liveTokens(acme.projectId,elevated),1);assert.equal(mail.length,mailBefore,`${action.name}: nothing was mailed`)
   assert.ok([200,201].includes((await call(path(acme,elevated),{token:acme.tokens.owner,method:action.method})).status));assert.ok([200,201].includes((await call(path(acme,email),{token:acme.tokens.admin,method:action.method})).status))
  }
  // Accepted or expired invitations cannot be managed; expiry and workspace deletion end their links.
  const taken=await invite(acme,'taken@example.test');assert.equal((await accept(taken.invitationUrl)).status,200)
  const late=await invite(acme,'late@example.test');await app.db.prepare('UPDATE identity_tokens SET expires_at=? WHERE lower(email)=?').bind(Date.now()-1000,'late@example.test').run()
  assert.deepEqual(await status(tokenOf(late.invitationUrl)),{state:'expired'})
  for(const email of ['taken@example.test','late@example.test'])for(const [method,suffix] of [['DELETE',''],['POST','/link'],['POST','/resend']])assert.equal((await call(`/projects/${acme.projectId}/invitations/${encodeURIComponent(email)}${suffix}`,{token:acme.tokens.owner,method})).status,404,`${method}${suffix} ${email}`)
  // An existing account holder is told to sign in, and a different signed-in account is spotted.
  assert.equal((await call(`/projects/${acme.projectId}/agents`,{token:acme.tokens.owner,body:{email:'operator-acme@example.test'}})).status,409,'an existing member cannot be invited again')
  await app.db.prepare("INSERT INTO users(id,email,name,created_at) VALUES('holder','holder@example.test','Holder',1)").run()
  const forHolder=tokenOf((await invite(acme,'holder@example.test')).invitationUrl);assert.equal((await status(forHolder)).accountExists,true)
  assert.deepEqual((await status(forHolder,acme.tokens.owner)).viewer,{signedIn:true,email:'owner-acme@example.test',matches:false})
  await app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'holder',NULL,'operator',?)").bind(sha('holder-token'),Date.now()+60000).run()
  assert.deepEqual((await status(forHolder,'holder-token')).viewer,{signedIn:true,email:'holder@example.test',matches:true})
  assert.equal((await app.call('/api/identity/accept-invitation',{body:{token:forHolder},token:'holder-token'})).status,200);assert.deepEqual(await status(forHolder),{state:'used'})
  assert.equal((await app.first("SELECT role FROM memberships WHERE project_id=? AND user_id='holder'",acme.projectId)).role,'operator')
  const doomed=tokenOf((await invite(acme,'doomed@example.test')).invitationUrl)
  await app.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,?,1) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json").bind(acme.projectId,JSON.stringify({deleted_at:1})).run()
  assert.deepEqual(await status(doomed),{state:'invalid'})
  // Without a mail provider, resend fails closed and leaves no new link.
  await app.configure({EMAIL_API_KEY:undefined,EMAIL_FROM:undefined})
  const quiet=await app.seedWorkspace('quiet'),noMail=(await call(`/projects/${quiet.projectId}/agents`,{token:quiet.tokens.owner,body:{email:'noemail@example.test',role:'operator'}})).data.data
  assert.equal(noMail.delivery,'not_configured');assert.equal((await pending(quiet)).emailConfigured,false)
  const mailCount=mail.length,refused=await call(`/projects/${quiet.projectId}/invitations/noemail%40example.test/resend`,{token:quiet.tokens.owner,method:'POST'})
  assert.equal(refused.status,503);assert.match(JSON.stringify(refused.data),/not configured/i);assert.equal(mail.length,mailCount);assert.equal(await liveTokens(quiet.projectId,'noemail@example.test'),1)
 }finally{await app.close()}
})

test('identity pages learn the install state first; sign-up and recovery refuse plainly without mail and answer every address alike with it; links report their state without being consumed',async()=>{
 const mail=[],origin='https://app.example',configured={EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'HappyToHelp <support@example.test>',APP_ORIGIN:origin,REGISTRATION_ENABLED:'true'}
 const app=await startApp({outbound:mailOutbound(mail)})
 try{
  const options=async()=>{const response=await app.call('/api/identity/auth-options');assert.equal(response.headers.get('Cache-Control'),'no-store');return response.data}
  const status=async(kind,token)=>(await app.call('/api/identity/link-status',{body:{kind,token}})).data
  const register={name:'X',email:'x@example.test',password:'synthetic-a-long-enough-password',projectName:'X',allowedOrigin:'https://x.example'}
  assert.deepEqual(await options(),{setupRequired:true,registrationAvailable:false,recoveryAvailable:false})
  await app.configure(configured)
  assert.deepEqual(await options(),{setupRequired:true,registrationAvailable:false,recoveryAvailable:true},'sign-up waits for the first owner')
  const early=await app.call('/api/identity/register',{body:register});assert.equal(early.status,503);assert.match(JSON.stringify(early.data),/Set up this installation first/)
  assert.equal((await app.first('SELECT count(*) n FROM registrations')).n,0);assert.equal(mail.length,0)
  await app.seedWorkspace('acme',{name:'Acme Desk'})
  assert.deepEqual(await options(),{setupRequired:false,registrationAvailable:true,recoveryAvailable:true})
  for(const [changes,label] of [[{REGISTRATION_ENABLED:'false'},'the switch is required'],[{EMAIL_API_KEY:undefined,EMAIL_FROM:undefined},'email delivery is required']]){await app.configure({...configured,...changes});assert.equal((await options()).registrationAvailable,false,label)}
  await app.configure({...configured,EMAIL_API_KEY:undefined,EMAIL_FROM:undefined,REGISTRATION_ENABLED:undefined,APP_ORIGIN:undefined})
  const forgot=await app.call('/api/identity/forgot-password',{body:{email:'owner-acme@example.test'}});assert.equal(forgot.status,503);assert.match(JSON.stringify(forgot.data),/workspace owner must reset your password/)
  assert.equal((await app.first("SELECT count(*) n FROM identity_tokens WHERE kind='reset'")).n,0);assert.equal((await app.call('/api/identity/register',{body:register})).status,503);assert.equal(mail.length,0)
  await app.configure(configured)
  const known=await app.call('/api/identity/forgot-password',{body:{email:'owner-acme@example.test'}}),unknown=await app.call('/api/identity/forgot-password',{body:{email:'nobody@example.test'}})
  assert.equal(known.status,200);assert.equal(unknown.status,200);assert.deepEqual(known.data,unknown.data);assert.deepEqual(mail.map(message=>message.to),['owner-acme@example.test'])
  const resetToken=tokenOf(mail[0].text.match(/https?:\/\/\S+/)[0]);assert.deepEqual(await status('reset',resetToken),{state:'valid',email:'owner-acme@example.test'})
  assert.equal((await status('invitation',resetToken)).state,'invalid','a reset link is not an invitation')
  for(const kind of ['invitation','reset','verify-email']){assert.deepEqual(await status(kind,''),{state:'missing'});assert.deepEqual(await status(kind,null),{state:'missing'});assert.deepEqual(await status(kind,'not-a-real-token'),{state:'invalid'});assert.deepEqual(await status(kind,'x'.repeat(600)),{state:'invalid'})}
  assert.equal((await app.call('/api/identity/link-status',{body:{kind:'other',token:'x'}})).status,400)
  for(const [token,email,expires,used] of [['verify-live','new@example.test',Date.now()+60000,null],['verify-used','used@example.test',Date.now()+60000,Date.now()],['verify-old','old@example.test',Date.now()-1,null]])await app.db.prepare('INSERT INTO registrations VALUES(?,?,?,?,?,?,?,?)').bind(sha(token),email,'Person','hash',token+' Works','https://'+token+'.example',expires,used).run()
  assert.deepEqual(await status('verify-email','verify-live'),{state:'valid',email:'new@example.test',workspace:'verify-live Works'});assert.deepEqual(await status('verify-email','verify-used'),{state:'used'});assert.deepEqual(await status('verify-email','verify-old'),{state:'expired'})
  assert.equal((await app.first("SELECT count(*) n FROM users WHERE email='new@example.test'")).n,0,'checking a link creates nothing')
  // The reset link sets a new password once and revokes existing sessions.
  assert.equal((await app.call('/api/identity/accept-token',{body:{token:resetToken,password:'synthetic-new-reset-password'},status:200})).status,200)
  assert.equal((await app.call('/api/identity/session',{token:'owner-token-acme'})).status,401);assert.deepEqual(await status('reset',resetToken),{state:'used'})
  assert.equal((await app.call('/api/identity/login',{body:{email:'owner-acme@example.test',password:'synthetic-new-reset-password'}})).status,200)
 }finally{await app.close()}
})

test('a magic sign-in link is mailed as a bounded hashed capability, never consumed by GET, redeemed by exactly one explicit POST into the current role, and replay or redirect input changes nothing',async()=>{
 const mail=[],origin='https://app.example'
 const app=await startApp({bindings:{EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test',APP_ORIGIN:origin},outbound:mailOutbound(mail)})
 try{
  const ip={'CF-Connecting-IP':'198.51.100.1'}
  const request=(email,headers=ip)=>app.call('/api/identity/magic-link',{body:{email},headers})
  const consume=(token,extra={})=>app.call('/api/identity/magic-link/consume',{body:{token,...extra},headers:ip})
  const emailedToken=()=>new URLSearchParams(new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get('token')
  const seedToken=async(key,{expires=Date.now()+60000,consumed=null}={})=>{const ws=await app.seedWorkspace(key),token=sha('capability-'+key);await app.db.prepare('INSERT INTO magic_signins VALUES(?,?,?,?,?,?)').bind(sha(token),'owner-'+key,ws.projectId,'owner-'+key+'@example.test',expires,consumed).run();return {...ws,token}}
  const sessions=async()=>(await app.first('SELECT count(*) n FROM sessions')).n
  await app.seedWorkspace('magic')
  const response=await request(' Owner-Magic@example.test '),unknown=await request('unknown@example.test');assert.equal(response.status,202);assert.equal(unknown.status,202);assert.deepEqual(unknown.data,response.data,'known and unknown addresses get the same answer')
  await app.until(()=>mail.length===1,{message:'magic link mail'});const token=emailedToken(),row=await app.first('SELECT * FROM magic_signins')
  assert.equal(row.token_hash,sha(token));assert.ok(row.expires_at>Date.now()+14*60000&&row.expires_at<=Date.now()+15*60000)
  assert.equal((await app.call('/api/identity/magic-link/consume?token='+token)).status,404);assert.equal((await app.first('SELECT consumed_at FROM magic_signins')).consumed_at,null,'GET never consumes')
  const signedIn=await consume(token);assert.equal(signedIn.status,200);assert.deepEqual(signedIn.data,{signedIn:true,destination:'/conversations'})
  const cookie=signedIn.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Max-Age=86400/)
  const session=await app.call('/api/identity/session',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(session.status,200);assert.equal(session.data.projectId,'p-magic')
  assert.equal((await consume(token)).status,400,'a used link is refused')
  const concurrent=await seedToken('concurrent'),before=await sessions()
  const results=await Promise.all(Array.from({length:6},()=>consume(concurrent.token,{returnTo:'https://evil.example'})))
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400,400,400,400,400]);assert.equal(await sessions(),before+1);assert.equal(results.find(r=>r.status===200).data.destination,'/conversations')
  const expired=await seedToken('expired',{expires:Date.now()-1}),spent=await seedToken('spent',{consumed:1}),unchanged=await sessions()
  for(const value of [expired.token,spent.token,'',null,'x'.repeat(5000),{},sha('unknown')])assert.equal((await consume(value)).status,400)
  assert.equal(await sessions(),unchanged)
  const role=await seedToken('role');await app.db.prepare("UPDATE memberships SET role='operator' WHERE user_id='owner-role'").run()
  const roleCookie=(await consume(role.token)).headers.get('Set-Cookie').split(';')[0],read=()=>app.call('/api/identity/session',{headers:{Cookie:roleCookie}})
  assert.equal((await read()).data.role,'operator','the current role is used');await app.db.prepare("UPDATE sessions SET revoked_at=1 WHERE actor_id='owner-role'").run();assert.equal((await read()).status,401)
  const destination=await seedToken('destination');assert.equal((await consume(destination.token,{returnTo:'/projects/create'})).data.destination,'/projects/create')
  await app.db.prepare("INSERT INTO users(id,email,name,created_at) VALUES('standalone','standalone@example.test','Standalone',?)").bind(Date.now()).run()
  const standalone=sha('standalone-capability');await app.db.prepare('INSERT INTO magic_signins VALUES(?,?,NULL,?,?,NULL)').bind(sha(standalone),'standalone','standalone@example.test',Date.now()+60000).run()
  assert.equal((await consume(standalone,{returnTo:'//evil.example'})).data.destination,'/projects/create','account-only sign-in defaults to creating a workspace')
 }finally{await app.close()}
})

test('magic sign-in refuses removed members, deleted workspaces, changed emails, foreign origins and missing configuration, rate-limits every address alike, and keeps an unknown mail outcome uncertain',async()=>{
 const mail=[],origin='https://app.example';let reject=false,hold
 const outbound=async(request,entry)=>{if(hold){const gate=hold;hold.entered();await gate.released;throw new Error('connection lost after submission')}return mailOutbound(mail,{reject:()=>reject})(request,entry)}
 const bindings={EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test',APP_ORIGIN:origin}
 const app=await startApp({bindings,outbound})
 try{
  let address=1;const ip=()=>({'CF-Connecting-IP':`198.51.100.${address++}`})
  const request=(email,headers=ip())=>app.call('/api/identity/magic-link',{body:{email},headers})
  const consume=token=>app.call('/api/identity/magic-link/consume',{body:{token},headers:ip()})
  const seedToken=async key=>{const ws=await app.seedWorkspace(key),token=sha('capability-'+key);await app.db.prepare('INSERT INTO magic_signins VALUES(?,?,?,?,?,NULL)').bind(sha(token),'owner-'+key,ws.projectId,'owner-'+key+'@example.test',Date.now()+60000).run();return {...ws,token}}
  const removed=await seedToken('removed'),deleted=await seedToken('deleted'),changed=await seedToken('changed')
  await app.db.prepare('DELETE FROM memberships WHERE user_id=?').bind('owner-removed').run()
  await app.db.prepare('INSERT INTO project_settings VALUES(?,?,?)').bind(deleted.projectId,JSON.stringify({deleted_at:1}),Date.now()).run()
  await app.db.prepare("UPDATE users SET email='new@example.test' WHERE id='owner-changed'").run()
  for(const item of [removed,deleted,changed])assert.equal((await consume(item.token)).status,400)
  assert.equal((await request('owner-deleted@example.test')).status,202);await new Promise(done=>setTimeout(done,200));assert.equal(mail.length,0,'a deleted workspace owner is not mailed')
  // An account without workspaces signs in without recovering revoked membership.
  assert.equal((await request('owner-removed@example.test')).status,202);await app.until(()=>mail.length===1)
  const signed=await consume(new URLSearchParams(new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get('token'));assert.equal(signed.status,200)
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:signed.headers.get('Set-Cookie').split(';')[0]}})).data.projectId,'')
  const sent=mail.length
  for(const APP_ORIGIN of ['https://evil.example/path','javascript:alert(1)','http://public.example','https://user:pass@app.example']){await app.configure({...bindings,APP_ORIGIN});assert.equal((await request('owner-removed@example.test')).status,503,String(APP_ORIGIN))}
  await app.configure({...bindings,EMAIL_API_KEY:undefined});assert.equal((await request('owner-removed@example.test')).status,503);await app.configure(bindings)
  assert.equal((await app.call('/api/identity/magic-link',{body:{email:'owner-removed@example.test'},headers:{...ip(),Origin:'https://evil.example'}})).status,403)
  assert.equal((await app.call('/api/identity/magic-link/consume',{body:{token:sha('not-used')},headers:{...ip(),Origin:'https://evil.example'}})).status,403)
  assert.equal((await request('malformed')).status,400);assert.equal(mail.length,sent)
  // A provider rejection discloses nothing and spends the unusable capability.
  await app.seedWorkspace('rejected');reject=true
  const known=await request('owner-rejected@example.test'),unknown=await request('unknown-rejected@example.test');assert.equal(known.status,202);assert.deepEqual(known.data,unknown.data)
  await app.until(async()=>(await app.first("SELECT consumed_at FROM magic_signins WHERE user_id='owner-rejected'"))?.consumed_at,{message:'rejected capability spent'});reject=false
  // Known and unknown addresses share identical atomic limits, and IPv6 clients share a /64 budget.
  await app.seedWorkspace('limited')
  for(const email of ['owner-limited@example.test','unknown-limited@example.test']){const responses=await Promise.all(Array.from({length:6},()=>request(email)));const statuses=responses.map(r=>r.status).sort(),limited=responses.filter(r=>r.status===429);assert.ok(limited.length>=1&&statuses.every(status=>status===202||status===429),email);assert.ok(Number(limited[0].headers.get('Retry-After'))>0)}
  const v6=[];for(let i=0;i<40;i++)v6.push((await request(`unknown-v6-${i}@example.test`,{'CF-Connecting-IP':`2001:db8:abcd:12::${i+1}`})).status)
  const admitted=v6.filter(status=>status===202).length;assert.ok(admitted>0&&admitted<40);assert.deepEqual(v6,[...Array(admitted).fill(202),...Array(40-admitted).fill(429)],'one /64 shares one budget')
  // Transport latency and an unknown outcome stay outside the neutral request.
  await app.seedWorkspace('deferred');let entered;const released=new Promise(done=>hold={entered:()=>entered(),released:null,release:done});hold.released=released;const started=new Promise(done=>entered=done)
  const response=await request('owner-deferred@example.test');assert.equal(response.status,202,'the request answers before the provider does')
  await started;hold.release();hold=undefined
  await app.until(async()=>(await app.first("SELECT state FROM email_deliveries WHERE recipient='owner-deferred@example.test'"))?.state==='uncertain',{message:'uncertain sign-in mail'})
  assert.ok((await app.first("SELECT consumed_at FROM magic_signins WHERE user_id='owner-deferred'")).consumed_at,'an uncertain capability is spent, never resent')
 }finally{await app.close()}
})

test('two-factor sign-in: TOTP with recovery codes, a role policy that forces enrolment and ends unproven sessions, refused and rate-limited answers, step-up for exports, owner reset and installation-key owner recovery, all audited',twoFactorJourney)
test('roles and the security log: a collaborator notes and follows but cannot reply, assign, erase or export; a restricted custom role cannot publish or export; a knowledge reader reads selected grant targets without writes and loses access on the next request; role changes step up; the log is append-only with retention and legal holds',rolesAuditJourney)

test('no-password step-up proves the account mailbox, never the held session; links expire, bind the account, consume once, and rate-limit atomically with audit',emailStepUpJourney)
