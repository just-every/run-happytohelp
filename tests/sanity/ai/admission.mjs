import test from 'node:test'
import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {awaitWindowRoom} from '../../helpers/window-room.mjs'

test('widget admission bounds a visitor from session through messages and files while another workspace keeps its own capacity',async()=>{
 const limits={widgetSessionsPerIpHour:2,widgetSessionsPerProjectHour:3,conversationsPerContactHour:1,messagesPerConversationMinute:2,uploadsPerContactDay:1,uploadBytesPerContactDay:500}
 const app=await startApp({bindings:{RATE_LIMITS:JSON.stringify(limits)}})
 try{
  await awaitWindowRoom(60,8000)
  const workspace=await app.seedWorkspace('bounded',{allowedOrigin:'https://widget.example'}),other=await app.seedWorkspace('independent',{allowedOrigin:'https://widget.example'})
  const call=(path,{body,token,ip='198.51.100.7',headers={}}={})=>app.request(path,{body,token,raw:body instanceof Uint8Array,headers:{Origin:'https://widget.example','CF-Connecting-IP':ip,...headers}})
  const limited=async response=>{assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal((await response.json()).code,'rate_limited')}
  const session=ws=>call('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey}})
  const first=await session(workspace);assert.equal(first.status,201);const visitor=await first.json()
  assert.equal((await session(workspace)).status,201);await limited(await session(workspace))
  assert.equal((await session(other)).status,201,'address capacity is scoped by workspace')
  const create=()=>call('/api/conversations',{token:visitor.token,body:{projectId:workspace.projectId}})
  const created=await create();assert.equal(created.status,201);const conversation=await created.json(),path=`/api/conversations/${conversation.id}`
  await limited(await create())
  const transcript=async()=>(await call(path+'/messages',{token:visitor.token})).json()
  const send=async content=>{const state=await transcript();return call(path+'/messages',{token:visitor.token,body:{localId:crypto.randomUUID(),content,expectedRevision:state.revision,expectedLastMessageId:state.lastMessageId}})}
  for(let i=0;i<limits.messagesPerConversationMinute;i++)assert.equal((await send('Customer message '+i)).status,200)
  const before=await transcript();await limited(await send('Refused message'));assert.deepEqual(await transcript(),before,'refused messages leave no partial admission')
  const upload=bytes=>call(path+'/media',{token:visitor.token,body:new Uint8Array(bytes).fill(7),headers:{'Content-Type':'application/octet-stream','X-Filename':'note.txt'}})
  await limited(await upload(limits.uploadBytesPerContactDay+1))
  const admitted=await upload(100);assert.equal(admitted.status,201,'a byte refusal returns its reserved upload count')
  const media=await admitted.json();assert.ok(media.id)
  await limited(await upload(100))
  const downloaded=await call(`${path}/media/${media.id}`,{token:visitor.token});assert.equal(downloaded.status,200);assert.equal((await downloaded.arrayBuffer()).byteLength,100)
 }finally{await app.close()}
})
