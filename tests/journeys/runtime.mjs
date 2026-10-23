import {mobileAdmission} from '../helpers/mobile.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {request as httpRequest} from 'node:http'
import {execFile,spawn,execFileSync} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile,symlink,mkdtemp,rm,readdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:net'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {proxyFaultProbe} from '../helpers/emitted-runtime-proxy-fault.mjs'
import {awaitWindowRoom} from '../helpers/window-room.mjs'
import {client} from './kit/http.mjs'

const exec=promisify(execFile)
async function withRuntime(options,body){const runtime=await createRuntime(options);let success=false;try{await body(runtime,client(runtime.origin));success=true}finally{await runtime.close(success)}}

test('the emitted Worker starts on real D1/R2, signs in its native owner and refuses the local entry, retired payment routes and unknown paths',async()=>{
 await withRuntime({},async(runtime,{call,request})=>{
  const {origin}=runtime
  const health=(await call('/health',{status:200})).data;assert.equal(health.status,'ok');assert.equal(health.database,'reachable');assert.equal(health.files,'reachable')
  const homepage=await request('/');assert.equal(homepage.status,200);const html=await homepage.text();assert.match(html,/HappyToHelp/i);assert.doesNotMatch(html,/<h1>Foundation<\/h1>/)
  for(const path of ['/login','/docs','/docs/install'])assert.equal((await request(path)).status,200,path)
  for(const path of ['/does-not-exist','/docs/does-not-exist']){const response=await request(path),body=await response.text();assert.equal(response.status,404,path);assert.match(body,/<title>Page not found · HappyToHelp<\/title>/);assert.match(body,/Back to the homepage/)}
  assert.equal((await call('/api/identity/session')).status,401);assert.equal((await call('/api/management/bootstrap')).status,401)
  const first=(await call('/api/identity/bootstrap',{body:{password:'synthetic-test-setup-password-123',name:'Runtime project',email:'runtime-owner@example.com',allowedOrigin:origin},status:201})).data
  // Visitors in these journeys write while nobody has the dashboard open and the team answers anyway, so presence-based away is off
  // (presence itself: tests/helpers/widget/presence.mjs).
  await runtime.presenceAwayOff(first.projectId)
  assert.equal((await call('/api/identity/bootstrap',{body:{password:'synthetic-second-claim-password-123',name:'Second claim',email:'second-claim@example.com',allowedOrigin:origin}})).status>=400,true,'a claimed installation refuses a second first-owner claim')
  await call('/api/identity/password',{body:{currentPassword:'synthetic-test-setup-password-123',password:'synthetic-runtime-fixture-password-123'},token:first.token,status:200})
  assert.equal((await call('/api/identity/session',{token:first.token})).status,401,'a password change revokes the old session')
  const loginResponse=await call('/api/identity/login',{body:{email:'runtime-owner@example.com',password:'synthetic-runtime-fixture-password-123'},status:200});assert.match(loginResponse.headers.get('Set-Cookie'),/HttpOnly/)
  const login=loginResponse.data;assert.equal((await call('/api/identity/session',{headers:{Cookie:loginResponse.headers.get('Set-Cookie').split(';')[0]}})).status,200)
  // Development auto-login must not exist in the emitted Worker, even for a same-origin loopback request.
  assert.equal((await call('/api/identity/local-owner-session',{body:{},headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}})).status,404)
  const second=(await call('/api/management/projects',{body:{name:'Second project',allowedOrigin:origin},token:login.token,status:201})).data
  const switched=(await call('/api/identity/switch-project',{body:{projectId:second.id},token:login.token,status:200})).data;assert.equal(switched.actor.projectId,second.id)
  const outsider=await runtime.seedTenant({name:'Other tenant',email:'other-tenant@example.com',allowedOrigin:origin})
  assert.equal((await call('/api/identity/switch-project',{body:{projectId:outsider.projectId},token:login.token})).status,403)
  const project=(await call('/api/identity/projects/'+first.projectId,{token:login.token,status:200})).data
  const contact=(await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:origin},status:201})).data
  const conversation=(await call('/api/conversations',{body:{projectId:first.projectId},token:contact.token,status:201})).data
  const inbox=async()=>{const [counts,list]=await Promise.all(['/counts','?view=all'].map(async suffix=>(await call(`/api/dashboard/projects/${first.projectId}/conversations${suffix}`,{token:login.token})).data.data));return {unassigned:counts.unassigned,listed:list.some(row=>row.id===conversation.id)}}
  const unwritten=await inbox();assert.equal(unwritten.listed,false,'an empty conversation is not in the inbox')
  const command={localId:'runtime-message',content:'Native emitted Worker durable message',expectedRevision:0}
  assert.equal((await call(`/api/conversations/${conversation.id}/messages`,{body:command,token:contact.token,status:200})).data.accepted,true)
  assert.deepEqual(await inbox(),{unassigned:unwritten.unassigned+1,listed:true})
  assert.equal((await call(`/api/conversations/${conversation.id}/messages`,{body:command,token:contact.token})).data.duplicate,true)
  assert.equal((await call(`/api/conversations/${conversation.id}/messages`,{token:outsider.token})).status,404)
  const transcript=(await call(`/api/conversations/${conversation.id}/messages`,{token:login.token})).data;assert.deepEqual(transcript.messages.map(m=>m.content),[command.content])
  const retiredBilling=`/api/management/projects/${first.projectId}/billing`
  for(const [path,method] of [[retiredBilling,'GET'],[retiredBilling+'/top-up','POST'],[retiredBilling+'/setup','POST'],[retiredBilling+'/portal','POST'],[retiredBilling+'/automated','PUT'],[retiredBilling+'/toggle','POST'],['/api/management/webhooks/stripe','POST']])assert.equal((await call(path,{method,body:method==='GET'?undefined:{},token:login.token})).status,404,`${method} ${path}`)
  for(const path of ['/health/extra','/api','/api/this-route-does-not-exist'])assert.equal((await call(path)).status,404,path)
  // Deleting the last workspace leaves an account-only sign-in that can create a new one.
  await call('/api/management/projects/'+first.projectId,{method:'DELETE',token:login.token,status:200});await call('/api/management/projects/'+second.id,{method:'DELETE',token:switched.token,status:200})
  const account=(await call('/api/identity/login',{body:{email:'runtime-owner@example.com',password:'synthetic-runtime-fixture-password-123'},status:200})).data;assert.equal(account.accountOnly,true)
  const recreated=(await call('/api/management/projects',{body:{name:'Recreated project',allowedOrigin:origin},token:account.token,status:201})).data
  await call('/api/identity/switch-project',{body:{projectId:recreated.id},token:account.token,status:200})
 })
})

test('operator pages and APIs refuse foreign framing while the widget, its CORS API and published help pages stay embeddable',async()=>{
 const customer='https://customer.example.test'
 const application=(response,label,ancestors="frame-ancestors 'self'",frameOptions='SAMEORIGIN')=>{assert.equal(response.headers.get('content-security-policy'),ancestors,label);assert.equal(response.headers.get('x-frame-options'),frameOptions,label);assert.equal(response.headers.get('x-content-type-options'),'nosniff',label);assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin',label)}
 const unframed=(response,label)=>{assert.equal(response.headers.get('content-security-policy'),null,label);assert.equal(response.headers.get('x-frame-options'),null,label)}
 await withRuntime({},async(runtime,{call,request})=>{
  for(const path of ['/','/login','/setup','/docs','/docs/install']){const response=await request(path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/text\/html/,path);application(response,path)}
  const created=await call('/api/identity/bootstrap',{body:{password:'synthetic-security-header-password-123',name:'Header project',email:'header-owner@example.com',allowedOrigin:customer},headers:{Origin:runtime.origin},status:201});application(created,'bootstrap API')
  const owner=created.data
  const dashboard=await request(`/projects/${owner.projectId}/conversations`,{headers:{Cookie:created.headers.get('set-cookie').split(';')[0]}});assert.equal(dashboard.status,200);assert.match(dashboard.headers.get('content-type'),/text\/html/);application(dashboard,'dashboard document')
  application(await call('/api/identity/session',{token:owner.token,status:200}),'session API');application(await call('/api/identity/session',{status:401}),'rejected API');application(await call('/health',{status:200}),'health')
  application(await call('/this-document-does-not-exist',{status:404}),'missing document')
  const missingDocs=await call('/docs/does-not-exist',{status:404});assert.match(missingDocs.headers.get('content-type'),/text\/html/);application(missingDocs,'missing docs page')
  const script=await request('/widget.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);unframed(script,'widget.js')
  const project=(await call('/api/identity/projects/'+owner.projectId,{token:owner.token})).data
  const preflight=await request('/api/identity/widget/session',{method:'OPTIONS',headers:{Origin:customer,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),customer)
  const contact=await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:customer},status:201});assert.equal(contact.headers.get('access-control-allow-origin'),customer);assert.equal(contact.headers.get('x-content-type-options'),'nosniff');assert.ok(contact.data.token)
  const foreign=await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:'https://foreign.example.test'},status:403});assert.equal(foreign.headers.get('access-control-allow-origin'),null)
  for(const path of [`/help/${owner.projectId}`,`/${owner.projectId}`,`/${owner.projectId}/search?keyword=help`]){const response=await request(path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/text\/html/,path);unframed(response,path);assert.equal(response.headers.get('x-content-type-options'),'nosniff',path);assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin',path)}
  const preview=await request(`/preview/${owner.projectId}/not-a-grant/`);assert.equal(preview.status,404);unframed(preview,'preview on app origin')
 })
 // A configured RER management origin may frame the operator app, without a conflicting X-Frame-Options.
 await withRuntime({vars:{RER_MANAGEMENT_ORIGIN:'https://manage.example.test'}},async(runtime,{request})=>{
  for(const path of ['/','/login'])application(await request(path),path,"frame-ancestors 'self' https://manage.example.test",null)
  unframed(await request('/widget.js'),'managed widget.js')
 })
})

// Sends a body to the emitted Worker over a raw socket and reports the response status.
function upload(origin,path,{chunks=[],stall=false,headers={}}){
 return new Promise((done,fail)=>{const target=new URL(path,origin);const req=httpRequest({host:target.hostname,port:target.port,path:target.pathname,method:'POST',headers:{'Transfer-Encoding':'chunked',...headers}},response=>{response.resume();response.once('end',()=>{req.destroy();done(response.statusCode)})});req.on('error',error=>{if(stall&&error.code==='ECONNRESET')return;fail(error)});for(const chunk of chunks)req.write(chunk);if(!stall)req.end()})
}

test('rejected uploads keep their own response: drained 404, oversized 413, stalled 408, untrusted origin 403 and unauthenticated media 401',async()=>{
 await withRuntime({},async(runtime,{call,request})=>{
  const {origin}=runtime
  // Repeated unknown uploads exercise the workerd proxy/body-discard race; each is its own request, never a retry.
  for(const method of ['POST','PUT'])for(const body of [undefined,{}])for(let index=0;index<32;index++){const response=await call('/api/unknown-upload-route',{method,body});assert.equal(response.status,404,`${method} unknown upload ${index}`)}
  assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(32),Buffer.alloc(32),Buffer.alloc(32)]}),404,'a finite unknown upload is drained and keeps its 404')
  assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(40000),Buffer.alloc(40000)],stall:true}),413,'an oversized unknown upload is cut off')
  const started=Date.now();assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(8)],stall:true}),408,'a stalled unknown upload times out');assert.ok(Date.now()-started<15000)
  // Authentication fails before any media parsing, and the response still arrives intact after the body.
  const media=await request('/api/conversations/absent/media',{method:'POST',raw:true,body:new Uint8Array([0,1,255]),headers:{'Content-Type':'application/octet-stream'}});assert.equal(media.status,401);assert.deepEqual(await media.json(),{error:'Authentication required'})
  for(const method of ['POST','PUT'])for(let index=0;index<64;index++){
   const response=await request('/api/identity/local-owner-session',{method,body:{rejectedUpload:index},headers:{Origin:'https://untrusted.example'}}),body=await response.text()
   assert.equal(response.status,403,`${method} rejected origin ${index}: ${body}`);assert.deepEqual(JSON.parse(body),{error:'Origin not allowed'});assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
  }
 })
})

test('default limits refuse excess widget sessions and visitor messages with a readable Retry-After and store nothing refused',async()=>{
 await withRuntime({},async(runtime,{call})=>{
  const widgetOrigin='https://customer-site.example'
  const owner=(await call('/api/identity/bootstrap',{body:{password:'synthetic-test-setup-password-123',name:'Limits project',email:'limits-owner@example.com',allowedOrigin:widgetOrigin},status:201})).data
  await runtime.presenceAwayOff(owner.projectId)
  const project=(await call('/api/identity/projects/'+owner.projectId,{token:owner.token})).data
  // Each burst must fall inside one UTC-aligned window of the limit it exercises.
  await awaitWindowRoom(3600,30000)
  const statuses=[],sessions=[]
  for(let index=0;index<40;index++){const response=await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:widgetOrigin}});statuses.push(response.status);if(response.status===201)sessions.push(response.data);else{assert.equal(response.status,429);assert.equal(response.data.limit,'widgetSessionsPerIpHour');assert.ok(Number(response.headers.get('Retry-After'))>=1);assert.equal(response.headers.get('Access-Control-Allow-Origin'),widgetOrigin);assert.match(response.headers.get('Access-Control-Expose-Headers')||'',/Retry-After/)}}
  const admittedSessions=statuses.filter(status=>status===201).length;assert.ok(admittedSessions>0&&admittedSessions<40);assert.deepEqual(statuses,[...Array(admittedSessions).fill(201),...Array(40-admittedSessions).fill(429)])
  const visitor=sessions[0],conversation=(await call('/api/conversations',{body:{projectId:owner.projectId},token:visitor.token,headers:{Origin:widgetOrigin}})).data
  await awaitWindowRoom(60,10000)
  const sent=[]
  for(let index=0;index<30;index++){const response=await call(`/api/conversations/${conversation.id}/messages`,{body:{localId:'rapid-'+index,content:'Rapid message '+index,expectedRevision:sent.filter(status=>status===200).length},token:visitor.token,headers:{Origin:widgetOrigin}});sent.push(response.status);if(response.status===429){assert.equal(response.data.limit,'messagesPerConversationMinute');assert.ok(Number(response.headers.get('Retry-After'))<=60)}}
  const admittedMessages=sent.filter(status=>status===200).length;assert.ok(admittedMessages>0&&admittedMessages<30);assert.deepEqual(sent,[...Array(admittedMessages).fill(200),...Array(30-admittedMessages).fill(429)])
  const transcript=(await call(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,headers:{Origin:widgetOrigin}})).data;assert.equal(transcript.messages.length,admittedMessages,'refused messages are not stored')
 })
})

test('message admission under contention: one writer per revision, exact replay, refused collisions, foreign media and stale operator frontiers',async()=>{
 await mobileAdmission()
 await withRuntime({},async(runtime,{call})=>{
  const tenant=await runtime.seedTenant({name:'Admission',email:'admission@native.test',allowedOrigin:runtime.origin}),other=await runtime.seedTenant({name:'Admission other',email:'admission-other@native.test',allowedOrigin:runtime.origin})
  await runtime.presenceAwayOff(tenant.projectId)
  const project=(await call(`/api/identity/projects/${tenant.projectId}`,{token:tenant.token})).data
  const visitor=(await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:runtime.origin},status:201})).data
  const conversation=(await call('/api/conversations',{body:{projectId:tenant.projectId},token:visitor.token,status:201})).data,path=`/api/conversations/${conversation.id}/messages`
  const [one,two]=await Promise.all(['one','two'].map(localId=>call(path,{body:{localId,content:'Hello '+localId,expectedRevision:0},token:visitor.token})))
  assert.deepEqual([one.status,two.status].sort(),[200,409],'competing revisions accept one writer');const accepted=(one.status===200?one:two).data.message
  assert.equal((await call(path,{body:{localId:accepted.local_id,content:accepted.content,expectedRevision:0},token:visitor.token,status:200})).data.duplicate,true,'exact replay is a duplicate')
  assert.equal((await call(path,{body:{localId:accepted.local_id,content:'changed',expectedRevision:0},token:visitor.token})).data.accepted,false,'a changed command under the same local id is refused')
  // Media uploaded to another workspace's conversation cannot be attached here.
  const otherProject=(await call(`/api/identity/projects/${other.projectId}`,{token:other.token})).data,otherVisitor=(await call('/api/identity/widget/session',{body:{widgetKey:otherProject.widget_key},headers:{Origin:runtime.origin},status:201})).data
  const otherConversation=(await call('/api/conversations',{body:{projectId:other.projectId},token:otherVisitor.token,status:201})).data
  const foreignMedia=await fetch(runtime.origin+`/api/conversations/${otherConversation.id}/media`,{method:'POST',headers:{Authorization:'Bearer '+otherVisitor.token,'Content-Type':'text/plain','X-Filename':'foreign.txt'},body:'foreign'});assert.equal(foreignMedia.status,201);const foreignId=(await foreignMedia.json()).id
  assert.equal((await call(path,{body:{localId:'media',content:'attached',expectedRevision:1,mediaIds:[foreignId]},token:visitor.token})).data.accepted,false)
  assert.equal((await call(`/api/conversations/${conversation.id}/media/${foreignId}`,{token:visitor.token})).status,404)
  assert.equal((await call(path,{body:{localId:'stale',content:'Stale reply',expectedRevision:1,expectedLastMessageId:'not-current'},token:tenant.token})).data.accepted,false,'an operator reply on a stale frontier is refused')
  const takeover=await call(path,{body:{localId:'operator',content:'Operator reply',expectedRevision:1,expectedLastMessageId:accepted.id},token:tenant.token,status:200});assert.equal(takeover.data.accepted,true)
  const detail=(await call(`/api/dashboard/projects/${tenant.projectId}/conversations?view=all`,{token:tenant.token})).data.data.find(row=>row.id===conversation.id);assert.equal(detail.assigned_to,tenant.userId,'an operator reply takes the conversation')
  const transcript=(await call(path,{token:visitor.token})).data;assert.deepEqual(transcript.messages.map(m=>m.local_id),[accepted.local_id,'operator']);assert.equal(transcript.revision,2)
 })
})

test('the native HTTP transport pairs actual connectors once across the idle boundary, keeps the visitor socket live, and a dropped proxy write consumes nothing',async()=>{
 await withRuntime({},async(runtime,{call})=>{
  const fixtureBin=join(runtime.directory,'provider-bin');await mkdir(fixtureBin);await symlink(resolve('tests/helpers/hero/codex.mjs'),join(fixtureBin,'codex'))
  const connectorEnv={...process.env,PATH:fixtureBin+':'+process.env.PATH}
  const emitted=JSON.parse(await readFile(resolve('dist/server/wrangler.json'),'utf8')),isolated=JSON.parse(await readFile(join(runtime.directory,'wrangler.json'),'utf8'))
  for(const key of ['compatibility_date','compatibility_flags','rules','durable_objects','migrations'])assert.deepEqual(isolated[key],emitted[key],key)
  const tenant=await runtime.seedTenant({name:'Native transport',email:'transport@native.test',allowedOrigin:runtime.origin})
  await runtime.presenceAwayOff(tenant.projectId)
  const json=async(path,body,token=tenant.token)=>{const response=await call(path,{body,token,headers:{Origin:runtime.origin}});assert.match(response.headers.get('Content-Type'),/application\/json/,`${response.status}`);return response}
  const project=await json(`/api/identity/projects/${tenant.projectId}`);const visitor=await json('/api/identity/widget/session',{widgetKey:project.data.widget_key});assert.equal(visitor.status,201)
  const conversation=await json('/api/conversations',{projectId:tenant.projectId},visitor.data.token);assert.equal(conversation.status,201)
  const frames=[],socket=new WebSocket(runtime.origin.replace('http:','ws:')+`/api/conversations/${conversation.data.id}/socket?token=${visitor.data.token}`)
  try{
   socket.addEventListener('message',event=>frames.push(JSON.parse(event.data)))
   await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('native socket open timeout')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);done()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);fail(Error('native socket upgrade failed'))},{once:true})})
   // Fresh capabilities straddle workerd's five-second HTTP idle boundary; each connector child sends its pairing once.
   for(const idleMs of [4990,5010]){
    const pairings=await Promise.all([0,1].map(async()=>(await json(`/api/projects/${tenant.projectId}/local-agents/pairings`,{})).data.data))
    await new Promise(done=>setTimeout(done,idleMs))
    await Promise.all(pairings.map(async(pairing,index)=>{
     const configPath=join(runtime.directory,`connector-${idleMs}-${index}.json`)
     const child=await exec(process.execPath,[resolve('local-agent/bin/h2h-local.mjs'),'connect','--server',runtime.origin,'--code',pairing.code,'--provider','codex','--name',`Native ${idleMs}-${index}`,'--workdir',runtime.directory],{cwd:runtime.directory,env:{...connectorEnv,H2H_LOCAL_CONFIG:configPath},timeout:20000})
     assert.match(child.stdout,/Paired this computer with HappyToHelp/)
     const config=JSON.parse(await readFile(configPath,'utf8'));assert.equal(config.server,runtime.origin);assert.ok(config.device.id);assert.ok(config.token)
     const replay=await json('/api/local-agents/pair',{code:pairing.code,name:'Reused',provider:'codex'},'');assert.equal(replay.status,401);assert.match(replay.data.error,/used/)
    }))
    assert.equal(socket.readyState,WebSocket.OPEN,'visitor socket remains connected across idle HTTP/CLI pairing')
   }
   const sql=await runtime.execute(`SELECT COUNT(*) AS redeemed FROM local_pairings WHERE project_id='${tenant.projectId}' AND redeemed_at IS NOT NULL; SELECT COUNT(*) AS devices FROM local_devices WHERE project_id='${tenant.projectId}'; SELECT COUNT(*) AS duplicate_devices FROM (SELECT pairing_id FROM local_devices GROUP BY pairing_id HAVING COUNT(*)>1);`)
   assert.match(sql,/"redeemed": 4/);assert.match(sql,/"devices": 4/);assert.match(sql,/"duplicate_devices": 0/)
   const sent=await json(`/api/conversations/${conversation.data.id}/messages`,{localId:'native-transport-message',content:'Native HTTP and WebSocket agree.',expectedRevision:0},visitor.data.token);assert.equal(sent.status,200)
   const deadline=Date.now()+8000;while(!frames.some(frame=>frame.message?.id===sent.data.message.id)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25))
   assert.deepEqual(frames.filter(frame=>frame.type==='message').map(frame=>frame.message.id),[sent.data.message.id])
  }finally{socket.close()}
  // A TCP fault before any bytes reach the application fails once and consumes no capability.
  const proxy=await proxyFaultProbe(runtime.origin)
  try{
   assert.equal((await fetch(proxy.origin+'/health')).status,200)
   const pairing=(await json(`/api/projects/${tenant.projectId}/local-agents/pairings`,{})).data.data
   const forwarded=proxy.forwarded;proxy.drop()
   const failed=await fetch(proxy.origin+'/api/local-agents/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pairing.code,name:'Transport cause',provider:'codex',capabilities:['terminal']})})
   assert.equal(failed.status,500);await failed.text();assert.equal(proxy.dropped,1);assert.equal(proxy.forwarded,forwarded,'the failed POST forwarded no application bytes')
   const unconsumed=await runtime.execute(`SELECT COUNT(*) AS redeemed FROM local_pairings WHERE id='${pairing.id}' AND redeemed_at IS NOT NULL;`);assert.match(unconsumed,/"redeemed": 0/)
   const direct=await json('/api/local-agents/pair',{code:pairing.code,name:'Native cause',provider:'codex',capabilities:['terminal']},'');assert.equal(direct.status,200);assert.equal(direct.data.data.pairing_id,pairing.id)
  }finally{await proxy.close()}
 })
})

// Splits migration SQL into statements, tracking quotes, comments and trigger blocks.
function splitSql(source){
 const statements=[];let start=0,quote=null,line=false,block=false,word='',trigger=false,depth=0
 const token=()=>{if(!word)return;const value=word.toUpperCase();if(value==='TRIGGER')trigger=true;if(trigger&&(value==='BEGIN'||value==='CASE'))depth++;if(trigger&&value==='END')depth--;word=''}
 for(let i=0;i<source.length;i++){const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue}if(block){if(c==='*'&&next==='/'){block=false;i++}continue}if(quote){if(c===quote){if(next===quote)i++;else quote=null}continue}if(c==='-'&&next==='-'){token();line=true;i++;continue}if(c==='/'&&next==='*'){token();block=true;i++;continue}if(c==="'"||c==='"'||c==='`'){token();quote=c;continue}if(/[a-zA-Z_]/.test(c)){word+=c;continue}token();if(c===';'&&depth===0){const sql=source.slice(start,i+1).trim();if(sql)statements.push(sql);start=i+1;trigger=false}}
 if(source.slice(start).trim())statements.push(source.slice(start).trim());return statements
}

test('deleting a workspace revokes membership atomically and stops its queued training, context and brand work before any provider call',async()=>{
 const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done))
 const origin=`http://127.0.0.1:${port}`,temp=await mkdtemp(join(tmpdir(),'h2h-deleted-background-'));let child,logs=''
 try{
  const migrationPath=join(temp,'migrations.json');await writeFile(migrationPath,JSON.stringify(await Promise.all((await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort().map(async name=>({name,statements:splitSql(await readFile('migrations/'+name,'utf8'))})))))
  execFileSync('node_modules/.bin/esbuild',['tests/deleted-background-worker.ts','--bundle','--format=esm','--platform=node','--loader:.sql=text','--external:cloudflare:*',`--alias:migration-fixtures=${migrationPath}`,`--outfile=${temp}/worker.js`],{stdio:'pipe'})
  await writeFile(join(temp,'wrangler.json'),JSON.stringify({name:'h2h-deleted-background-test',main:'worker.js',compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:'test',database_id:'test'}],r2_buckets:[{binding:'FILES',bucket_name:'test'}]}))
  child=spawn(resolve('node_modules/.bin/wrangler'),['dev','--config',join(temp,'wrangler.json'),'--port',String(port),'--persist-to',join(temp,'state')],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d)
  let ready=false;for(let i=0;i<300&&!ready;i++){try{ready=(await fetch(origin+'/')).ok}catch{}if(!ready)await new Promise(done=>setTimeout(done,100))}
  assert.ok(ready,logs)
  const response=await fetch(origin+'/test'),raw=await response.text();let result;try{result=JSON.parse(raw)}catch{throw new Error(raw+'\n'+logs)}
  assert.ok(response.ok,JSON.stringify(result));assert.equal(result.providerCalls,0);assert.ok(result.passed>10)
 }finally{child?.kill('SIGTERM');if(child&&child.exitCode===null)await new Promise(done=>child.once('exit',done));await rm(temp,{recursive:true,force:true})}
})
