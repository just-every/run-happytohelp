import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'

// IDENTITY-001: real routes, current authority and default D1 admission limits.
// Only the mail provider is replaced; no limiter, clock or auth code is mocked.
export async function scopedAuthorityJourney(){
 const mail=[]
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',REGISTRATION_ENABLED:'true',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-admission-mail-key',EMAIL_FROM:'support@example.test'},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.resend.com')
  mail.push(await request.json());return Response.json({id:'scoped-mail-'+mail.length})
 }})
 try{
  await tenantAuthority(app)
  await providerAuthority(app)
  await admissionLimits(app,mail)
 }finally{await app.close()}
}

async function tenantAuthority(app){
 const origin='https://widget.example',a=await app.seedWorkspace('scope-a',{allowedOrigin:origin}),b=await app.seedWorkspace('scope-b',{allowedOrigin:origin})
 const admit=async workspace=>{
  const {verification_secret:secret}=await app.first('SELECT verification_secret FROM projects WHERE id=?',workspace.projectId)
  // The same signed identifier exists in both tenants, with separate secrets.
  const body={widgetKey:workspace.widgetKey,identifier:'shared-customer',contact_hash:createHmac('sha256',secret).update('shared-customer').digest('hex')}
  const enter=()=>app.call('/api/identity/widget/session',{body,headers:{Origin:origin}})
  const visitor=(await enter()).data
  assert.equal(visitor.projectId,workspace.projectId);assert.equal(visitor.verified,true)
  const conversation=(await app.call('/api/conversations',{body:{projectId:workspace.projectId},token:visitor.token,status:201})).data
  return {...visitor,conversation,enter}
 }
 const av=await admit(a),bv=await admit(b)
 assert.notEqual(av.contactId,bv.contactId)
 const own=`/api/conversations/${av.conversation.id}/messages`,foreign=`/api/conversations/${bv.conversation.id}/messages`
 assert.equal((await app.call(own,{token:av.token})).status,200)
 assert.equal((await app.call(foreign,{token:bv.token})).status,200)
 assert.equal((await app.call(`/api/identity/projects/${a.projectId}`,{token:a.tokens.owner})).status,200)
 // A real native session cannot read, write or switch into the other tenant.
 for(const path of [`/api/identity/projects/${b.projectId}`,`/api/management/projects/${b.projectId}/settings`])assert.equal((await app.call(path,{token:a.tokens.owner})).status,403,path)
 assert.equal((await app.call('/api/identity/switch-project',{token:a.tokens.owner,body:{projectId:b.projectId}})).status,403)
 assert.equal((await app.call(`/api/management/projects/${b.projectId}/settings`,{token:a.tokens.owner,method:'PUT',body:{name:'Forbidden rename'}})).status,403)
 assert.equal((await app.call(foreign,{token:a.tokens.owner})).status,404)
 // Knowing the other widget key, origin, contact and conversation grants no scope.
 assert.equal((await app.call(foreign,{token:av.token})).status,404)
 assert.equal((await app.call(foreign,{token:av.token,body:{localId:'foreign-write',content:'Forbidden reply',expectedRevision:0}})).status,404)
 assert.equal((await app.call('/api/conversations',{token:av.token,body:{projectId:b.projectId,contactId:bv.contactId}})).status,403)
 assert.deepEqual((await app.call('/api/conversations',{token:av.token,status:200})).data.conversations.map(row=>row.id),[av.conversation.id])
 assert.deepEqual((await app.call(foreign,{token:bv.token,status:200})).data.messages,[],'foreign refusals leave the transcript intact')
 assert.equal((await app.call(`/api/identity/projects/${b.projectId}`,{token:b.tokens.owner,status:200})).data.name,b.name)

 // Block through the owner's public contact action; both old capability and re-admission fail.
 assert.equal((await app.call(`/api/management/projects/${a.projectId}/contacts/${av.contactId}`,{token:a.tokens.owner,method:'PUT',body:{is_blocked:true}})).status,200)
 for(const path of ['/api/identity/session','/api/identity/widget/profile',own])assert.equal((await app.call(path,{token:av.token})).status,401,path)
 assert.equal((await app.call(own,{token:av.token,body:{localId:'blocked-write',content:'Refused',expectedRevision:0}})).status,401)
 assert.equal((await av.enter()).status,403)
 assert.equal((await app.call(foreign,{token:bv.token})).status,200,'blocking one tenant leaves the other visitor admitted')

 // Revoke native and visitor sessions through the session door, then retry reads and writes.
 for(const [token,path,body] of [[a.tokens.admin,`/api/management/projects/${a.projectId}/settings`,{name:'Revoked rename'}],[bv.token,foreign,{localId:'revoked-write',content:'Refused',expectedRevision:0}]]){
  assert.equal((await app.call('/api/identity/session',{token})).status,200)
  assert.equal((await app.call('/api/identity/session',{token,method:'DELETE'})).status,200)
  assert.equal((await app.call('/api/identity/session',{token})).status,401)
  assert.equal((await app.call(path,{token})).status,401)
  assert.equal((await app.call(path,{token,method:token===bv.token?'POST':'PUT',body})).status,401)
 }
 // A fresh visitor is usable until the owner deletes the workspace through its real action.
 const fresh=(await bv.enter()).data
 assert.equal((await app.call(foreign,{token:fresh.token})).status,200)
 assert.equal((await app.call(`/api/management/projects/${b.projectId}`,{token:b.tokens.owner,method:'DELETE'})).status,200)
 for(const token of [b.tokens.owner,fresh.token]){
  assert.equal((await app.call('/api/identity/session',{token})).status,401)
  assert.equal((await app.call(foreign,{token})).status,401)
  assert.equal((await app.call(foreign,{token,body:{localId:'deleted-write',content:'Refused',expectedRevision:0}})).status,401)
 }
 assert.equal((await bv.enter()).status,403,'the deleted widget key cannot admit another visitor')
 assert.equal((await app.call(`/api/management/projects/${a.projectId}/settings`,{token:a.tokens.owner})).status,200,'the other workspace remains usable')
}

async function providerAuthority(app){
 const workspace=await app.seedWorkspace('provider-scope'),project=`/api/management/projects/${workspace.projectId}`
 assert.equal((await app.call('/api/identity/session')).status,401)
 // Redeploy the same real store with installation provider credentials configured.
 const providers={OPENAI_API_KEY:'synthetic-scope-openai',ANTHROPIC_API_KEY:'synthetic-scope-anthropic',GOOGLE_API_KEY:'synthetic-scope-google',EMAIL_API_KEY:'synthetic-admission-mail-key'}
 await app.configure({...providers,RER_MANAGEMENT_ORIGIN:'https://management.example',RER_INSTALLATION_ID:'synthetic-scope-installation'})
 const config=await app.call('/api/identity/editor-config',{token:workspace.tokens.owner,status:200})
 assert.equal(config.data.enabled,true,'the installation configuration is actually present')
 const before=(await app.call(project+'/settings',{token:workspace.tokens.owner,status:200})).data
 for(const token of [undefined,...Object.values(providers),workspace.widgetKey]){
  for(const path of ['/api/identity/session','/api/identity/editor-config',project+'/settings'])assert.equal((await app.call(path,{token})).status,401,path)
  const refused=await app.call(project+'/settings',{token,method:'PUT',body:{name:'Provider is not an owner'}})
  assert.equal(refused.status,401);assert.equal(refused.headers.get('set-cookie'),null)
  assert.equal((await app.call('/api/management/projects',{token,body:{name:'Unowned workspace',allowedOrigin:'https://widget.example'}})).status,401)
 }
 const foreign=await app.seedWorkspace('provider-foreign')
 assert.equal((await app.call(project+'/settings',{token:foreign.tokens.owner})).status,403,'configured providers do not widen a native actor')
 assert.deepEqual((await app.call(project+'/settings',{token:workspace.tokens.owner,status:200})).data,before,'provider configuration and refused writes do not change the workspace')
}

async function admissionLimits(app,mail){
 assert.equal(app.bindings.RATE_LIMITS,undefined,'exercise documented defaults without an override')
 const address=ip=>({'CF-Connecting-IP':ip})
 const widget=await app.seedWorkspace('admission-widget'),widgetHeaders={Origin:widget.allowedOrigin,...address('192.0.2.10')}
 const admit=()=>app.call('/api/identity/widget/session',{body:{widgetKey:widget.widgetKey},headers:widgetHeaders})
 const counts=()=>app.first('SELECT (SELECT count(*) FROM contacts WHERE project_id=?) contacts,(SELECT count(*) FROM sessions WHERE project_id=?) sessions',widget.projectId,widget.projectId)
 const before=await counts()
 for(let n=0;n<30;n++)assert.equal((await admit()).status,201,`documented widget admission ${n+1}/30`)
 assert.deepEqual(await counts(),{contacts:before.contacts+30,sessions:before.sessions+30})
 await limited(admit,'widgetSessionsPerIpHour',3600)
 assert.deepEqual(await counts(),{contacts:before.contacts+30,sessions:before.sessions+30},'refusal creates neither a contact nor a session')
 assert.equal((await app.first('SELECT used FROM abuse_counters WHERE key=?','rate:widgetSessionsPerIpHour:'+sha(widget.projectId+'|192.0.2.10'))).used,30,'the real D1 counter reaches the default ceiling')
 // Capacity and refusal survive a worker restart, rather than living in a process-local fake.
 await app.configure({})
 await limited(admit,'widgetSessionsPerIpHour',3600)

 const registerHeaders=address('192.0.2.20')
 const register=n=>app.call('/api/identity/register',{headers:registerHeaders,body:{name:'New owner',email:`admission-${n}@example.test`,password:'synthetic-admission-password',projectName:'Registered workspace',allowedOrigin:'https://widget.example'}})
 const pending=await app.first('SELECT count(*) n FROM registrations'),sent=mail.length
 for(let n=0;n<5;n++)assert.equal((await register(n)).status,202,`documented registration ${n+1}/5`)
 await limited(()=>register(5),'registrationsPerIpDay',86400)
 assert.equal((await app.first('SELECT count(*) n FROM registrations')).n,pending.n+5)
 assert.equal(mail.length,sent+5,'limited registration sends no mail')
 const verification=new URL(mail.find(message=>message.to.includes('admission-0@example.test')).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')

 const account=await app.seedWorkspace('admission-account')
 const create=(token,ip,name)=>app.call('/api/management/projects',{token,headers:address(ip),body:{name,allowedOrigin:'https://widget.example'}})
 const total=async()=>(await app.first('SELECT count(*) n FROM projects')).n
 let projects=await total()
 // Rotate only the edge-observed address: one native account still has ten creations per UTC day.
 for(let n=0;n<10;n++)assert.equal((await create(account.tokens.owner,`192.0.2.${40+n}`,'Account workspace '+n)).status,201,`documented account creation ${n+1}/10`)
 await limited(()=>create(account.tokens.owner,'192.0.2.60','Account overflow'),'projectsPerAccountDay',86400)
 assert.equal(await total(),projects+10,'account refusal creates no project')
 const network=await app.seedWorkspace('admission-network'),ip='192.0.2.70'
 projects=await total()
 for(let n=0;n<10;n++)assert.equal((await create(network.tokens.owner,ip,'Network workspace '+n)).status,201,`documented address creation ${n+1}/10`)
 const other=await app.seedWorkspace('admission-other-account')
 await limited(()=>create(other.tokens.owner,ip,'Network overflow'),'projectsPerIpDay',86400)
 assert.equal(await total(),projects+11,'address refusal creates no project (only the explicitly seeded other account)')
 // Email verification shares the same IP ceiling and must not consume its one-use token on refusal.
 await limited(()=>app.call('/api/identity/verify-email',{headers:address(ip),body:{token:verification}}),'projectsPerIpDay',86400)
 assert.equal((await app.call('/api/identity/verify-email',{headers:address('192.0.2.71'),body:{token:verification}})).status,200)
 assert.equal((await create(other.tokens.owner,'192.0.2.72','Other network')).status,201,'unrelated account and address retain capacity')
}

async function limited(request,limit,seconds){
 const before=Date.now(),response=await request(),after=Date.now()
 assert.equal(response.status,429,limit)
 assert.equal(response.data.code,'rate_limited');assert.equal(response.data.limit,limit)
 const header=response.headers.get('retry-after')
 assert.match(header,/^[1-9]\d*$/);assert.equal(Number(header),response.data.retryAfter)
 // Independently bound the advertised wait by the UTC window containing the request.
 const remaining=now=>Math.max(1,Math.ceil((Math.floor(now/(seconds*1000))*seconds*1000+seconds*1000-now)/1000))
 assert.ok([remaining(before),remaining(after)].some(value=>Math.abs(value-Number(header))<=1),`${limit} Retry-After counts to the documented window boundary`)
 assert.equal(response.headers.get('set-cookie'),null)
}
