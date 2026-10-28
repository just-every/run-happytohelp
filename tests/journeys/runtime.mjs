import test from 'node:test'
import assert from 'node:assert/strict'
import {request as httpRequest} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {proxyFaultProbe} from '../helpers/emitted-runtime-proxy-fault.mjs'
import {client} from './kit/http.mjs'

const exec=promisify(execFile)
async function withRuntime(options,body){const runtime=await createRuntime(options);let success=false;try{await body(runtime,client(runtime.origin));success=true}finally{await runtime.close(success)}}

// The broad emitted-Worker smoke was retired: native identity, site surface,
// admission and socket journeys own its assertions without another installation.
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
  const {origin}=runtime
  // Repeated unknown uploads exercise the workerd proxy/body-discard race; each is its own request, never a retry.
  for(const method of ['POST','PUT'])for(const body of [undefined,{}])for(let index=0;index<1;index++){const response=await call('/api/unknown-upload-route',{method,body});assert.equal(response.status,404,`${method} unknown upload ${index}`)}
  assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(32),Buffer.alloc(32),Buffer.alloc(32)]}),404,'a finite unknown upload is drained and keeps its 404')
  assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(40000),Buffer.alloc(40000)],stall:true}),413,'an oversized unknown upload is cut off')
  const started=Date.now();assert.equal(await upload(origin,'/api/unknown-upload-route',{chunks:[Buffer.alloc(8)],stall:true}),408,'a stalled unknown upload times out');assert.ok(Date.now()-started<15000)
  // Authentication fails before any media parsing, and the response still arrives intact after the body.
  const media=await request('/api/conversations/absent/media',{method:'POST',raw:true,body:new Uint8Array([0,1,255]),headers:{'Content-Type':'application/octet-stream'}});assert.equal(media.status,401);assert.deepEqual(await media.json(),{error:'Authentication required'})
  for(const method of ['POST','PUT'])for(let index=0;index<1;index++){
   const response=await request('/api/identity/local-owner-session',{method,body:{rejectedUpload:index},headers:{Origin:'https://untrusted.example'}}),body=await response.text()
   assert.equal(response.status,403,`${method} rejected origin ${index}: ${body}`);assert.deepEqual(JSON.parse(body),{error:'Origin not allowed'});assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
  }

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

test('native conversation transport: guarded admission, durable attachments, connector pairing and socket survival through idle and proxy failure',async()=>{
 await withRuntime({},async(runtime,{call})=>{
  const tenant=await runtime.seedTenant({name:'Admission',email:'admission@native.test',allowedOrigin:runtime.origin}),other=await runtime.seedTenant({name:'Admission other',email:'admission-other@native.test',allowedOrigin:runtime.origin})
  await runtime.presenceAwayOff(tenant.projectId)
  const project=(await call(`/api/identity/projects/${tenant.projectId}`,{token:tenant.token})).data
  const visitor=(await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:runtime.origin},status:201})).data
  const conversation=(await call('/api/conversations',{body:{projectId:tenant.projectId},token:visitor.token,status:201})).data,path=`/api/conversations/${conversation.id}/messages`
  const inbox=async()=>{const [counts,list]=await Promise.all(['/counts','?view=all'].map(async suffix=>(await call(`/api/dashboard/projects/${tenant.projectId}/conversations${suffix}`,{token:tenant.token,status:200})).data.data));return {unassigned:counts.unassigned,mine:counts.mine,listed:list.some(row=>row.id===conversation.id)}}
  const empty=await inbox();assert.equal(empty.listed,false)
  const upload=await fetch(runtime.origin+`/api/conversations/${conversation.id}/media`,{method:'POST',headers:{Authorization:'Bearer '+visitor.token,'Content-Type':'text/plain','X-Filename':'receipt.txt'},body:'journey attachment bytes\n'});assert.equal(upload.status,201);const media=await upload.json();assert.equal(media.filename,'receipt.txt');assert.equal(media.size,25)
  const [one,two]=await Promise.all(['one','two'].map(localId=>call(path,{body:{localId,content:'Hello '+localId,expectedRevision:0,mediaIds:[media.id]},token:visitor.token})))
  assert.deepEqual([one.status,two.status].sort(),[200,409],'competing revisions accept one writer');const accepted=(one.status===200?one:two).data.message
  assert.equal((await call(path,{body:{localId:accepted.local_id,content:accepted.content,expectedRevision:0,mediaIds:[media.id]},token:visitor.token,status:200})).data.duplicate,true,'exact replay is a duplicate')
  assert.equal((await call(path,{body:{localId:accepted.local_id,content:'changed',expectedRevision:0},token:visitor.token})).data.accepted,false,'a changed command under the same local id is refused')
  assert.deepEqual(await inbox(),{unassigned:empty.unassigned+1,mine:empty.mine,listed:true})
  const initial=(await call(path,{token:visitor.token,status:200})).data;assert.equal(initial.messages.length,1);assert.equal(initial.revision,1);assert.equal(initial.messages[0].media[0].id,media.id)
  const download=await fetch(runtime.origin+`/api/conversations/${conversation.id}/media/${media.id}`,{headers:{Authorization:'Bearer '+visitor.token}});assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'text/plain');assert.match(download.headers.get('Content-Disposition'),/^inline;/);assert.match(download.headers.get('Content-Disposition'),/receipt\.txt/);assert.equal(await download.text(),'journey attachment bytes\n')
  assert.equal((await call(path,{token:other.token})).status,404);assert.equal((await call(`/api/conversations/${conversation.id}`,{token:other.token})).status,404)
  // Media uploaded to another workspace's conversation cannot be attached here.
  const otherProject=(await call(`/api/identity/projects/${other.projectId}`,{token:other.token})).data,otherVisitor=(await call('/api/identity/widget/session',{body:{widgetKey:otherProject.widget_key},headers:{Origin:runtime.origin},status:201})).data
  const otherConversation=(await call('/api/conversations',{body:{projectId:other.projectId},token:otherVisitor.token,status:201})).data
  const foreignMedia=await fetch(runtime.origin+`/api/conversations/${otherConversation.id}/media`,{method:'POST',headers:{Authorization:'Bearer '+otherVisitor.token,'Content-Type':'text/plain','X-Filename':'foreign.txt'},body:'foreign'});assert.equal(foreignMedia.status,201);const foreignId=(await foreignMedia.json()).id
  assert.equal((await call(path,{body:{localId:'media',content:'attached',expectedRevision:1,mediaIds:[foreignId]},token:visitor.token})).data.accepted,false)
  assert.equal((await call(`/api/conversations/${conversation.id}/media/${foreignId}`,{token:visitor.token})).status,404)
  assert.equal((await call(path,{body:{localId:'stale',content:'Stale reply',expectedRevision:1,expectedLastMessageId:'not-current'},token:tenant.token})).data.accepted,false,'an operator reply on a stale frontier is refused')
  const takeover=await call(path,{body:{localId:'operator',content:'Operator reply',expectedRevision:1,expectedLastMessageId:accepted.id},token:tenant.token,status:200});assert.equal(takeover.data.accepted,true)
  const detail=(await call(`/api/dashboard/projects/${tenant.projectId}/conversations?view=all`,{token:tenant.token})).data.data.find(row=>row.id===conversation.id);assert.equal(detail.assigned_to,tenant.userId,'an operator reply takes the conversation')
  assert.deepEqual(await inbox(),{unassigned:empty.unassigned,mine:empty.mine+1,listed:true})
  assert.ok((await call('/api/conversations',{token:tenant.token,status:200})).data.conversations.some(row=>row.id===conversation.id))
  const noAi=await call(`/api/ai-support/projects/${tenant.projectId}/conversations/${conversation.id}/generations`,{token:tenant.token,body:{expectedRevision:2},status:409});assert.match(noAi.data.error,/CONFIGURATION_REQUIRED/)
  const transcript=(await call(path,{token:visitor.token})).data;assert.deepEqual(transcript.messages.map(m=>m.local_id),[accepted.local_id,'operator']);assert.equal(transcript.revision,2)
  await connectorTransport(runtime,call,{tenant,visitor,conversation})
 })
})

async function connectorTransport(runtime,call,state){
 const {tenant}=state
  const fixtureBin=join(runtime.directory,'provider-bin');await mkdir(fixtureBin);await symlink(resolve('tests/helpers/hero/codex.mjs'),join(fixtureBin,'codex'))
  const connectorEnv={...process.env,PATH:fixtureBin+':'+process.env.PATH}
  const json=async(path,body,token=tenant.token)=>{const response=await call(path,{body,token,headers:{Origin:runtime.origin}});assert.match(response.headers.get('Content-Type'),/application\/json/,`${response.status}`);return response}
  const visitor={data:state.visitor},conversation={data:state.conversation}
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
   const frontier=(await call(`/api/conversations/${conversation.data.id}/messages`,{token:visitor.data.token})).data
   const sent=await json(`/api/conversations/${conversation.data.id}/messages`,{localId:'native-transport-message',content:'Native HTTP and WebSocket agree.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.lastMessageId},visitor.data.token);assert.equal(sent.status,200)
   const deadline=Date.now()+8000;while(!frames.some(frame=>frame.message?.id===sent.data.message.id)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25))
   assert.deepEqual(frames.filter(frame=>frame.type==='message').map(frame=>frame.message.id),[...frontier.messages.map(message=>message.id),sent.data.message.id],'socket replays the existing thread then delivers its new message exactly once')
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

}
