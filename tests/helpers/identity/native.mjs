import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {totp,encryptionKey} from './two-factor.mjs'

// One owner and teammate carry their native credentials through setup, recovery,
// invitations, workspace switching and retirement. Only delivery is a network fake.
export async function nativeIdentityJourney(){
 const mail=[],origin='https://support.example.test',setupToken='synthetic-native-owner-claim'
 let uncertain=false
 const app=await startApp({origin,captureQueue:true,bindings:{APP_ORIGIN:origin,H2H_SETUP_TOKEN:setupToken,RER_INSTALLATION_ID:'synthetic-native-install',REGISTRATION_ENABLED:'true',INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-native-mail',EMAIL_FROM:'support@example.test'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.resend.com')
  const body=await request.json();mail.push(body)
  if(uncertain)throw new TypeError('lost acknowledgement after mail submission')
  return Response.json({id:'synthetic-native-'+mail.length})
 }})
 const call=(path,body,token)=>app.call('/api/identity'+path,{body,token})
 const entry={email:'owner@example.test',password:'synthetic-native-owner-password',allowedOrigin:'https://acme.example.test',setupToken}
 const link=body=>new URL(body.text.match(/https?:\/\/\S+/)[0])
 const invitationToken=url=>new URL(url).searchParams.get('token')
 try{
  assert.equal((await call('/setup')).data.available,true)
  assert.equal((await call('/bootstrap',{...entry,setupToken:'wrong'})).status,403)
  assert.equal((await app.call('/api/identity/bootstrap',{body:entry,headers:{Origin:'https://foreign.test'}})).status,403)
  // A failed claim is atomic. The next real claim still succeeds exactly once.
  await app.db.prepare("CREATE TRIGGER native_claim_fault BEFORE INSERT ON credentials BEGIN SELECT RAISE(ABORT,'synthetic claim failure'); END").run()
  assert.equal((await call('/bootstrap',entry)).status,500)
  assert.equal((await call('/setup')).data.available,true)
  await app.db.prepare('DROP TRIGGER native_claim_fault').run()
  uncertain=true
  const claims=await Promise.all([call('/bootstrap',entry),call('/bootstrap',entry)])
  assert.deepEqual(claims.map(r=>r.status).sort(),[201,409])
  const owner=claims.find(r=>r.status===201).data
  assert.equal(owner.welcomeEmail,'uncertain')
  const sent=mail.length;await app.scheduled();assert.equal(mail.length,sent,'uncertain welcome is never replayed')
  uncertain=false
  assert.equal((await call('/setup')).data.available,false)
  assert.equal((await call('/bootstrap',entry)).status,409)
  assert.equal((await call('/login',{email:entry.email,password:'wrong'})).status,401)
  const login=(await call('/login',{email:entry.email,password:entry.password,projectId:owner.projectId})).data
  let token=login.token
  assert.equal((await call('/session',undefined,token)).data.projectId,owner.projectId)
  assert.equal((await app.call(`/api/identity/projects/${owner.projectId}`)).status,401,'provider configuration grants no actor authority')
  const foreign=await app.seedWorkspace('native-foreign')
  assert.equal((await app.call(`/api/identity/projects/${foreign.projectId}`,{token})).status,403)
  const created=(await app.call('/api/management/projects',{token,body:{name:'Second desk',allowedOrigin:'https://second.example.test'},status:201})).data
  token=(await call('/switch-project',{projectId:created.id},token)).data.token
  assert.equal((await call('/session',undefined,token)).data.projectId,created.id)
  token=(await call('/switch-project',{projectId:owner.projectId},token)).data.token

  // Recovery is neutral, scanner safe, single use, and revokes the old sessions.
  const start=mail.length
  const known=await call('/forgot-password',{email:entry.email}),unknown=await call('/forgot-password',{email:'unknown@example.test'})
  assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data)
  await app.until(()=>mail.slice(start).some(m=>[].concat(m.to).includes(entry.email)))
  const reset=link(mail.slice(start).find(m=>[].concat(m.to).includes(entry.email))).searchParams.get('token')
  const state=()=>call('/link-status',{kind:'reset',token:reset})
  assert.equal((await state()).data.state,'valid');assert.equal((await state()).data.state,'valid')
  const password='synthetic-recovered-owner-password'
  assert.equal((await call('/accept-token',{token:reset,password})).status,200)
  assert.equal((await call('/session',undefined,token)).status,401)
  assert.equal((await call('/accept-token',{token:reset,password})).status,400)
  token=(await call('/login',{email:entry.email,password,projectId:owner.projectId})).data.token

  // Invitation management and a teammate's owner-issued reset use the same team.
  const setup=(await call('/two-factor/totp',{},token)).data
  assert.equal((await call('/two-factor/totp/confirm',{factorId:setup.factorId,code:totp(setup.secret)},token)).status,201)
  const agents=`/api/management/projects/${owner.projectId}/agents`,invitations=`/api/management/projects/${owner.projectId}/invitations`
  const invite=async(email,role='operator')=>(await app.call(agents,{token,body:{email,role},status:201})).data.data
  const first=await invite('teammate@example.test')
  const operator=await app.seedWorkspace('native-denied')
  assert.equal((await app.call(invitations+'/teammate%40example.test/link',{token:operator.tokens.owner,method:'POST'})).status,403)
  const copied=(await app.call(invitations+'/teammate%40example.test/link',{token,body:{},status:201})).data.data
  const beforeResend=mail.length
  assert.equal((await app.call(invitations+'/teammate%40example.test/resend',{token,body:{}})).status,201)
  assert.equal(mail.length,beforeResend+1)
  const teammatePassword='synthetic-native-teammate-password'
  const accepted=await call('/accept-token',{token:invitationToken(copied.invitationUrl),name:'Teammate',password:teammatePassword})
  assert.equal(accepted.status,200)
  assert.equal((await call('/accept-token',{token:invitationToken(first.invitationUrl),password:teammatePassword})).status,400,'sibling links retire together')
  const teammate=(await call('/login',{email:'teammate@example.test',password:teammatePassword})).data
  assert.equal(teammate.actor.projectId,owner.projectId)
  assert.equal((await app.call(invitations+'/missing%40example.test/link',{token:teammate.token,body:{}})).status,403)
  const revoked=await invite('revoked@example.test')
  assert.equal((await app.call(invitations+'/revoked%40example.test',{token,method:'DELETE'})).status,200)
  assert.equal((await call('/accept-token',{token:invitationToken(revoked.invitationUrl),password:teammatePassword})).status,400)
  const resetIssued=await call('/password-reset',{userId:teammate.actor.id},token)
  assert.equal(resetIssued.status,201,'the owner issues the reset in the teammate workspace')
  const ownerReset=resetIssued.data
  assert.equal((await call('/accept-token',{token:ownerReset.token,password:'synthetic-reset-teammate-password'})).status,200)
  assert.equal((await call('/session',undefined,teammate.token)).status,401)

  // The same teammate can explicitly sign in by email, once, under current authority.
  const beforeMagic=mail.length
  const magic=await call('/magic-link',{email:'teammate@example.test'}),neutral=await call('/magic-link',{email:'absent@example.test'})
  assert.equal(magic.status,202);assert.deepEqual(magic.data,neutral.data)
  await app.until(()=>mail.length>beforeMagic)
  const capability=new URLSearchParams(link(mail.at(-1)).hash.slice(1)).get('token')
  assert.ok(capability)
  assert.equal((await app.call('/api/identity/magic-link/consume?token='+capability)).status,404)
  const responses=await Promise.all([call('/magic-link/consume',{token:capability}),call('/magic-link/consume',{token:capability})])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,400])
  const cookie=responses.find(r=>r.status===200).headers.get('Set-Cookie').split(';')[0]
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:cookie}})).data.projectId,owner.projectId)
  await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(owner.projectId,teammate.actor.id).run()
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:cookie}})).status,401)
  const pending=await invite('pending@example.test')
  await app.db.batch([
   app.db.prepare("INSERT INTO context_jobs(id,project_id,subject_id,kind,state,source_revision,packet_json,model,created_at) VALUES('retired-context',?,'subject','project','queued',0,'{}','fixture',?)").bind(owner.projectId,Date.now()),
   app.db.prepare("INSERT INTO brand_generations(id,project_id,actor_id,request_id,prompt,model,size,quality,state,created_at,expires_at) VALUES('retired-brand',?,?,'retired-brand-request','Mark','fixture','1024x1024','low','queued',?,?)").bind(owner.projectId,owner.userId,Date.now(),Date.now()+60000),
  ])
  const admittedJobs=(await app.takeJobs()).filter(job=>job.projectId===owner.projectId)
  assert.equal((await app.call(`/api/management/projects/${owner.projectId}`,{token,method:'DELETE'})).status,200)
  const calls=app.requests.length
  await app.runJobs([...admittedJobs,{type:'context.run',id:'retired-context',projectId:owner.projectId},{type:'brand.generate',id:'retired-brand',projectId:owner.projectId}])
  await app.scheduled()
  assert.equal(app.requests.length,calls,'retired workspaces cannot contact providers')
  assert.ok(!(await app.takeJobs()).some(job=>job.projectId===owner.projectId),'retired workspaces cannot redispatch their backlog')
  assert.equal((await call('/link-status',{kind:'invitation',token:invitationToken(pending.invitationUrl)})).data.state,'invalid')
  assert.equal((await call('/session',undefined,token)).status,401)
  assert.equal((await call('/setup')).data.available,false,'retiring the workspace never reopens owner setup')
 }finally{await app.close()}
}
