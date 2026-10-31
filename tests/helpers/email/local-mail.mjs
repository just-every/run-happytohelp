import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,copyFile,cp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {createServer} from 'node:net'
import {randomBytes} from 'node:crypto'
import {readDevKey,signInAs} from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs'
import {startApp} from '../../journeys/kit/app.mjs'
import {createRuntime} from '../emitted-runtime.mjs'
import {command,run,stopOwnedServer} from '../rer-command.mjs'

// Public rer commands and HTTP routes; the only substitute is the hosted mail
// provider's network response. Suppressed mail must leave no email content store.
export async function localMailJourney(){
 await localMailRoutes()
 await devEntry()
 await productionEntry()
}

async function localMailRoutes(){
 const origin='http://127.0.0.1:8787',password='synthetic-local-owner-password'
 let refusal=403
 const app=await startApp({origin,captureQueue:true,bindings:{APP_ORIGIN:origin,H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.resend.com','only the hosted mail edge may be called')
  return new Response('Provider refused delivery',{status:refusal})
 }})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{name:'Local support',email:'owner@example.test',password,allowedOrigin:origin}})
  assert.equal(owner.welcomeEmail,'suppressed')
  const token=owner.token,project=owner.projectId,base=`/api/management/projects/${project}`
  const send=idempotencyKey=>app.call(base+'/email-settings/test',{token,body:{idempotencyKey}})
  const count=async table=>(await app.first(`SELECT count(*) n FROM ${table}`)).n
  const settings=await app.ok(base+'/email-settings',{token})
  assert.equal(settings.sending.mode,'local')
  assert.equal(settings.sending.provider,'development')
  assert.equal(settings.installation.environment,'local')
  assert.deepEqual((await send('local-verification')).data,{id:null,state:'suppressed',mode:'local'})
  const invitation=await app.ok(base+'/agents',{token,body:{email:'teammate@example.test',role:'operator'}})
  assert.equal(invitation.data.delivery,'suppressed','teammate mail is never presented as sent')
  assert.equal((await app.call(base+'/agents',{token,body:{email:'invalid-address',role:'operator'}})).status,400,'development mail still validates recipients')
  const widgetKey=(await app.first('SELECT widget_key FROM projects WHERE id=?',project)).widget_key
  const visitor=await app.ok('/api/identity/widget/session',{headers:{Origin:origin},body:{widgetKey,email:'visitor@example.test'}})
  const conversation=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:project}})
  const transcript=()=>app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token})
  const say=async(actor,localId,content)=>{const head=await transcript();return app.ok(`/api/conversations/${conversation.id}/messages`,{token:actor,body:{localId,content,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId}})}
  await say(visitor.token,'local-question','Please help with my local order')
  const reply=await say(token,'local-answer','The local answer remains in the support transcript')
  await app.drainJobs();await app.scheduled(undefined,{after:61000})
  const bucket=await app.ok(`/api/dashboard/projects/${project}/conversations/${conversation.id}/buckets/${conversation.id}`,{token})
  assert.equal(bucket.data.messages.find(row=>row.id===reply.message.id).email_status.state,'suppressed','visitor reply mail is visibly suppressed')
  assert.ok((await transcript()).messages.some(row=>row.id===reply.message.id),'suppression retains the ordinary support transcript')
  const emailed=await app.ok(`/api/dashboard/projects/${project}/conversations/${conversation.id}`,{token,method:'PUT',body:{send_transcript_to:'visitor@example.test',idempotencyKey:'local-visitor-transcript'}})
  assert.deepEqual(emailed.transcript_delivery,{id:null,state:'suppressed',mode:'local'},'visitor mail returns suppression rather than delivery')
  assert.equal((await app.call('/api/identity/magic-link',{body:{email:'owner@example.test'},headers:{Origin:origin}})).status,503,'local sign-in never pretends to email a link')
  assert.equal(await count('magic_signins'),0)
  assert.equal(await count('email_deliveries'),0,'development mail stores no delivery or message content')
  assert.equal(await count('rer_mail_development_outbox'),0,'the retained legacy development outbox stays empty')
  assert.equal(app.requests.length,0,'local visitor and teammate mail makes no external requests')
  for(const path of ['/__dev/mail','/__dev/mail/messages','/api/identity/local-mail','/api/identity/local-mail/messages'])assert.equal((await app.request(path,{token})).status,404,'no local mail viewer at '+path)
  const login=await app.ok('/api/identity/login',{body:{email:'owner@example.test',password}})
  assert.equal(login.actor.id,owner.userId,'native password identity remains usable')

  // A local-looking request cannot replace missing or rejected hosted credentials.
  const forged={'X-H2H-Local':'true','X-Email-Provider':'development','X-Forwarded-Host':'localhost','X-Rer-Dev-Key':'forged'}
  for(const changes of [
   {H2H_LOCAL:undefined,APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'development'},
   {H2H_LOCAL:'true',APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'development'},
   {H2H_LOCAL:'true',APP_ORIGIN:origin,RER_INSTALLATION_ID:'hosted-installation',EMAIL_PROVIDER:'development'},
   {H2H_LOCAL:undefined,APP_ORIGIN:'https://app.example',RER_INSTALLATION_ID:undefined,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:undefined},
  ]){
   await app.configure(changes)
   assert.equal((await app.call(base+'/email-settings/test',{token,headers:forged,body:{idempotencyKey:crypto.randomUUID()}})).status,503)
   assert.equal((await app.ok(base+'/email-settings',{token})).sending.mode,'unavailable')
   assert.equal(await count('email_deliveries'),0)
  }
  await app.configure({H2H_LOCAL:undefined,APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provider-edge'})
  for(const [status,state] of [[403,'failed'],[503,'uncertain']]){
   refusal=status
   const key='hosted-'+status,before=app.requests.length
   assert.equal((await send(key)).status,502)
   assert.equal(app.requests.length,before+1,'hosted failure reaches the configured provider')
   assert.equal((await app.first('SELECT state FROM email_deliveries WHERE id=?',key)).state,state)
   assert.equal((await app.ok(base+'/email-settings',{token})).sending.mode,'remote')
   assert.equal((await send(key)).status,409,'a failed or uncertain command is not automatically replayed')
   assert.equal(app.requests.length,before+1)
  }
  assert.equal(await count('rer_mail_development_outbox'),0)
  const hostedLogin=await app.ok('/api/identity/login',{body:{email:'owner@example.test',password}})
  assert.equal(hostedLogin.actor.id,owner.userId,'hosted configuration retains the native owner credentials')
  assert.equal((await app.first('SELECT content FROM messages WHERE id=?',reply.message.id)).content,'The local answer remains in the support transcript','configuration changes preserve prior data')
 }finally{await app.close()}
}

async function devEntry(){
 const source=resolve(new URL('../../..',import.meta.url).pathname),scratch=await mkdtemp(join(tmpdir(),'h2h-local-mail-')),root=join(scratch,'checkout')
 let server
 try{
  // Isolate command-owned state and dependencies: rer setup may relink packages.
  const {stdout}=await promisify(execFile)('git',['ls-files','-z'],{cwd:source,maxBuffer:4*1024*1024})
  for(const file of stdout.split('\0').filter(Boolean)){await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(join(source,file),join(root,file))}
  await cp(join(source,'node_modules'),join(root,'node_modules'),{recursive:true,verbatimSymlinks:true})
  const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done))
  const origin=`http://127.0.0.1:${port}`
  await mkdir(join(root,'.seed'),{recursive:true,mode:0o700})
  await writeFile(join(root,'.seed/local-mail-answers.json'),JSON.stringify({WORKSPACE_NAME:'Local support',WIDGET_ORIGIN:origin,OWNER_PASSWORD:randomBytes(24).toString('base64url'),EMAIL_PROVIDER:'later'}),{mode:0o600})
  await run(root,['setup','--owner-email','local-owner@example.test','--answers','.seed/local-mail-answers.json','--port',String(port)])
  server=command(root,['dev'])
  await server.waitFor(event=>event.event==='ready',180000)
  const key=await readDevKey(root)
  const request=(path,headers={},options={})=>fetch(origin+path,{redirect:'manual',headers,...options})
  for(const path of ['/auth/dev/enter','/__dev/personas']){
   for(const headers of [{},{'x-rer-dev-key':'forged'},{Cookie:'rer_dev_gate_'+port+'=forged'},{'X-Forwarded-Host':'localhost','X-H2H-Local':'true'}]){
    const response=await request(path,headers);assert.equal(response.status,404);assert.equal(response.headers.get('set-cookie'),null);await response.body?.cancel()
   }
  }
  const forged=await request('/__dev/key',{'Content-Type':'application/json'},{method:'POST',body:JSON.stringify({key:'forged'})})
  assert.equal(forged.status,404);assert.equal(forged.headers.get('set-cookie'),null);await forged.body?.cancel()
  const identity=await signInAs({origin,key,returnTo:'/setup'})
  assert.equal(identity.location,'/setup')
  const setup=await request(identity.location,{Cookie:identity.header})
  assert.equal(setup.status,307,'Setup resumes the signed-in workspace')
  assert.equal(setup.headers.get('location'),'/projects?onboarding=setup');await setup.body?.cancel()
  const workspace=await request('/projects?onboarding=setup',{Cookie:identity.header})
  assert.equal(workspace.status,200,'the owner reaches the workspace Setup entry');await workspace.body?.cancel()
  const session=await request('/api/identity/session',{Cookie:identity.header})
  assert.equal(session.status,200);assert.equal((await session.json()).role,'owner')
  const native=identity.cookies.find(row=>row.name==='h2h_session');assert.ok(native)
  const withoutGate=await request('/api/identity/session',{Cookie:'h2h_session='+native.value})
  assert.equal(withoutGate.status,401);await withoutGate.body?.cancel()
  const crossSite=await request('/auth/dev/enter',{Cookie:identity.header,'Sec-Fetch-Site':'cross-site'})
  assert.equal(crossSite.status,404);await crossSite.body?.cancel()
  for(const path of ['/__dev/mail','/__dev/mail/messages']){const response=await request(path,{Cookie:identity.header});assert.equal(response.status,404);await response.body?.cancel()}
 }finally{
  if(server){try{await stopOwnedServer(server.child)}finally{await server.stop()}}
  await rm(scratch,{recursive:true,force:true})
 }
}

export async function productionEntry(){
 // Exercise the emitted production Worker, even with plausible local bindings.
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',RER_DEV_KEY:'synthetic-production-dev-key-'.repeat(3)}})
 let success=false
 try{
  for(const path of ['/auth/dev/enter','/__dev/personas','/__dev/key','/__dev/mail','/__dev/mail/messages']){
   const response=await fetch(runtime.origin+path,{redirect:'manual',headers:{'x-rer-dev-key':'synthetic-production-dev-key-'.repeat(3)}})
   assert.equal(response.status,404,'production excludes '+path);assert.equal(response.headers.get('set-cookie'),null);await response.body?.cancel()
  }
  success=true
 }finally{await runtime.close(success)}
}
