import assert from 'node:assert/strict'
import {holdLostResponse} from './response-loss.mjs'
import {startApp} from '../../journeys/kit/app.mjs'
import {generate} from '../../move-in/generator.mjs'

export async function importWriterRaces(){
 const app=await startApp({captureQueue:true,listen:true})
 let loss
 try{
  const w=await app.seedWorkspace('transcript-import'),token=w.tokens.owner,root=`/api/move-in/projects/${w.projectId}/imports`
  const source=generate('intercom',1).trim().split('\n').map(JSON.parse).filter(row=>['contact','conversation'].includes(row.type))
  const upload=async body=>(await app.call(root+'?vendor=intercom',{token,raw:true,body,headers:{'X-Import-Filename':'history.jsonl','X-Import-Schema':'2.16','Content-Type':'application/octet-stream'},status:201})).data.data
  const view=async run=>(await app.call(`${root}/${run.id}`,{token,status:200})).data.data
  const job=run=>({type:'move-in',id:run.id,projectId:w.projectId})
  const advance=async run=>{const result=await app.runJobs([job(run)]);assert.deepEqual(result.retried,[]);await app.takeJobs();return view(run)}
  const until=async(run,predicate)=>{for(let i=0;i<30;i++){const state=await advance(run);if(predicate(state))return state;assert.equal(state.error,null,JSON.stringify(state))}throw Error('import did not reach its checkpoint')}
  const body=source.map(JSON.stringify).join('\n'),one=await upload(body),two=await upload(source.map(row=>JSON.stringify(row,null,0)).join('\n')+'\n')
  assert.notEqual(one.id,two.id,'distinct byte custody, same stable source identities')
  const first=await until(one,s=>s.state==='ready'),second=await until(two,s=>s.state==='ready')
  // Both plans are approved before either writer publishes the shared target.
  loss=await holdLostResponse(app.url,`${root}/${first.id}/apply`,{token,body:{fingerprint:first.plan.fingerprint}})
  assert.equal(loss.committed.status,202)
  assert.equal((await view(first)).state,'applying','the public run recovers the committed approval while its response is held')
  await app.call(`${root}/${first.id}/apply`,{token,body:{fingerprint:first.plan.fingerprint},status:409})
  assert.equal((await app.call(`${root}/${second.id}/apply`,{token,body:{fingerprint:second.plan.fingerprint},status:202})).data.data.state,'applying')
  await loss.close();loss=null
  await until(first,s=>s.state==='completed')
  const listed=(await app.call(`/api/conversations`,{token,status:200})).data.conversations
  assert.equal(listed.length,1)
  const conversation=listed[0],path=`/api/conversations/${conversation.id}/messages`,read=async()=>(await app.call(path,{token,status:200})).data
  const before=await read();assert.equal(before.revision,2)
  assert.deepEqual(before.messages.map(m=>[m.local_id,m.revision]),[['import:source:source-1',1],['import:reply-1',2]])
  const command={localId:'native-final',content:'A native final after import',expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId,resolve:true}
  // The stale import publication and a current native writer run concurrently.
  const [reply]=await Promise.all([app.call(path,{token,body:command,status:200}),advance(second)])
  assert.equal(reply.data.accepted,true)
  const stopped=await until(second,s=>Boolean(s.error)||s.state==='completed')
  assert.equal(stopped.error,'NATIVE_EDIT_CONFLICT','the independently reviewed stale target must not replace current history')
  const after=await read();assert.equal(after.revision,3);assert.equal(after.lastMessageId,reply.data.message.id)
  assert.deepEqual(after.messages.slice(0,2),before.messages,'import identity, revision and content survive the competing writer')
  assert.equal(after.messages[2].content,command.content)
  assert.equal((await app.call(path,{token,body:command,status:200})).data.duplicate,true)
  assert.equal((await app.call(path,{token,body:{...command,content:'Changed final'},status:409})).data.accepted,false)
  // Lost apply acknowledgement and queue redelivery recover by the same run ID;
  // the original upload returns its completed custody without another write.
  const repeated=await app.call(root+'?vendor=intercom',{token,raw:true,body,headers:{'X-Import-Filename':'history.jsonl','X-Import-Schema':'2.16'},status:200})
  assert.equal(repeated.data.data.id,first.id);assert.equal(repeated.data.alreadyImported,true);assert.equal(repeated.data.writes,0)
  await advance(first);await advance(second)
  assert.deepEqual(await read(),after)
  // Administrative reversal is another import writer: it cannot delete a
  // final reply admitted while the owner asks to undo the original history.
  await app.call(`${root}/${first.id}/undo`,{token,body:{},status:202})
  const undo=await until(first,s=>Boolean(s.error)||s.state==='undone')
  assert.equal(undo.error,'NATIVE_EDIT_CONFLICT');assert.deepEqual(await read(),after)
  assert.equal(app.requests.length,0,'import and reversal have no network side effects')
 }finally{if(loss)await loss.close();await app.close()}
}
