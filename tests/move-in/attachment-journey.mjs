import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../journeys/kit/app.mjs'
import {attachmentFixtures,publicBytes,privateBytes} from './attachment-fixtures.mjs'
import {mixedAttachmentErasure} from './attachment-erasure.mjs'

export async function attachmentJourney(){
 const app=await startApp({captureQueue:true})
 try{for(const fixture of attachmentFixtures()){
  console.log('Attachment import: '+fixture.vendor)
  const w=await app.seedWorkspace('attachments-'+fixture.vendor),p=w.projectId,token=w.tokens.owner,imports=`/api/move-in/projects/${p}/imports`
  const upload=body=>app.ok(imports+'?vendor='+fixture.vendor,{token,body,raw:true,headers:{'Content-Type':'application/octet-stream','X-Import-Filename':'history.zip','X-Import-Schema':'2.16'}})
  const apply=async body=>{const uploaded=await upload(body);await app.drainJobs();const run=(await app.ok(imports+'/'+uploaded.data.id,{token})).data;assert.equal(run.state,'ready');assert.equal(run.plan.counts.rejected,0,JSON.stringify(run));await app.ok(imports+'/'+run.id+'/apply',{token,body:{fingerprint:run.plan.fingerprint}});await app.drainJobs();const done=(await app.ok(imports+'/'+run.id,{token})).data;assert.equal(done.state,'completed',JSON.stringify(done));return run}
  const run=await apply(fixture.archive()),ticket=await app.first('SELECT * FROM conversations WHERE project_id=?',p)
  console.log('Attachment publication: '+fixture.vendor)
  const media=await app.sql('SELECT * FROM media WHERE project_id=? ORDER BY filename',p);assert.equal(media.length,2)
  const publicFile=media.find(row=>row.message_id),privateFile=media.find(row=>!row.message_id)
  const download=(file,credential=token)=>app.request(`/api/conversations/${ticket.id}/media/${file.id}`,{token:credential})
  for(const [file,bytes] of [[publicFile,publicBytes],[privateFile,privateBytes]]){const response=await download(file);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)}
  const visitorToken='synthetic-happytohelp-20-'+fixture.vendor
  await app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,'contact',?,?)").bind(createHash('sha256').update(visitorToken).digest('hex'),ticket.contact_id,p,ticket.contact_id,Date.now()+3600000).run()
  const publicRead=await download(publicFile,visitorToken);assert.equal(publicRead.status,200);assert.deepEqual(Buffer.from(await publicRead.arrayBuffer()),publicBytes)
  const privateRead=await download(privateFile,visitorToken);assert.equal(privateRead.status,404,'private note bytes stay operator-only');await privateRead.arrayBuffer()
  assert.equal((await app.first('SELECT count(*) n FROM move_in_note_media WHERE project_id=?',p)).n,1)
  const messages=await app.ok(`/api/conversations/${ticket.id}/messages`,{token:visitorToken})
  assert.equal(messages.messages.flatMap(message=>message.media).length,1,'public history contains only the public attachment')
  // The requester credential above is auth-fixture setup, outside the import.
  // Retire it before exercising undo of otherwise untouched source records.
  await app.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(createHash('sha256').update(visitorToken).digest('hex')).run()
  const before=await app.sql('SELECT * FROM media WHERE project_id=? ORDER BY id',p),second=await apply(fixture.archive({repack:true}))
  assert.deepEqual(await app.sql('SELECT * FROM media WHERE project_id=? ORDER BY id',p),before,'repackaged bytes retain their exact native links and keys')
  for(const id of [second.id,run.id]){await app.ok(imports+'/'+id+'/undo',{token,body:{}});await app.drainJobs();{const undone=(await app.ok(imports+'/'+id,{token})).data;assert.equal(undone.state,'undone',JSON.stringify({error:undone.error,report:undone.report}))}}
  for(const file of media){const response=await download(file);assert.equal(response.status,404);await response.arrayBuffer();assert.equal(await (await app.files).head(file.object_key),null,'undo removes unpublished canonical bytes')}
  assert.equal((await app.first('SELECT count(*) n FROM move_in_attachment_objects WHERE project_id=?',p)).n,0)
  const restored=await apply(fixture.archive({repack:2})),restoredTicket=await app.first('SELECT * FROM conversations WHERE project_id=?',p)
  const restoredFiles=await app.sql('SELECT * FROM media WHERE project_id=?',p)
  await app.ok(`/api/management/projects/${p}/contacts/${restoredTicket.contact_id}/erase`,{token,body:{}});await app.drainJobs()
  for(const file of restoredFiles)assert.equal(await (await app.files).head(file.object_key),null,'erasure removes attachment bytes')
  assert.equal((await app.call(imports+'?vendor='+fixture.vendor,{token,body:fixture.archive(),raw:true,headers:{'X-Import-Filename':'again.zip','X-Import-Schema':'2.16'}})).status,410)
  assert.equal((await app.ok(imports+'/'+restored.id,{token})).data.state,'erased')
 }
 await mixedAttachmentErasure(app)
 assert.equal(app.requests.length,0,'acquiring history never fetches provider URLs or sends mail')
 }finally{await app.close()}
}
