import {mobileAuthority} from '../mobile.mjs'
import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {challengeOf,consentPage,decide} from '../delegation/applications.mjs'

/**
 * ACCESS-001 (roles) and AUDIT-001 through the public doors: a collaborator adds notes
 * and follows but cannot reply, assign, erase or export; a restricted custom role
 * loses publication and export; role changes need a recent step-up; every mutating
 * door is classified; installing a connected application needs a step-up, and its grant
 * loses what a narrowed role loses; the security log refuses edits, honours retention and holds.
 */
export async function rolesAuditJourney(){
 await mobileAuthority()
 const app=await startApp({bindings:{RER_INSTALLATION_ID:'roles-installation',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
 try{
  assert.deepEqual((await app.call('/_test/unclassified-routes')).data,[],'every mutating door has a role rule')
  const call=(path,body,token,method)=>app.call(path,{body,token,method})
  const w=await app.seedWorkspace('roles'),P=`/api/management/projects/${w.projectId}`,C=`/api/dashboard/projects/${w.projectId}/conversations/conv-r`
  await app.db.batch([
   app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('ct-r',?,'Riley Customer','riley@example.com',1)").bind(w.projectId),
   app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('conv-r',?,'ct-r',1,'m-r',?,?)").bind(w.projectId,Date.now(),Date.now()),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash) VALUES('m-r',?,'conv-r','c-r','ct-r','contact','Where is my order?',1,2,'hash-r')").bind(w.projectId),
  ])
  // The owner invites a collaborator, who accepts with a password and signs in.
  const invited=await call(`${P}/agents`,{email:'collab@example.com',role:'collaborator'},w.tokens.owner);assert.equal(invited.status,201)
  const token=new URL(invited.data.data.invitationUrl).searchParams.get('token')
  assert.equal((await call('/api/identity/accept-token',{token,name:'Casey Collaborator',password:'collab-correct-horse-battery'})).status,200)
  const collaborator=(await call('/api/identity/login',{email:'collab@example.com',password:'collab-correct-horse-battery'})).data
  const bootstrap=(await call(`/api/management/bootstrap?projectId=${w.projectId}`,undefined,collaborator.token)).data
  assert.equal(bootstrap.projects[w.projectId].access.name,'Collaborator');assert.deepEqual(bootstrap.projects[w.projectId].access.permissions,['conversations.notes','conversations.follow'])
  assert.equal((await call(`${P}/agents`,undefined,w.tokens.owner)).data.data.find(row=>row.email==='collab@example.com').access_name,'Collaborator')

  // A collaborator views the ticket, adds a note, follows and reads; everything else is refused and audited.
  assert.equal((await call(C,undefined,collaborator.token)).status,200)
  assert.equal((await call(`${C}/notes`,{content:'Customer is on the beta plan'},collaborator.token)).status,201)
  const followed=await call(`${C}/follow`,{},collaborator.token);assert.equal(followed.status,200);assert.deepEqual(followed.data.data.followers.map(row=>row.name),['Casey Collaborator'])
  assert.equal((await call(`${C}/actions`,{action:'markAsRead',data:{ids:['m-r']}},collaborator.token)).status,200)
  const reply=await call('/api/conversations/conv-r/messages',{content:'Public reply',localId:'collab-1',expectedRevision:1,expectedLastMessageId:'m-r'},collaborator.token)
  assert.equal(reply.status,403);assert.equal(reply.data.code,'permission_denied');assert.equal(reply.data.permission,'conversations.reply')
  for(const [path,body,method] of [[C,{assigned_to:collaborator.actor.id},'PUT'],[`${C}/tags`,{tagId:'vip'},'POST'],[`${P}/contacts/ct-r/erase`,{},'POST'],[`/api/knowledge/${w.projectId}/articles`,{title:'x',content:'y'},'POST']]){
   const refused=await call(path,body,collaborator.token,method);assert.equal(refused.status,403,path);assert.equal(refused.data.code,'permission_denied',path)
  }
  assert.equal((await call(`${P}/audit/export`,undefined,collaborator.token)).status,403)
  assert.equal((await app.first("SELECT count(*) n FROM messages WHERE conversation_id='conv-r'")).n,1,'no public reply was admitted')
  assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE action='permission.denied' AND actor_id=?",collaborator.actor.id)).n>=5)
  assert.equal((await call(`${P}/agents`,undefined,w.tokens.owner)).data.data.some(row=>row.id===collaborator.actor.id&&row.role==='operator'),true,'the collaborator joins on the agent base')

  // While still an Agent, the agent connects an application that may edit and publish one article.
  await app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES('art-r',?,'returns','Returns','Original','','draft',1)").bind(w.projectId).run()
  const browser=(path,{cookie,body}={})=>app.request(path,{method:body?'POST':'GET',raw:true,headers:{Cookie:'h2h_session='+cookie,...(body?{'Content-Type':'application/x-www-form-urlencoded',Origin:app.origin}:{})},body:body&&new URLSearchParams(body).toString()})
  const register={account_id:w.projectId,id:'slate',origin:'https://slate.test',redirect_uri:'https://slate.test/callback'},article=`projects/${w.projectId}/articles/art-r`,verifier='v'.repeat(64)
  assert.equal((await browser('/delegation/settings/clients',{cookie:w.tokens.owner,body:register})).status,303)
  const consent=new URLSearchParams({client_id:'slate',redirect_uri:register.redirect_uri,response_type:'code',state:'s',code_challenge:await challengeOf(verifier),code_challenge_method:'S256',account_id:w.projectId,scope:'knowledge.article.read knowledge.article.update knowledge.article.publish',targets:JSON.stringify([article])})
  const approved=await decide(browser,await consentPage(browser,consent,w.tokens.operator),'approve',w.tokens.operator);assert.equal(approved.status,303)
  const exchanged=await app.request('/api/delegation/v1/token',{method:'POST',raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'slate',redirect_uri:register.redirect_uri,code:new URL(approved.headers.get('location')).searchParams.get('code'),code_verifier:verifier}).toString()})
  const grant=(await exchanged.json()).access_token,delegated=(path,body)=>app.request('/api/delegation/v1'+path,{token:grant,method:body?'POST':'GET',raw:true,headers:body?{'Content-Type':'application/json'}:{},body:body&&JSON.stringify(body)})
  // Each edit names the audience it expects; one the grant may no longer read for is the one seen while it could.
  const audience=async status=>(await (await delegated('/audience?'+new URLSearchParams({target:article,operation:'happytohelp.article.update',intendedStatus:status}))).json()).audienceRevision
  const seen={draft:await audience('draft'),published:await audience('published')}
  const edit=async(key,status)=>delegated('/effects',{operationKey:key,operation:'happytohelp.article.update',target:article,expectedRevision:(await (await delegated('/evidence?target='+article)).json()).revision,expectedAudienceRevision:await audience(status)??seen[status],content:{title:'Returns',content:'Edited '+key,summary:'',status}})
  assert.equal((await edit('agent-draft','draft')).status,200,'the Agent edits through the grant')

  // A custom role over Agent without publishing or exporting: the agent keeps replying but cannot publish.
  const created=await call(`${P}/roles`,{name:'Support, no publishing',base:'operator',permissions:['conversations.reply','conversations.notes','conversations.follow','conversations.manage','contacts.manage','knowledge.edit','reports.view','members.manage']},w.tokens.owner)
  assert.equal(created.status,201);assert.ok(!created.data.data.permissions.includes('members.manage'),'a custom role never exceeds its base')
  for(const [email,role] of [['pending-admin@example.com','admin'],['pending-agent@example.com','operator']])assert.equal((await call(`${P}/agents`,{email,role},w.tokens.owner)).status,201)
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE token_hash IN (SELECT token_hash FROM sessions WHERE actor_id=?)').bind(20*60*1000,w.users.owner).run()
  const stale=await call(`${P}/agents/${w.users.operator}`,{role:created.data.data.id},w.tokens.owner,'PUT');assert.equal(stale.status,403);assert.equal(stale.data.code,'step_up_required')
  // Copying or resending an admin invitation issues the same role grant: it needs a recent step-up, an admin may do
  // neither, and agent invitations are unchanged. The identity door that issued invitations without these rules is gone.
  const I=`${P}/invitations/`
  for(const door of ['link','resend']){const reissued=await call(`${I}pending-admin%40example.com/${door}`,{},w.tokens.owner);assert.equal(reissued.status,403,door);assert.equal(reissued.data.code,'step_up_required',door)}
  const byAdmin=await call(`${I}pending-admin%40example.com/link`,{},w.tokens.admin);assert.equal(byAdmin.status,403);assert.notEqual(byAdmin.data.code,'step_up_required','an admin never manages an admin invitation')
  assert.equal((await call(`${I}pending-agent%40example.com/link`,{},w.tokens.owner)).status,201,'an agent invitation needs no step-up')
  for(const token of [w.tokens.owner,w.tokens.admin])assert.equal((await call('/api/identity/invitations',{email:'evil-admin@example.com',role:'admin'},token)).status,404)
  assert.equal((await app.first("SELECT count(*) n FROM identity_tokens WHERE email='evil-admin@example.com'")).n,0)
  // The sign-in email is where password resets go: changing it needs a recent step-up, saving the profile unchanged does not.
  const profilePath=`/api/management/profile?projectId=${w.projectId}`,profile=(await call(profilePath,undefined,w.tokens.owner)).data.data
  const moved=await call(profilePath,{...profile,email:'owner-elsewhere@example.com'},w.tokens.owner,'PUT');assert.equal(moved.status,403);assert.equal(moved.data.code,'step_up_required')
  assert.equal((await call(profilePath,profile,w.tokens.owner,'PUT')).status,200)
  // A first password is a credential install too: the owner has none (as no teammate moved in from legacy has), and an aged proof cannot set one.
  const firstPassword=await call('/api/identity/password',{password:'synthetic-held-session-chosen-password'},w.tokens.owner);assert.equal(firstPassword.status,403);assert.equal(firstPassword.data.code,'step_up_required')
  assert.equal((await app.first('SELECT count(*) n FROM credentials WHERE user_id=?',w.users.owner)).n,0);assert.equal((await app.first('SELECT count(*) n FROM sessions WHERE actor_id=? AND revoked_at IS NOT NULL',w.users.owner)).n,0)
  // Installing a connected application with an aged proof is refused too: registering one, and approving its access.
  const ownerConsent=await consentPage(browser,consent,w.tokens.owner)
  for(const refused of [await browser('/delegation/settings/clients',{cookie:w.tokens.owner,body:{...register,id:'docs'}}),await decide(browser,ownerConsent,'approve',w.tokens.owner)]){assert.equal(refused.status,403);assert.equal((await refused.json()).code,'step_up_required')}
  assert.equal((await app.first("SELECT count(*) n FROM edition_clients WHERE id='docs'")).n,0);assert.equal((await app.first('SELECT count(*) n FROM edition_grants WHERE principal_id=?',w.users.owner)).n,0)
  await app.db.prepare("INSERT INTO credentials(user_id,password_hash,updated_at) VALUES(?,?,1)").bind(w.users.owner,(await app.first('SELECT password_hash FROM credentials WHERE user_id=?',collaborator.actor.id)).password_hash).run()
  assert.equal((await call('/api/identity/step-up',{password:'collab-correct-horse-battery'},w.tokens.owner)).status,200,'an account without a factor steps up with its password')
  const relinked=await call(`${I}pending-admin%40example.com/link`,{},w.tokens.owner);assert.equal(relinked.status,201);assert.equal(relinked.data.data.role,'admin')
  assert.deepEqual((await app.sql("SELECT detail_json FROM audit_events WHERE action='member.invitation_reissued' ORDER BY at")).map(row=>JSON.parse(row.detail_json).role),['operator','admin'])
  assert.equal((await decide(browser,ownerConsent,'approve',w.tokens.owner)).status,303,'stepped up, the same consent form approves')
  assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:created.data.data.id},w.tokens.owner,'PUT')).status,200)
  const publish=await call(`/api/knowledge/${w.projectId}/articles`,{title:'Returns',content:'How returns work'},w.tokens.operator);assert.equal(publish.status,403);assert.equal(publish.data.permission,'knowledge.publish')
  // The grant the agent approved narrows with the role at once: no publishing through it, editing a draft still allowed.
  const viaGrant=await edit('narrowed-publish','published');assert.equal(viaGrant.status,403);assert.equal((await viaGrant.json()).error.code,'SCOPE_DENIED')
  assert.equal((await edit('narrowed-draft','draft')).status,200,'the role keeps knowledge.edit')
  assert.equal((await call(`/api/dashboard/projects/${w.projectId}/reports?period=30&format=summary.csv`,undefined,w.tokens.operator)).data.permission,'data.export')
  assert.equal((await call('/api/conversations/conv-r/messages',{content:'We are on it',localId:'agent-1',expectedRevision:1,expectedLastMessageId:'m-r',authoring:{kind:'human'}},w.tokens.operator)).status,200,'the custom role still replies')
  const changed=await app.first("SELECT detail_json FROM audit_events WHERE action='member.role_changed' AND target_id=?",w.users.operator)
  assert.deepEqual(JSON.parse(changed.detail_json),{from:'operator',to:created.data.data.id,fromName:'Agent',toName:'Support, no publishing'})
  assert.equal((await call(`${P}/roles/${created.data.data.id}`,undefined,w.tokens.owner,'DELETE')).status,409,'a role in use stays')
  // As a Collaborator the same grant edits nothing; each refusal is in the security log.
  assert.equal((await call(`${P}/agents/${w.users.operator}`,{role:'collaborator'},w.tokens.owner,'PUT')).status,200)
  for(const status of ['draft','published'])assert.equal((await edit('collaborator-'+status,status)).status,403,status)
  assert.deepEqual(await app.first("SELECT status,content FROM knowledge_articles WHERE id='art-r'"),{status:'draft',content:'Edited narrowed-draft'})
  assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE action='permission.denied' AND actor_id=? AND target_type='grant'",w.users.operator)).n>=2)

  // The security log is append-only, kept for its retention except under a legal hold.
  await assert.rejects(app.db.prepare('UPDATE audit_events SET outcome=?').bind('failed').run(),/audit_append_only/)
  await assert.rejects(app.db.prepare('DELETE FROM audit_events').run(),/audit_retained/)
  const day=86400000,now=Date.now()
  await app.db.batch([400,380,200].map((age,i)=>app.db.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source) VALUES(?,?,?,'auth','sign_in.succeeded','succeeded','user',?,'dashboard')").bind('old-'+i,w.projectId,now-age*day,w.users.admin)))
  assert.equal((await call(`${P}/audit/retention`,{days:30},w.tokens.owner,'PUT')).status,400)
  assert.equal((await call(`${P}/audit/retention`,{days:365},w.tokens.admin,'PUT')).status,403,'only an owner sets retention')
  assert.equal((await call(`${P}/audit/retention`,{days:365},w.tokens.owner,'PUT')).status,200)
  const hold=await call(`${P}/audit/holds`,{name:'Chargeback dispute',reason:'Evidence for a card dispute',starts_at:new Date(now-390*day).toISOString(),ends_at:new Date(now-370*day).toISOString()},w.tokens.owner);assert.equal(hold.status,201)
  await app.scheduled()
  assert.deepEqual((await app.sql("SELECT id FROM audit_events WHERE id LIKE 'old-%' ORDER BY id")).map(row=>row.id),['old-1','old-2'],'the expired entry outside the hold is removed, the held one stays')
  const purged=JSON.parse((await app.first("SELECT detail_json FROM audit_events WHERE action='audit.purged'")).detail_json);assert.deepEqual(purged,{removed:1,keptUnderHold:1,olderThanDays:365})
  const page=(await call(`${P}/audit?category=auth`,undefined,w.tokens.admin)).data
  assert.ok(page.data.find(row=>row.id==='old-1').held);assert.equal(page.holds.length,1);assert.equal(page.retentionDays,365)
  assert.ok(page.data.every(row=>row.category==='auth'))
  assert.equal((await call(`${P}/audit/holds/${hold.data.data.id}/release`,{},w.tokens.owner)).status,200)
  assert.equal((await call(`${P}/audit`,undefined,w.tokens.operator)).status,403,'agents do not read the security log')

  // A side-panel plugin receives the open conversation: adding one or pointing it elsewhere on an aged proof is refused, like a webhook.
  await app.db.prepare("INSERT INTO plugins(id,project_id,name,url,created_at) VALUES('plugin-r',?,'Order lookup','https://plugins.example/lookup.html',1)").bind(w.projectId).run()
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE user_id=?').bind(20*60*1000,w.users.admin).run()
  const plugin={name:'Lookup',url:'https://plugins.example/elsewhere.html'}
  for(const [path,method] of [[`${P}/plugins`,'POST'],[`${P}/plugins/plugin-r`,'PUT']]){const refused=await call(path,plugin,w.tokens.admin,method);assert.equal(refused.status,403,method);assert.equal(refused.data.code,'step_up_required',method)}
  assert.deepEqual(await app.sql('SELECT id,url FROM plugins'),[{id:'plugin-r',url:'https://plugins.example/lookup.html'}])
  assert.equal((await call(`${P}/plugins/plugin-r`,{name:'Order lookup, renamed'},w.tokens.admin,'PUT')).status,200,'renaming a plugin needs no step-up')
  // An email link proves its account for 15 minutes: the admin, who has no password, signs in by link, then adds the plugin and sets a first password.
  const link=sha('roles-admin-link');await app.db.prepare('INSERT INTO magic_signins VALUES(?,?,?,?,?,NULL)').bind(sha(link),w.users.admin,w.projectId,'admin-roles@example.test',Date.now()+60000).run()
  const linked=await app.call('/api/identity/magic-link/consume',{body:{token:link}});assert.equal(linked.status,200)
  const session=linked.headers.get('Set-Cookie').match(/h2h_session=([^;]+)/)[1]
  assert.equal((await call(`${P}/plugins`,plugin,session)).status,201)
  assert.equal((await call('/api/identity/password',{password:'synthetic-admin-first-password-2026'},session)).status,200)
  assert.equal((await call('/api/identity/login',{email:'admin-roles@example.test',password:'synthetic-admin-first-password-2026'})).status,200)
 }finally{await app.close()}
}
