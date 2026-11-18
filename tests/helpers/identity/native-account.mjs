import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {totp,encryptionKey} from './two-factor.mjs'

// One installation, its owner, invited teammate and signed visitor. Mail is the only fake.
export async function nativeAccountJourney(){
 const mail=[],setupToken='synthetic-happytohelp-owner-claim',origin='https://app.example'
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,APP_ORIGIN:origin,WORKSPACE_NAME:'Cedar Works',OWNER_NAME:'Mara Chen',INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge',EMAIL_FROM:'support@example.test',REGISTRATION_ENABLED:'true'},outbound:async request=>{
  assert.equal(new URL(request.url).host,'api.resend.com');mail.push(await request.json());return Response.json({id:'synthetic-mail-'+mail.length})
 }})
 try{
  const identity=(path,body,token)=>app.call('/api/identity'+path,{body,token})
  const manage=(path,token,body,method)=>app.call('/api/management'+path,{token,body,method})
  const entry={password:'synthetic-owner-first-password',email:'owner@example.test',allowedOrigin:'https://widget.example',setupToken}
  assert.equal((await identity('/session')).status,401)
  assert.equal((await identity('/bootstrap',{...entry,setupToken:'wrong'})).status,403)
  assert.equal((await app.call('/api/identity/bootstrap',{body:entry,headers:{Origin:'https://foreign.example'}})).status,403)
  const claims=await Promise.all([identity('/bootstrap',entry),identity('/bootstrap',entry)])
  assert.deepEqual(claims.map(r=>r.status).sort(),[201,409])
  const owner=claims.find(r=>r.status===201).data,project=owner.projectId
  const initial=(await manage('/bootstrap',owner.token)).data
  assert.equal(initial.project.name,app.bindings.WORKSPACE_NAME)
  assert.equal(initial.currentAgent.name,app.bindings.OWNER_NAME)
  assert.equal((await identity('/setup')).data.available,false)
  assert.equal((await identity('/bootstrap',entry)).status,409)
  assert.equal((await manage('/profile',owner.token,{name:'Mara C.'},'PUT')).status,200)
  assert.equal((await manage(`/projects/${project}/settings`,owner.token,{name:'Cedar Care'},'PUT')).status,200)
  await app.configure({WORKSPACE_NAME:'Replacement installation name',OWNER_NAME:'Replacement owner name'})
  assert.equal((await identity('/bootstrap',{...entry,name:'Unwanted workspace',ownerName:'Unwanted owner'})).status,409)
  const retained=(await manage('/bootstrap',owner.token)).data
  assert.equal(retained.project.name,'Cedar Care','repeated setup and new installer defaults preserve the edited workspace')
  assert.equal(retained.currentAgent.name,'Mara C.','repeated setup and new installer defaults preserve the edited owner')
  assert.equal((await identity('/password',{currentPassword:entry.password,password:'synthetic-owner-chosen-password'},owner.token)).status,200)
  assert.equal((await identity('/session',undefined,owner.token)).status,401)
  assert.equal((await identity('/login',{email:entry.email,password:entry.password})).status,401)
  const login=await identity('/login',{email:entry.email,password:'synthetic-owner-chosen-password'})
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/)
  const session=login.data,cookie=login.headers.get('set-cookie').split(';')[0]
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:cookie},status:200})).data.id,owner.userId)
  const second=(await manage('/projects',session.token,{name:'Second workspace',allowedOrigin:entry.allowedOrigin})).data
  const switched=(await identity('/switch-project',{projectId:second.id},session.token)).data
  assert.equal(switched.actor.projectId,second.id)
  const other=await app.seedWorkspace('foreign')
  assert.equal((await identity('/switch-project',{projectId:other.projectId},session.token)).status,403)
  await manage('/projects/'+second.id,session.token,undefined,'DELETE')
  assert.equal((await identity('/session',undefined,switched.token)).status,401)

  // Manage the invitation, then accept exactly once with the teammate's own password.
  const path=`/projects/${project}/agents`,invite=await manage(path,session.token,{email:'new@example.test'})
  assert.equal(invite.status,201)
  const pending=(await manage(path,session.token)).data.data.find(row=>row.email==='new@example.test')
  assert.equal(Boolean(pending.pending),true)
  const invitations=`/projects/${project}/invitations/new%40example.test`
  assert.equal((await manage(invitations+'/link',other.tokens.owner,{},'POST')).status,403)
  const copied=await manage(invitations+'/link',session.token,{},'POST');assert.equal(copied.status,201)
  const mailBefore=mail.length
  const resent=await manage(invitations+'/resend',session.token,{},'POST');assert.equal(resent.status,201)
  assert.equal(mail.length,mailBefore+1)
  const inviteToken=new URL(copied.data.data.invitationUrl).searchParams.get('token')
  const joined=await identity('/accept-token',{token:inviteToken,name:'Teammate',password:'synthetic-teammate-password'})
  assert.equal(joined.status,200)
  assert.match(joined.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=86400/)
  const joinedCookie=joined.headers.get('set-cookie').split(';')[0]
  const teammate=(await app.call('/api/identity/session',{headers:{Cookie:joinedCookie},status:200})).data
  assert.deepEqual([teammate.id,teammate.projectId,teammate.role],[joined.data.actor.id,project,'operator'])
  assert.equal((await app.call('/api/conversations',{headers:{Cookie:joinedCookie}})).status,200,'the invitation session opens the inbox without a second sign-in')
  const refuse=async token=>{
   const sessionsBefore=await app.sql('SELECT token_hash FROM sessions ORDER BY token_hash')
   const result=await identity('/accept-token',{token,name:'Refused teammate',password:'synthetic-teammate-password'})
   assert.equal(result.status,400);assert.equal(result.headers.get('set-cookie'),null)
   assert.equal(result.data.token,undefined)
   assert.deepEqual(await app.sql('SELECT token_hash FROM sessions ORDER BY token_hash'),sessionsBefore)
   assert.equal((await identity('/session')).status,401)
  }
  await refuse(inviteToken)
  assert.equal((await identity('/link-status',{kind:'invitation',token:new URL(invite.data.data.invitationUrl).searchParams.get('token')})).data.state,'used')
  const invited=(await identity('/login',{email:'new@example.test',password:'synthetic-teammate-password'})).data
  assert.equal(invited.actor.projectId,project)
  const revoke=await manage(path,session.token,{email:'withdrawn@example.test'})
  assert.equal((await manage(`/projects/${project}/invitations/withdrawn%40example.test`,session.token,undefined,'DELETE')).status,200)
  await refuse(new URL(revoke.data.data.invitationUrl).searchParams.get('token'))
  const expired=await manage(path,session.token,{email:'expired@example.test'})
  const expiredToken=new URL(expired.data.data.invitationUrl).searchParams.get('token')
  await app.db.prepare("UPDATE identity_tokens SET expires_at=? WHERE email='expired@example.test'").bind(Date.now()-1).run()
  await refuse(expiredToken)
  assert.equal(await app.first("SELECT id FROM users WHERE email IN ('withdrawn@example.test','expired@example.test')"),null)
  // A required factor is enforced on this sign-in too, including a collaborator's narrowed role.
  await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.two_factor_roles',json('[\"collaborator\"]')) WHERE project_id=?").bind(project).run()
  const protectedInvite=await manage(path,session.token,{email:'protected@example.test',role:'collaborator'})
  assert.equal(protectedInvite.status,201)
  const protectedJoin=await identity('/accept-token',{token:new URL(protectedInvite.data.data.invitationUrl).searchParams.get('token'),name:'Protected teammate',password:'synthetic-protected-password'})
  assert.equal(protectedJoin.status,200);assert.equal(protectedJoin.data.twoFactor,'enrol')
  assert.equal((await app.call('/api/conversations',{token:protectedJoin.data.token})).status,401)
  assert.equal((await identity('/session',undefined,protectedJoin.data.token)).data.twoFactor,'enrol')
  assert.equal((await app.first('SELECT role_key FROM member_roles WHERE user_id=?',protectedJoin.data.actor.id)).role_key,'collaborator')
  await app.db.prepare("UPDATE project_settings SET settings_json=json_remove(settings_json,'$.two_factor_roles') WHERE project_id=?").bind(project).run()
  const factor=(await identity('/two-factor/totp',{},session.token)).data
  assert.equal((await identity('/two-factor/totp/confirm',{factorId:factor.factorId,code:totp(factor.secret)},session.token)).status,201)
  const reset=(await identity('/password-reset',{userId:invited.actor.id},session.token)).data
  assert.equal((await identity('/accept-token',{token:reset.token,password:'synthetic-teammate-reset-password'})).status,200)
  assert.equal((await identity('/session',undefined,invited.token)).status,401)
  assert.equal((await identity('/login',{email:'new@example.test',password:'synthetic-teammate-reset-password'})).status,200)

  // A password belongs to the account: once the teammate also works in another workspace, this owner cannot reset it
  // until that workspace's owner removes them there.
  await app.db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(other.projectId,invited.actor.id,'operator').run()
  assert.equal((await identity('/password-reset',{userId:invited.actor.id},session.token)).status,409)
  assert.equal((await manage(`/projects/${other.projectId}/agents/${invited.actor.id}`,other.tokens.owner,undefined,'DELETE')).status,200)
  const reissued=await identity('/password-reset',{userId:invited.actor.id},session.token);assert.equal(reissued.status,201)
  assert.equal((await identity('/accept-token',{token:reissued.data.token,password:'synthetic-teammate-second-password'})).status,200)

  // The same workspace admits signed customer identity without exposing its secret.
  const config=(await identity('/projects/'+project,undefined,session.token)).data
  assert.equal('verification_secret' in config,false)
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',project)).verification_secret
  const signature=createHmac('sha256',secret).update('synthetic-customer').digest('hex')
  const widget=body=>app.call('/api/identity/widget/session',{body:{widgetKey:config.widget_key,...body},headers:{Origin:entry.allowedOrigin}})
  const visitor=(await widget({identifier:'synthetic-customer',contact_hash:signature})).data
  assert.equal((await widget({identifier:'synthetic-customer',contact_hash:signature})).data.contactId,visitor.contactId)
  assert.notEqual((await widget({identifier:'synthetic-customer'})).data.contactId,visitor.contactId)
  assert.equal((await widget({identifier:'synthetic-customer',contact_hash:'0'.repeat(64)})).status,403)
  await app.db.prepare("UPDATE contacts SET metadata_json=? WHERE id=?").bind(JSON.stringify({is_blocked:true}),visitor.contactId).run()
  assert.equal((await widget({identifier:'synthetic-customer',contact_hash:signature})).status,403)
  assert.equal((await identity('/session',undefined,visitor.token)).status,401)

  // Recovery and email sign-in are neutral, scanner-safe and single-use.
  const known=await identity('/forgot-password',{email:'new@example.test'}),unknown=await identity('/forgot-password',{email:'unknown@example.test'})
  assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data)
  const recovery=mail.filter(message=>message.to.includes('new@example.test')).at(-1)
  const recoveryToken=new URL(recovery.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')
  assert.equal((await identity('/link-status',{kind:'reset',token:recoveryToken})).data.state,'valid')
  assert.equal((await identity('/accept-token',{token:recoveryToken,password:'synthetic-recovered-password'})).status,200)
  assert.equal((await identity('/accept-token',{token:recoveryToken,password:'synthetic-recovered-password'})).status,400)
  const recovered=(await identity('/login',{email:'new@example.test',password:'synthetic-recovered-password'})).data
  assert.equal(recovered.actor.projectId,project)
  const requested=await identity('/magic-link',{email:'new@example.test'}),neutral=await identity('/magic-link',{email:'unknown@example.test'})
  assert.equal(requested.status,202);assert.deepEqual(requested.data,neutral.data)
  await app.until(()=>mail.some(message=>message.to.includes('new@example.test')&&message.text.includes('#token=')))
  const magic=mail.filter(message=>message.to.includes('new@example.test')&&message.text.includes('#token=')).at(-1)
  const magicToken=new URLSearchParams(new URL(magic.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('token')
  assert.equal((await app.call('/api/identity/magic-link/consume?token='+magicToken)).status,404)
  const entered=await identity('/magic-link/consume',{token:magicToken,returnTo:'https://foreign.example'})
  assert.equal(entered.status,200);assert.equal(entered.data.destination,'/conversations')
  assert.equal((await identity('/magic-link/consume',{token:magicToken})).status,400)
  const magicSession=entered.headers.get('set-cookie').split(';')[0]
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:magicSession}})).data.projectId,project)
  await manage('/projects/'+project,session.token,undefined,'DELETE')
  assert.equal((await identity('/session',undefined,recovered.token)).status,401)
  const removed=(await identity('/login',{email:'new@example.test',password:'synthetic-recovered-password'})).data
  assert.equal(removed.accountOnly,true)
  const recreated=(await manage('/projects',removed.token,{name:'Recreated workspace',allowedOrigin:entry.allowedOrigin})).data
  assert.equal((await identity('/switch-project',{projectId:recreated.id},removed.token)).status,200)
  assert.equal((await identity('/setup')).data.available,false)
 }finally{await app.close()}
}
