import {mobileAdmission} from '../helpers/mobile.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {admissionRaces} from '../helpers/conversation/admission-races.mjs'
import {proxyFaultProbe} from '../helpers/emitted-runtime-proxy-fault.mjs'
import {client} from './kit/http.mjs'
const exec=promisify(execFile)

// Real transport, with a pong barrier so absence/duplicate assertions see all replayed frames.
async function deliverySocket(origin,conversationId,token,after=0){
 const frames=[],waiters=[],socket=new WebSocket(origin.replace('http:','ws:')+`/api/conversations/${conversationId}/socket?token=${token}&after=${after}`)
 // Repeated cleanup reuses the event observed from creation, including a
 // socket closed by a Worker restart before close() is called again.
 const closed=new Promise(done=>socket.addEventListener('close',done,{once:true}))
 socket.addEventListener('message',event=>{frames.push(JSON.parse(event.data));for(const wake of waiters.splice(0))wake()})
 await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',()=>fail(Error('delivery socket upgrade failed')),{once:true})})
 return {socket,async replay(){
  socket.send(JSON.stringify({type:'replay'}))
  await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('delivery replay deadline')),5000);const check=()=>{if(frames.some(frame=>frame.type==='pong')){clearTimeout(timer);done()}else waiters.push(check)};check()})
  return frames.filter(frame=>frame.type==='message')
 },async close(){if(socket.readyState!==WebSocket.CLOSED)socket.close();await closed}}
}

// One emitted application, exercised over its real HTTP and WebSocket transport.
test('a native support session admits and replays one transcript with its own files, refuses foreign and stale writes, delivers live and pairs the shipped connector',async()=>{
 await mobileAdmission()
 const runtime=await createRuntime({});let success=false
 try{
  const {call,request}=client(runtime.origin)
  for(const path of ['/login','/setup','/docs/install']){
   const response=await request(path);assert.equal(response.status,200)
   assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN')
   assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/)
  }
  const script=await request('/widget.js');assert.equal(script.status,200)
  assert.equal(script.headers.get('x-frame-options'),null)
  assert.equal((await request('/api/conversations/missing/media',{method:'POST',raw:true,body:new Uint8Array([0,1,255])})).status,401)
  const rejected=await request('/api/identity/local-owner-session',{body:{},headers:{Origin:'https://foreign.example'}})
  assert.equal(rejected.status,403);assert.equal(rejected.headers.get('set-cookie'),null)
  assert.equal((await call('/api/unknown-upload-route',{body:{}})).status,404)
  const tenant=await runtime.seedTenant({name:'Admission',email:'admission@native.test',allowedOrigin:runtime.origin}),other=await runtime.seedTenant({name:'Admission other',email:'admission-other@native.test',allowedOrigin:runtime.origin})
  await runtime.presenceAwayOff(tenant.projectId)
  const project=(await call(`/api/identity/projects/${tenant.projectId}`,{token:tenant.token})).data
  const visitor=(await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:runtime.origin},status:201})).data
  const conversation=(await call('/api/conversations',{body:{projectId:tenant.projectId},token:visitor.token,status:201})).data,path=`/api/conversations/${conversation.id}/messages`
  const inbox=async()=>{const [counts,list]=await Promise.all(['/counts','?view=all'].map(async suffix=>(await call(`/api/dashboard/projects/${tenant.projectId}/conversations${suffix}`,{token:tenant.token,status:200})).data.data));return {unassigned:counts.unassigned,mine:counts.mine,listed:list.some(row=>row.id===conversation.id)}}
  const empty=await inbox();assert.equal(empty.listed,false)
  const upload=await fetch(runtime.origin+`/api/conversations/${conversation.id}/media`,{method:'POST',headers:{Authorization:'Bearer '+visitor.token,'Content-Type':'text/plain','X-Filename':'receipt.txt'},body:'journey attachment bytes\n'});assert.equal(upload.status,201);const media=await upload.json();assert.equal(media.filename,'receipt.txt');assert.equal(media.size,25)
  const frames=[],socket=new WebSocket(runtime.origin.replace('http:','ws:')+`/api/conversations/${conversation.id}/socket?token=${visitor.token}`)
  socket.addEventListener('message',event=>frames.push(JSON.parse(event.data)))
  await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',()=>fail(Error('socket upgrade failed')),{once:true})})
  const operator=await deliverySocket(runtime.origin,conversation.id,tenant.token)
  try{
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
  await new Promise(done=>setTimeout(done,100))
  assert.deepEqual(frames.filter(frame=>frame.type==='message').map(frame=>frame.message.id),[accepted.id,takeover.data.message.id])
  // A real downloaded connector pairs after the HTTP idle boundary without ending live delivery.
  const fixtureBin=join(runtime.directory,'provider-bin');await mkdir(fixtureBin)
  await symlink(resolve('tests/helpers/hero/codex.mjs'),join(fixtureBin,'codex'))
  const pairing=(await call(`/api/projects/${tenant.projectId}/local-agents/pairings`,{token:tenant.token,body:{},status:200})).data.data
  await new Promise(done=>setTimeout(done,5010))
  const configPath=join(runtime.directory,'connector.json')
  await exec(process.execPath,[resolve('local-agent/bin/h2h-local.mjs'),'connect','--server',runtime.origin,'--code',pairing.code,'--provider','codex','--name','Support laptop','--workdir',runtime.directory],{env:{...process.env,PATH:fixtureBin+':'+process.env.PATH,H2H_LOCAL_CONFIG:configPath},timeout:20000})
  const configured=JSON.parse(await readFile(configPath,'utf8'))
  assert.equal(configured.server,runtime.origin);assert.ok(configured.device.id);assert.ok(configured.token)
  assert.equal((await call('/api/local-agents/pair',{body:{code:pairing.code,name:'Replay',provider:'codex'}})).status,401)
  assert.equal(socket.readyState,WebSocket.OPEN)
  const proxy=await proxyFaultProbe(runtime.origin)
  try{
   const next=(await call(`/api/projects/${tenant.projectId}/local-agents/pairings`,{token:tenant.token,body:{}})).data.data
   const forwarded=proxy.forwarded;proxy.drop()
   const dropped=await fetch(proxy.origin+'/api/local-agents/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:next.code,name:'Dropped',provider:'codex',capabilities:['terminal']})})
   assert.equal(dropped.status,500);await dropped.text();assert.equal(proxy.forwarded,forwarded)
   assert.equal((await call('/api/local-agents/pair',{body:{code:next.code,name:'Recovered',provider:'codex',capabilities:['terminal']}})).status,200)
  }finally{await proxy.close()}
  const operatorFrames=await operator.replay();assert.deepEqual(operatorFrames.map(frame=>frame.message.id),[accepted.id,takeover.data.message.id],'operator receives the same committed live messages')
  const cursor=frames.filter(frame=>frame.type==='message').at(-1).eventId
  assert.equal(operatorFrames.at(-1).eventId,cursor)
  await new Promise(done=>{socket.addEventListener('close',done,{once:true});socket.close()});await operator.close()
  // Both clients miss an attachment-bearing commit. Catch up by durable cursor,
  // then restart the actual Worker and reload the complete transcript from disk.
  const missedUpload=await request(`/api/conversations/${conversation.id}/media`,{token:tenant.token,method:'POST',raw:true,headers:{'Content-Type':'text/plain','X-Filename':'offline.txt'},body:'committed while disconnected\n'});assert.equal(missedUpload.status,201)
  const missedMedia=await missedUpload.json()
  const offline=(await call(path,{token:tenant.token,body:{localId:'offline',content:'Reply with the recovered file',expectedRevision:2,expectedLastMessageId:takeover.data.message.id,mediaIds:[missedMedia.id]},status:200})).data
  assert.equal(offline.accepted,true)
  const committed=(await call(path,{token:visitor.token,status:200})).data
  const recover=async(after,ids)=>{
   let eventId
   for(const token of [visitor.token,tenant.token]){
    const reconnected=await deliverySocket(runtime.origin,conversation.id,token,after)
    try{
     const recovered=await reconnected.replay()
     assert.deepEqual(recovered.map(frame=>frame.message.id),ids,'widget and operator recover each committed message exactly once')
     for(const frame of recovered){
      const original=committed.messages.find(message=>message.id===frame.message.id)
      assert.equal(frame.conversationId,conversation.id);assert.ok(Number(frame.eventId)>Number(after))
      assert.deepEqual([frame.message.content,frame.message.revision,frame.message.local_id],[original.content,original.revision,original.local_id])
      assert.deepEqual(frame.message.media.map(file=>[file.id,file.filename,file.content_type,file.size]),original.media.map(file=>[file.id,file.filename,file.content_type,file.size]))
     }
     const file=await request(`/api/conversations/${conversation.id}/media/${missedMedia.id}`,{token,status:200});assert.equal(file.status,200);assert.equal(await file.text(),'committed while disconnected\n')
     if(eventId)assert.equal(recovered.at(-1).eventId,eventId,'both roles replay the same durable event')
     eventId=recovered.at(-1).eventId
    }finally{await reconnected.close()}
   }
   return eventId
  }
  // Keep both roles in each recovery round; the durable cursor is unchanged by restart.
  const eventId=await recover(cursor,[offline.message.id])
  await runtime.restart()
  assert.deepEqual((await call(path,{token:visitor.token,status:200})).data,committed,'restart preserves the committed transcript, revision, frontier and attachment metadata')
  await recover(cursor,[offline.message.id])
  await recover(0,committed.messages.map(message=>message.id))
  const caughtUp=await deliverySocket(runtime.origin,conversation.id,visitor.token,eventId)
  try{assert.deepEqual(await caughtUp.replay(),[],'an acknowledged cursor never repeats a committed message')}finally{await caughtUp.close()}
  assert.equal((await call(path,{token:other.token})).status,404,'foreign authority cannot recover the restarted transcript')
  const unauthorized=await request(`/api/conversations/${conversation.id}/socket?token=${other.token}&after=${cursor}`);assert.equal(unauthorized.status,404,'foreign authority cannot replay the durable cursor')
  }finally{socket.close();await operator.close()}

  success=true
 }finally{await runtime.close(success)}
 await admissionRaces()
})
