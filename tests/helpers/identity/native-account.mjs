import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {totp,encryptionKey} from './two-factor.mjs'

// One installation, its owner, invited teammate and signed visitor. Mail is the only fake.
export async function nativeAccountJourney(){
 const mail=[],setupToken='synthetic-happytohelp-owner-claim',origin='https://app.example'
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,APP_ORIGIN:origin,INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge',EMAIL_FROM:'support@example.test',REGISTRATION_ENABLED:'true'},outbound:async request=>{
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
  assert.equal((await identity('/setup')).data.available,false)
  assert.equal((await identity('/bootstrap',entry)).status,409)
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
  assert.equal((await identity('/accept-token',{token:inviteToken,name:'Teammate',password:'synthetic-teammate-password'})).status,200)
  assert.equal((await identity('/accept-token',{token:inviteToken,name:'Teammate',password:'synthetic-teammate-password'})).status,400)
  assert.equal((await identity('/link-status',{kind:'invitation',token:new URL(invite.data.data.invitationUrl).searchParams.get('token')})).data.state,'used')
  const invited=(await identity('/login',{email:'new@example.test',password:'synthetic-teammate-password'})).data
  assert.equal(invited.actor.projectId,project)
  const revoke=await manage(path,session.token,{email:'withdrawn@example.test'})
  assert.equal((await manage(`/projects/${project}/invitations/withdrawn%40example.test`,session.token,undefined,'DELETE')).status,200)
  assert.equal((await identity('/accept-token',{token:new URL(revoke.data.data.invitationUrl).searchParams.get('token'),password:'synthetic-withdrawn-password'})).status,400)
  const factor=(await identity('/two-factor/totp',{},session.token)).data
  assert.equal((await identity('/two-factor/totp/confirm',{factorId:factor.factorId,code:totp(factor.secret)},session.token)).status,201)
  const reset=(await identity('/password-reset',{userId:invited.actor.id},session.token)).data
  assert.equal((await identity('/accept-token',{token:reset.token,password:'synthetic-teammate-reset-password'})).status,200)
  assert.equal((await identity('/session',undefined,invited.token)).status,401)
  assert.equal((await identity('/login',{email:'new@example.test',password:'synthetic-teammate-reset-password'})).status,200)

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
