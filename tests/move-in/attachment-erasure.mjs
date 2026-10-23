import assert from 'node:assert/strict'
import {zip} from './zip.mjs'
import {attachmentFixtures,publicBytes} from './attachment-fixtures.mjs'

/** Source originals are indivisible custody; published ticket files are not.
 * Erasing one requester must preserve another requester's canonical bytes. */
export async function mixedAttachmentErasure(app){
 const fixture=attachmentFixtures()[0],w=await app.seedWorkspace('mixed-attachment-erasure'),p=w.projectId,token=w.tokens.owner,root=`/api/move-in/projects/${p}/imports`
 const time='2024-01-02T00:00:00Z'
 fixture.rows.push({user:{id:192,role:'end-user',name:'Retained customer',email:'retained-migration@example.test',created_at:time}},
  {ticket:{id:1921,requester_id:192,subject:'Retained replacement parcel',status:'open',via:{channel:'email'},created_at:time,updated_at:time,comments:[{id:1922,author_id:192,body:'Keep this delivery label',public:true,created_at:time,attachments:[{id:1939,file_name:'retained-parcel.bin',content_type:'application/octet-stream',size:publicBytes.length}]}]}})
 const source=zip([{name:'history.jsonl',body:fixture.rows.map(JSON.stringify).join('\n')},...fixture.members,{name:'attachments/1921/1922%3A0',body:publicBytes}])
 const upload=(await app.ok(root+'?vendor=zendesk',{token,raw:true,headers:{'X-Import-Filename':'mixed.zip'},body:source})).data
 await app.drainJobs();const ready=(await app.ok(root+'/'+upload.id,{token})).data
 assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan))
 await app.ok(root+'/'+ready.id+'/apply',{token,body:{fingerprint:ready.plan.fingerprint}});await app.drainJobs()
 assert.equal((await app.ok(root+'/'+ready.id,{token})).data.state,'completed')
 const erased=await app.first('SELECT id FROM contacts WHERE project_id=? AND email=?',p,fixture.email)
 const retained=await app.first("SELECT * FROM media WHERE project_id=? AND filename='retained-parcel.bin'",p)
 assert.ok(retained)
 await app.ok(`/api/management/projects/${p}/contacts/${erased.id}/erase`,{token,body:{}});await app.drainJobs()
 assert.equal((await app.ok(root+'/'+ready.id,{token})).data.state,'erased','the mixed original is removed as one custody unit')
 const response=await app.request(`/api/conversations/${retained.conversation_id}/media/${retained.id}`,{token})
 assert.equal(response.status,200,'another requester retains their published file after source-custody erasure')
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),publicBytes)
 assert.equal((await app.first('SELECT count(*) n FROM move_in_attachment_objects WHERE project_id=?',p)).n,1)
}
