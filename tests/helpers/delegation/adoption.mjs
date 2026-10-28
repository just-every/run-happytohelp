import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'

export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=','base64')

// Each fixture is its own workspace whose paired computer completed a job with
// uploaded screenshots, through the real local-agent routes of the application.
async function draftRuntime(){
 const app=await startApp({captureQueue:true}),db=app.db,bucket=await app.files
 const request=async(path,body,token,headers={},method=body===undefined?'GET':'POST')=>{const response=await app.request(path,{body,token,headers,method});return {status:response.status,body:await response.json()}}
 const fixture=async({count=1,verified=true,mode='resolve',legacyOnly=false}={})=>{
  const projectId=randomUUID(),userId=randomUUID(),conversationId=randomUUID(),contactId=randomUUID(),token=randomUUID()
  await db.batch([
   db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(projectId,'Draft test',randomUUID(),'http://localhost'),
   db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(userId,userId+'@example.test','Owner'),
   db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(projectId,userId,'owner'),
   db.prepare('INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,?,1)').bind(contactId,projectId,'Customer'),
   db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,1,1)').bind(conversationId,projectId,contactId),
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?,NULL)').bind(sha(token),userId,projectId,'owner',Date.now()+3600000),db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(sha(token),userId,Date.now()),
  ])
  const post=async(path,body,auth=token)=>{const response=await request(path,body,auth);assert.equal(response.status,200,JSON.stringify(response.body));return response.body.data}
  const pairing=await post(`/api/projects/${projectId}/local-agents/pairings`,{}),paired=await post('/api/local-agents/pair',{code:pairing.code,name:'Native draft fixture',provider:'codex',capabilities:[]})
  const base=`/api/projects/${projectId}/conversations/${conversationId}/delegations`
  const job=await post(base,{request_id:randomUUID(),device_id:paired.device.id,mode,instructions:'Test fixture, no model execution.'}),claim=await post('/api/local-agents/claim',{claim_id:randomUUID()},paired.token)
  assert.equal(claim.id,job.id)
  const localAttachmentIds=[]
  for(let index=0;index<count;index++){
   const form=new FormData();form.set('run_id',claim.run_id);form.set('file',new File([png],`shot-${index}.png`,{type:'image/png'}))
   const encoded=new Request('http://localhost',{method:'POST',body:form})
   const upload=await app.request(`/api/local-agents/jobs/${job.id}/attachments`,{method:'POST',raw:true,token:paired.token,headers:{'Content-Type':encoded.headers.get('Content-Type')},body:await encoded.arrayBuffer()})
   assert.equal(upload.status,200,await upload.clone().text());localAttachmentIds.push((await upload.json()).data.id)
  }
  const result={summary:'Completed native upload fixture',actions:[],verified,reply_draft:'Legacy editable body',attachment_ids:localAttachmentIds,replies:[{id:'selected',title:'Reply',body:'Editable proposal body',attachment_ids:localAttachmentIds}],follow_up_actions:[]}
  if(legacyOnly)delete result.replies
  await post(`/api/local-agents/jobs/${job.id}/result`,{run_id:claim.run_id,event_id:randomUUID(),status:'completed',result},paired.token)
  const draftPath=base+'/'+job.id+'/result/draft',command={proposal_id:'selected',expected_revision:0,expected_last_message_id:null}
  const adopt=(data={},headers={})=>request(draftPath,{...command,...data},token,headers)
  const media=async()=>(await db.prepare('SELECT * FROM media WHERE conversation_id=? ORDER BY id').bind(conversationId).all()).results
  const messages=async()=>(await db.prepare('SELECT * FROM messages WHERE conversation_id=?').bind(conversationId).all()).results
  return {projectId,userId,conversationId,token,deviceId:paired.device.id,deviceToken:paired.token,jobId:job.id,result,localAttachmentIds,draftPath,command,adopt,media,messages}
 }
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first()
 const keys=async f=>(await bucket.list()).objects.filter(o=>o.key.startsWith(f.projectId+'/')).map(o=>o.key).sort()
 const bytes=async key=>Buffer.from(await (await bucket.get(key)).arrayBuffer())
 const noAdoption=async f=>{assert.deepEqual(await f.media(),[]);assert.deepEqual(await f.messages(),[]);assert.deepEqual(await keys(f),[])}
 return {app,bucket,request,fixture,run,one,keys,bytes,noAdoption,close:()=>app.close()}
}

export async function adoptionJourney(){
 const runtime=await draftRuntime(),{request,fixture,run,one,keys,bytes,noAdoption}=runtime
 try{
  // Local and legacy Use adopt exact native owned media, deduplicate, then ordinary Send admits exactly once.
  const f=await fixture(),[first,concurrent]=await Promise.all([f.adopt(),f.adopt()])
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(concurrent.status,200,JSON.stringify(concurrent));assert.deepEqual(first.body.data,concurrent.body.data)
  const mediaId=first.body.data.attachments[0].id;assert.notEqual(mediaId,f.localAttachmentIds[0],'local evidence and native media are separate identities')
  const legacy=await f.adopt({proposal_id:null});assert.equal(legacy.status,200,JSON.stringify(legacy));assert.equal(legacy.body.data.body,f.result.reply_draft);assert.equal(legacy.body.data.attachments[0].id,mediaId)
  assert.deepEqual(await f.messages(),[],'Use never sends')
  const rows=await f.media();assert.equal(rows.length,1);assert.equal(rows[0].uploaded_by,f.userId);assert.equal(rows[0].project_id,f.projectId);assert.equal(rows[0].conversation_id,f.conversationId);assert.equal(rows[0].message_id,null)
  assert.equal((await keys(f)).length,1,'the losing concurrent copy leaves no orphan');assert.deepEqual(await bytes(rows[0].object_key),png)
  assert.deepEqual(await bytes((await one('SELECT * FROM local_attachments WHERE id=?',f.localAttachmentIds[0])).storage_key),png,'source bytes retained')
  const edited='Operator edit '+randomUUID(),command={localId:randomUUID(),content:edited,expectedRevision:0,expectedLastMessageId:null,mediaIds:[mediaId]},path=`/api/conversations/${f.conversationId}/messages`
  const sent=await request(path,command,f.token);assert.equal(sent.status,200,JSON.stringify(sent));assert.equal(sent.body.accepted,true)
  const replay=await request(path,command,f.token);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.message.id,sent.body.message.id)
  assert.equal((await f.messages()).length,1);assert.equal((await f.messages())[0].content,edited);assert.equal((await f.media())[0].message_id,sent.body.message.id)
  assert.equal((await request(path,undefined,f.token)).body.messages[0].media[0].id,mediaId)
  const download=await runtime.app.request(first.body.data.attachments[0].url,{token:f.token});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png)
  assert.equal((await f.adopt({expected_revision:1,expected_last_message_id:sent.body.message.id})).status,409,'sent media cannot silently become another draft')

  // A body-only draft validates authority and creates neither message nor media.
  const bodyOnly=await fixture({count:0});assert.equal((await bodyOnly.adopt()).status,200);await noAdoption(bodyOnly)
  await run('UPDATE local_devices SET revoked_at=? WHERE id=?','revoked',bodyOnly.deviceId);assert.equal((await bodyOnly.adopt()).status,409);await noAdoption(bodyOnly)

  // Unverified fixes need input and cannot become drafts; investigation reports stay editable without automatic send.
  for(const mode of ['resolve','resolve_reply','investigate']){
   const u=await fixture({verified:false,mode}),listed=await request(`/api/projects/${u.projectId}/conversations/${u.conversationId}/delegations`,undefined,u.token)
   const job=listed.body.data.find(row=>row.id===u.jobId);assert.equal(job.result.verified,false)
   if(mode==='investigate'){assert.equal(job.status,'completed');assert.equal((await u.adopt()).status,200);assert.equal((await u.media()).length,1)}
   else{assert.equal(job.status,'needs_input','a reported fix cannot complete without verification');assert.equal((await u.adopt()).status,409);assert.equal((await u.adopt({proposal_id:null})).status,409,'legacy draft cannot bypass review');await noAdoption(u)}
   assert.equal((await request(u.draftPath.replace('/draft','/replies/selected/send'),{},u.token)).status,409);assert.deepEqual(await u.messages(),[])
  }

  // Actor, tenant, conversation, device and job selection cannot adopt another result.
  const s=await fixture(),other=await fixture()
  assert.equal((await request(s.draftPath,s.command)).status,401);assert.equal((await request(s.draftPath,s.command,s.deviceToken)).status,401);assert.equal((await request(s.draftPath,s.command,other.token)).status,403)
  await run('INSERT INTO memberships VALUES(?,?,?)',s.projectId,other.userId,'operator');const peerToken=randomUUID()
  await run('INSERT INTO sessions VALUES(?,?,?,?,NULL,?,NULL)',sha(peerToken),other.userId,s.projectId,'operator',Date.now()+3600000)
  assert.equal((await request(s.draftPath,s.command,peerToken)).status,409,'a same-project peer does not own this job')
  assert.equal((await request(s.draftPath.replace(s.conversationId,other.conversationId),s.command,s.token)).status,404)
  assert.equal((await request(s.draftPath.replace(s.jobId,other.jobId),s.command,s.token)).status,409)
  assert.equal((await request(s.draftPath.replace(s.projectId,other.projectId),s.command,s.token)).status,403)
  await run('UPDATE local_devices SET user_id=? WHERE id=?',other.userId,s.deviceId);assert.equal((await s.adopt()).status,409);await noAdoption(s)


  // Native owner recovery never becomes machine or delegated ticket authority.
  // A deliberately stored empty scope revokes the previously completed job.
  const scoped=await fixture(),scopedRole=randomUUID()
  await run('INSERT INTO project_roles(id,project_id,name,base,permissions_json,ticket_scope_json,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)',scopedRole,scoped.projectId,'Stored ticket restriction','operator','[]',JSON.stringify({groupIds:[],includeUngrouped:false}))
  await run('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,1)',scoped.projectId,scoped.userId,scopedRole)
  assert.equal((await scoped.adopt()).status,404,'a delegated draft never inherits owner recovery bypass');await noAdoption(scoped)
  assert.equal((await request(`/api/projects/${scoped.projectId}/conversations/${scoped.conversationId}/delegations`,undefined,scoped.token)).status,404,'local work history also loses ticket access')
  assert.equal((await request(`/api/local-agents/jobs/${scoped.jobId}/context?run_id=synthetic`,undefined,scoped.deviceToken)).status,403,'device context refuses current scope before run hydration')


  // A scope change after snapshot preparation cannot admit or return queued context.
  await run('UPDATE project_roles SET ticket_scope_json=NULL WHERE id=?',scopedRole)
  await run("UPDATE local_jobs SET status='queued',claim_id=NULL,context=NULL WHERE id=?",scoped.jobId)
  const lostClaim=await request('/api/local-agents/claim',{claim_id:randomUUID()},scoped.deviceToken,{'x-test-statement':"UPDATE local_jobs SET status='running',claim_id",'x-test-before-statement':`UPDATE project_roles SET ticket_scope_json='${JSON.stringify({groupIds:[],includeUngrouped:false})}',updated_at=updated_at+1 WHERE id='${scopedRole}'`})
  assert.equal(lostClaim.status,200);assert.equal(lostClaim.body.data,null,'a lost scope never returns a prepared snapshot')
  assert.deepEqual(await one('SELECT status,context FROM local_jobs WHERE id=?',scoped.jobId),{status:'queued',context:null},'scope is checked inside the queue claim')

  // Proposal selection, the immutable frontier and required fields are checked.
  const v=await fixture()
  for(const change of [{proposal_id:'missing'},{expected_revision:1},{expected_last_message_id:'foreign'}]){const response=await v.adopt(change);assert.ok([404,409].includes(response.status),JSON.stringify(response))}
  for(const change of [{proposal_id:42},{expected_revision:-1},{expected_revision:undefined},{expected_last_message_id:undefined}])assert.equal((await v.adopt(change)).status,422)
  await noAdoption(v)

  // Revocation, membership, deleted project, cancelled or incomplete jobs and delivery receipts deny adoption.
  const d=await fixture()
  for(const [change,args,restore,restoreArgs] of [
   ['UPDATE local_devices SET revoked_at=? WHERE id=?',['revoked',d.deviceId],'UPDATE local_devices SET revoked_at=NULL WHERE id=?',[d.deviceId]],
   ['UPDATE local_devices SET project_id=? WHERE id=?',['foreign',d.deviceId],'UPDATE local_devices SET project_id=? WHERE id=?',[d.projectId,d.deviceId]],
   ['UPDATE local_jobs SET cancel_requested=1 WHERE id=?',[d.jobId],'UPDATE local_jobs SET cancel_requested=0 WHERE id=?',[d.jobId]],
   ...['queued','running','needs_input','failed','cancelled','revoked'].map(status=>['UPDATE local_jobs SET status=? WHERE id=?',[status,d.jobId],"UPDATE local_jobs SET status='completed' WHERE id=?",[d.jobId]]),
   ['DELETE FROM memberships WHERE project_id=? AND user_id=?',[d.projectId,d.userId],'INSERT INTO memberships VALUES(?,?,?)',[d.projectId,d.userId,'owner']],
   ['INSERT INTO project_settings VALUES(?,?,1)',[d.projectId,'{"deleted_at":1}'],'DELETE FROM project_settings WHERE project_id=?',[d.projectId]],
  ]){await run(change,...args);assert.ok([401,409].includes((await d.adopt()).status),change);await noAdoption(d);await run(restore,...restoreArgs)}
  for(const status of ['sending','sent','uncertain']){await run("INSERT INTO local_receipts(job_id,proposal_id,kind,status) VALUES(?,'selected','reply',?)",d.jobId,status);assert.equal((await d.adopt()).status,409);await noAdoption(d);await run('DELETE FROM local_receipts WHERE job_id=?',d.jobId)}
  const grant=randomUUID();await run('INSERT INTO local_grants(id,user_id,project_id,revoked_at) VALUES(?,?,?,?)',grant,d.userId,d.projectId,'revoked');await run('UPDATE local_devices SET grant_id=? WHERE id=?',grant,d.deviceId)
  assert.equal((await d.adopt()).status,409);await noAdoption(d)

  // Unknown, foreign job, foreign device and foreign conversation uploads are refused.
  const g=await fixture(),foreign=await fixture()
  const replace=ids=>run('UPDATE local_jobs SET result=? WHERE id=?',JSON.stringify({...g.result,replies:[{...g.result.replies[0],attachment_ids:ids}]}),g.jobId)
  for(const ids of [[randomUUID()],[foreign.localAttachmentIds[0]]]){await replace(ids);assert.equal((await g.adopt()).status,409);await noAdoption(g)}
  await replace(g.localAttachmentIds);await run('UPDATE local_attachments SET device_id=? WHERE id=?',foreign.deviceId,g.localAttachmentIds[0]);assert.equal((await g.adopt()).status,409);await noAdoption(g)
  await run('UPDATE local_attachments SET device_id=?,job_id=? WHERE id=?',g.deviceId,foreign.jobId,g.localAttachmentIds[0]);assert.equal((await g.adopt()).status,409);await noAdoption(g)

  // Missing or truncated source objects create neither native rows nor orphan copies.
  for(const missing of [true,false]){
   const m=await fixture({count:2}),source=await one('SELECT * FROM local_attachments WHERE id=?',m.localAttachmentIds[1])
   if(missing)await runtime.bucket.delete(source.storage_key);else await runtime.bucket.put(source.storage_key,png.subarray(0,20))
   assert.equal((await m.adopt()).status,409);await noAdoption(m)
  }

  // A same-conversation follow-up uses only its explicitly granted parent upload.
  const p=await fixture()
  await run('UPDATE local_jobs SET result=? WHERE id=?',JSON.stringify({...p.result,follow_up_actions:[{id:'follow',title:'Follow up',mode:'resolve',instructions:'Test follow up',attachment_ids:p.localAttachmentIds}]}),p.jobId)
  const follow=await request(p.draftPath.replace('/draft','/follow-up-actions/follow'),{},p.token);assert.equal(follow.status,200,JSON.stringify(follow))
  const childId=follow.body.data.child_delegation_id,claim=await request('/api/local-agents/claim',{claim_id:randomUUID()},p.deviceToken);assert.equal(claim.body.data.id,childId)
  assert.equal((await request(`/api/local-agents/jobs/${childId}/result`,{run_id:claim.body.data.run_id,event_id:randomUUID(),status:'completed',result:p.result},p.deviceToken)).status,200)
  const childPath=p.draftPath.replace(p.jobId,childId);await run('DELETE FROM local_attachment_grants WHERE job_id=?',childId)
  assert.equal((await request(childPath,p.command,p.token)).status,409);await noAdoption(p)
  await run('INSERT INTO local_attachment_grants VALUES(?,?,?)',p.localAttachmentIds[0],childId,p.deviceId)
  assert.equal((await request(childPath,p.command,p.token)).status,200);assert.equal((await p.media()).length,1);assert.deepEqual(await p.messages(),[]);assert.deepEqual(await bytes((await p.media())[0].object_key),png)

  // Missing adopted bytes and forged ownership are not repaired or silently sent.
  const b=await fixture();assert.equal((await b.adopt()).status,200);await runtime.bucket.delete((await b.media())[0].object_key)
  assert.equal((await b.adopt()).status,409);assert.deepEqual(await b.messages(),[])
  const o=await fixture();assert.equal((await o.adopt()).status,200);await run('UPDATE media SET uploaded_by=? WHERE conversation_id=?',b.userId,o.conversationId)
  assert.equal((await o.adopt()).status,409);assert.deepEqual(await o.messages(),[])

  // Automatic legacy delivery reuses the same conversion with exact attachment bytes.
  const l=await fixture({mode:'resolve_reply',legacyOnly:true})
  assert.equal((await one("SELECT status FROM local_receipts WHERE job_id=? AND proposal_id='legacy'",l.jobId)).status,'sent')
  const delivered=await l.media();assert.equal(delivered.length,1);assert.equal(delivered[0].uploaded_by,l.userId);assert.equal((await l.messages()).length,1);assert.deepEqual(await bytes(delivered[0].object_key),png)
 }finally{await runtime.close()}
}

export async function adoptionFaultJourney(){
 const runtime=await draftRuntime(),{fixture,run,keys,bytes,noAdoption}=runtime
 try{
  // Concurrent changes land between the copies and the atomic batch, as another request would make them.
  const concurrent=f=>({revoke:`UPDATE local_devices SET revoked_at='revoked-during-copy' WHERE id='${f.deviceId}'`,frontier:`UPDATE conversations SET revision=revision+1 WHERE id='${f.conversationId}'`,cancel:`UPDATE local_jobs SET cancel_requested=1 WHERE id='${f.jobId}'`,grant:`UPDATE local_grants SET revoked_at='revoked-during-copy' WHERE user_id='${f.userId}'`,proposal:`UPDATE local_jobs SET result=json_set(result,'$.reply_draft','changed-during-copy') WHERE id='${f.jobId}'`,attachment:`UPDATE local_attachments SET device_id='foreign-during-copy' WHERE job_id='${f.jobId}'`})
  for(const fault of ['second-copy','unknown-copy','db-before','revoke','frontier','cancel','grant','proposal','attachment']){
   const f=await fixture({count:2})
   if(fault==='grant'){const grant=randomUUID();await run('INSERT INTO local_grants(id,user_id,project_id) VALUES(?,?,?)',grant,f.userId,f.projectId);await run('UPDATE local_devices SET grant_id=? WHERE id=?',grant,f.deviceId)}
   const headers=concurrent(f)[fault]?{'x-test-before-batch':concurrent(f)[fault]}:{'x-test-fault':fault}
   const result=await f.adopt({},headers);assert.equal(result.status,['second-copy','unknown-copy','db-before'].includes(fault)?500:409,fault+': '+JSON.stringify(result))
   await noAdoption(f)
  }
  // A lost D1 acknowledgement keeps committed native bytes and fails; explicit Use recovers the same ids.
  const f=await fixture({count:2});assert.equal((await f.adopt({},{'x-test-fault':'db-after'})).status,500)
  const before=await f.media();assert.equal(before.length,2);assert.deepEqual(await f.messages(),[])
  for(const row of before)assert.deepEqual(await bytes(row.object_key),png)
  const recovered=await f.adopt();assert.equal(recovered.status,200,JSON.stringify(recovered))
  assert.deepEqual(recovered.body.data.attachments.map(a=>a.id).sort(),before.map(a=>a.id).sort());assert.equal((await keys(f)).length,2)
 }finally{await runtime.close()}
}
