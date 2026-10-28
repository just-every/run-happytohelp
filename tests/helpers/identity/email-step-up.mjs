import assert from 'node:assert/strict'
import {pbkdf2Sync} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'

/** No-password accounts prove their mailbox; a held session can request mail but gains no authority. */
export async function emailStepUpJourney(){
 const mail=[],app=await startApp({bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge-key',EMAIL_FROM:'support@example.test',OWNER_EMAIL:'owner-mailbox@example.test',H2H_SETUP_TOKEN:'synthetic-email-owner-claim'},outbound:async(request)=>{
  assert.equal(new URL(request.url).host,'api.resend.com');const message=await request.json();if(message.subject==='Confirm your HappyToHelp sign-in')mail.push(message);return Response.json({id:'synthetic-mail-'+mail.length})
 }})
 try{
  const claimed=await app.request('/auth/bootstrap',{body:{token:'synthetic-email-owner-claim'},headers:{origin:app.origin}});assert.equal(claimed.status,303)
  const owner=claimed.headers.get('set-cookie').match(/h2h_session=([^;]+)/)[1],actor=(await app.call('/api/identity/session',{token:owner})).data,w={projectId:actor.projectId,users:{owner:actor.id}},exportPath=`/api/dashboard/projects/${w.projectId}/reports?format=conversations.csv`,password='synthetic-mailbox-first-password'
  const call=(path,body,token=owner)=>app.call(path,{body,token})
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE user_id=?').bind(20*60*1000,w.users.owner).run()
  const blocked=await call(exportPath);assert.equal(blocked.status,403);assert.equal(blocked.data.code,'step_up_required');assert.deepEqual(blocked.data.methods,['email_link']);assert.equal(blocked.data.accountId,w.users.owner)
  assert.equal((await call('/api/management/profile')).data.data.has_password,0)
  assert.equal((await call('/api/identity/password',{password})).status,403)
  const request=await call('/api/identity/step-up/email',{email:'attacker@example.test',returnTo:`/projects/${w.projectId}/reports`});assert.equal(request.status,202);assert.deepEqual(request.data,{accepted:true})
  assert.deepEqual(mail[0].to,['owner-mailbox@example.test'],'the recipient comes from the account, never the request')
  assert.equal((await call(exportPath)).status,403,'requesting a link supplies no proof')
  assert.equal((await call('/api/identity/password',{password})).status,403,'a held session still cannot install its own password')
  assert.equal((await call('/api/identity/step-up',{password})).status,403,'no password can be guessed into existence')
  assert.equal((await app.first('SELECT count(*) n FROM credentials WHERE user_id=?',w.users.owner)).n,0)
  const url=new URL(mail[0].text.match(/https:\/\/\S+/)[0]),token=new URLSearchParams(url.hash.slice(1)).get('token')
  const stored=await app.first('SELECT * FROM magic_signins WHERE token_hash=?',sha(token));assert.equal(stored.user_id,w.users.owner);assert.equal(stored.email,'owner-mailbox@example.test');assert.ok(stored.expires_at>Date.now())
  const consume=await call('/api/identity/magic-link/consume',{token});assert.equal(consume.status,200)
  const fresh=consume.headers.get('set-cookie').match(/h2h_session=([^;]+)/)[1]
  assert.equal((await call(exportPath,undefined,fresh)).status,200)
  assert.equal((await call(exportPath)).status,403,'mailbox proof refreshes only the fresh sign-in session')
  assert.equal((await call('/api/identity/magic-link/consume',{token})).status,400,'the link works once')
  // Expired or re-bound account email links never grant proof.
  for(const [key,email,expires] of [['expired','owner-mailbox@example.test',Date.now()-1],['rebound','other@example.test',Date.now()+60000]]){
   const value=sha(key);await app.db.prepare('INSERT INTO magic_signins VALUES(?,?,?,?,?,NULL)').bind(sha(value),w.users.owner,w.projectId,email,expires).run()
   assert.equal((await call('/api/identity/magic-link/consume',{token:value})).status,400,key)
  }
  const burst=await Promise.all(Array.from({length:12},()=>call('/api/identity/step-up/email',{})))
  const accepted=burst.filter(r=>r.status===202).length,refused=burst.filter(r=>r.status===429).length
  assert.ok(accepted>0&&refused>0);assert.equal(accepted+refused,burst.length)
  assert.equal(mail.length,1+accepted)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='step_up.email_link_requested'")).n,1+accepted)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='step_up.email_link_refused' AND outcome='refused'")).n,refused)
  // Existing email claims and externally chosen passwords retain their credential on upgrade.
  // Mailbox proof, rather than guessing how that credential originated, authorizes its replacement.
  const salt='synthetic-unknown-claim',unknown=salt+':'+pbkdf2Sync('synthetic-old-unknown-password',salt,100000,32,'sha256').toString('hex')
  await app.db.prepare('INSERT INTO credentials VALUES(?,?,?)').bind(w.users.owner,unknown,Date.now()).run()
  assert.equal((await call('/api/management/profile',undefined,owner)).data.data.mailbox_confirmed,false)
  assert.equal((await call('/api/identity/password',{password},owner)).status,403,'the held session cannot replace an unknown existing password')
  const needsMailbox=await call('/api/identity/password',{password,mailboxReset:true},owner);assert.equal(needsMailbox.status,403);assert.equal(needsMailbox.data.code,'step_up_required');assert.deepEqual(needsMailbox.data.methods,['email_link'])
  const profile=(await call('/api/management/profile',undefined,fresh)).data.data;assert.equal(profile.has_password,1);assert.equal(profile.mailbox_confirmed,true)
  assert.equal((await call('/api/identity/password',{password},fresh)).status,200,'fresh mailbox proof authorizes replacing an unknown password')
  assert.equal((await call('/api/identity/session',undefined,owner)).status,401,'the password change revokes the held session')
  const deliberate=await call('/api/identity/login',{email:'owner-mailbox@example.test',password});assert.equal(deliberate.status,200)
  const signedIn=deliberate.data.token
  assert.equal((await call('/api/management/profile',undefined,signedIn)).data.data.mailbox_confirmed,false)
  assert.equal((await call('/api/identity/password',{password:'synthetic-next-owner-password'},signedIn)).status,403,'a fresh ordinary sign-in cannot omit the current password')
  assert.equal((await call('/api/identity/password',{password:'synthetic-next-owner-password',mailboxReset:true},signedIn)).status,403,'even a recent password proof cannot claim to be mailbox proof')
  await app.db.prepare('UPDATE session_factors SET verified_at=verified_at-? WHERE token_hash=?').bind(20*60*1000,sha(signedIn)).run()
  assert.deepEqual((await call(exportPath,undefined,signedIn)).data.methods,['password','email_link'],'existing chosen passwords retain the password path beside email')
  assert.equal((await call('/api/identity/step-up',{password},signedIn)).status,200,'a deliberately set password still steps up normally')
 }finally{await app.close()}
}
