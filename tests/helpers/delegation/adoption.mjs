import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {delegatedTicketScopeAssertions} from './ticket-scope.mjs'
import {mobileAdoption} from '../mobile-adoption.mjs'

export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=','base64')

// Each fixture is its own workspace whose paired computer completed a job with
// uploaded screenshots, through the real local-agent routes of the application.
async function draftRuntime(){
 const app=await startApp({captureQueue:true}),db=app.db,bucket=await app.files
 const request=async(path,body,token,headers={},method=body===undefined?'GET':'POST')=>{const response=await app.request(path,{body,token,headers,method});return {status:response.status,body:await response.json()}}
 const fixture=async({count=1,verified=true,mode='resolve',legacyOnly=false,followUpMode,replyMode,reportStatus=200}={})=>{
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
  // The owner chooses the workspace's AI reply mode through the AI route before the computer reports.
  if(replyMode){const response=await request(`/api/management/projects/${projectId}/ai`,{ai_reply_mode:replyMode},token,{},'PUT');assert.equal(response.status,200,JSON.stringify(response.body))}
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
  if(followUpMode)result.follow_up_actions=[{id:'automatic-reply',title:'Prepared work',mode:followUpMode,instructions:'Prepared synthetic follow-up',attachment_ids:[]}]
  if(legacyOnly)delete result.replies
  // The device's report; `replay` sends the same report again, as a device does when it never saw the answer.
  const report={run_id:claim.run_id,event_id:randomUUID(),status:'completed',result},replay=()=>request(`/api/local-agents/jobs/${job.id}/result`,report,paired.token)
  const reported=await replay();assert.equal(reported.status,reportStatus,JSON.stringify(reported.body))
  const draftPath=base+'/'+job.id+'/result/draft',command={proposal_id:'selected',expected_revision:0,expected_last_message_id:null}
  const adopt=(data={},headers={})=>request(draftPath,{...command,...data},token,headers)
  const media=async()=>(await db.prepare('SELECT * FROM media WHERE conversation_id=? ORDER BY id').bind(conversationId).all()).results
  const messages=async()=>(await db.prepare('SELECT * FROM messages WHERE conversation_id=?').bind(conversationId).all()).results
  return {projectId,userId,conversationId,token,deviceId:paired.device.id,deviceToken:paired.token,jobId:job.id,result,replay,localAttachmentIds,draftPath,command,adopt,media,messages}
 }
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run(),one=(sql,...args)=>db.prepare(sql).bind(...args).first()
 const keys=async f=>(await bucket.list()).objects.filter(o=>o.key.startsWith(f.projectId+'/')).map(o=>o.key).sort()
 const bytes=async key=>Buffer.from(await (await bucket.get(key)).arrayBuffer())
 const noAdoption=async f=>{assert.deepEqual(await f.media(),[]);assert.deepEqual(await f.messages(),[]);assert.deepEqual(await keys(f),[])}
 return {app,bucket,request,fixture,run,one,keys,bytes,png,noAdoption,close:()=>app.close()}
}

export async function adoptionJourney(){
 const runtime=await draftRuntime(),{request,fixture,run,one,keys,bytes,noAdoption}=runtime
 try{
  // An actual storage failure during Use admits no message/media and leaves no copied object.
  const interrupted=await fixture({count:2})
  await run(`CREATE TRIGGER adoption_storage_outage BEFORE INSERT ON media WHEN NEW.conversation_id='${interrupted.conversationId}' BEGIN SELECT RAISE(ABORT,'synthetic media storage outage'); END`)
  assert.equal((await interrupted.adopt()).status,500)
  await noAdoption(interrupted)
  await run('DROP TRIGGER adoption_storage_outage')
  const retried=await interrupted.adopt();assert.equal(retried.status,200)
  const recovered=await interrupted.adopt();assert.deepEqual(recovered.body.data,retried.body.data)
  await mobileAdoption(runtime)
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

  // A live scope restriction at the final media INSERT cannot adopt prepared
  // local screenshots. Retain the draft's existing guard and byte cleanup.
  const scoped=await fixture(),role=await request(`/api/management/projects/${scoped.projectId}/roles`,{name:'Synthetic S5 draft scope',base:'operator',permissions:['conversations.reply']},scoped.token)
  assert.equal(role.status,201)
  await run('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,1)',scoped.projectId,scoped.userId,role.body.data.id)
  const empty=JSON.stringify({groupIds:[],includeUngrouped:false})
  const lostDraft=await scoped.adopt({}, {'x-test-statement':'INSERT INTO media','x-test-before-statement':`UPDATE project_roles SET ticket_scope_json='${empty}' WHERE id='${role.body.data.id}'`})
  assert.equal(lostDraft.status,409);await noAdoption(scoped)
  assert.equal((await scoped.adopt()).status,404);await noAdoption(scoped)
  await run('UPDATE project_roles SET ticket_scope_json=NULL WHERE id=?',role.body.data.id)
  assert.equal((await scoped.adopt()).status,200);assert.equal((await scoped.media()).length,1)
  console.log('PROBE ACCESS-001 P7: POST native result/draft; scope narrowed at media commit -> 409, no media/messages/copied bytes; next request 404; NULL retry 200')

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

  // In draft (and off) the verified Resolve & reply is held for its operator: nothing reaches the customer, also not
  // after a switch back to auto and the scheduled recovery; the operator adopts it and an ordinary Send admits it once.
  for(const replyMode of ['draft','off']){
   const h=await fixture({mode:'resolve_reply',legacyOnly:true,replyMode}),job=async()=>(await request(`/api/projects/${h.projectId}/conversations/${h.conversationId}/delegations`,undefined,h.token)).body.data.find(row=>row.id===h.jobId)
   assert.deepEqual(await h.messages(),[],replyMode+': the held reply is not sent');assert.equal(await one('SELECT 1 FROM local_receipts WHERE job_id=?',h.jobId),null,'no delivery was started')
   assert.equal((await job()).status,'completed');assert.equal((await job()).delivery_state,'held_for_operator')
   assert.ok(await one("SELECT 1 FROM conversation_notes WHERE id=?",'delegation:'+h.jobId),'the report still records its note')
   // A process lost after the held mark leaves the result effect pending: held is final for automatic delivery,
   // whatever the mode becomes and whichever runner settles the effect (queue, cron or the device's replay).
   await run("UPDATE local_result_effects SET state='pending' WHERE job_id=?",h.jobId)
   assert.equal((await request(`/api/management/projects/${h.projectId}/ai`,{ai_reply_mode:'auto'},h.token,{},'PUT')).status,200)
   await runtime.app.runJobs([{type:'local.effects',id:h.jobId,projectId:h.projectId}])
   await runtime.app.scheduled();assert.equal((await h.replay()).status,200)
   assert.deepEqual(await h.messages(),[],'switching back to auto sends nothing held');assert.equal(await one('SELECT 1 FROM local_receipts WHERE job_id=?',h.jobId),null,'no delivery was started after the hold')
   assert.equal(await one("SELECT state FROM local_result_effects WHERE job_id=?",h.jobId).then(row=>row.state),'completed','the pending effect settles without a delivery')
   assert.equal((await job()).status,'completed');assert.equal((await job()).delivery_state,'held_for_operator')
   const adopted=await h.adopt({proposal_id:null});assert.equal(adopted.status,200,JSON.stringify(adopted.body));assert.equal(adopted.body.data.body,h.result.reply_draft)
   assert.deepEqual(await h.messages(),[],'Use never sends')
   const send={localId:randomUUID(),content:adopted.body.data.body,expectedRevision:0,expectedLastMessageId:null,mediaIds:adopted.body.data.attachments.map(a=>a.id),authoring:adopted.body.data.authoring},path=`/api/conversations/${h.conversationId}/messages`
   const sent=await request(path,send,h.token);assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal(sent.body.accepted,true)
   assert.equal((await request(path,send,h.token)).body.duplicate,true)
   const [message]=await h.messages();assert.equal((await h.messages()).length,1);assert.equal(message.actor_id,h.userId);assert.equal(message.actor_role,'owner');assert.deepEqual(await bytes((await h.media())[0].object_key),png)
  }

  // A process lost between an automatic admission and its receipt update, then a switch to draft or off: recovery
  // recognises the delivery's own admission, so the report reads exactly as the uncrashed delivery `l` and nothing
  // is sent twice.
  const presented=async f=>{const row=(await request(`/api/projects/${f.projectId}/conversations/${f.conversationId}/delegations`,undefined,f.token)).body.data.find(item=>item.id===f.jobId);return {status:row.status,delivery_state:row.delivery_state}}
  for(const replyMode of ['draft','off']){
   await run("CREATE TRIGGER receipt_update_lost BEFORE UPDATE ON local_receipts WHEN NEW.proposal_id='legacy' BEGIN SELECT RAISE(ABORT,'Injected receipt_update_lost'); END")
   const r=await fixture({mode:'resolve_reply',legacyOnly:true,reportStatus:500})
   await run('DROP TRIGGER receipt_update_lost')
   assert.equal((await r.messages()).length,1,'the admission committed');assert.equal((await one("SELECT status FROM local_receipts WHERE job_id=? AND proposal_id='legacy'",r.jobId)).status,'sending')
   assert.equal(await one("SELECT state FROM local_result_effects WHERE job_id=?",r.jobId).then(row=>row.state),'pending')
   assert.equal((await request(`/api/management/projects/${r.projectId}/ai`,{ai_reply_mode:replyMode},r.token,{},'PUT')).status,200)
   await runtime.app.scheduled();assert.equal((await r.replay()).status,200)
   const [message]=await r.messages();assert.equal((await r.messages()).length,1,replyMode+': no second reply');assert.equal(message.actor_id,r.userId)
   const receipt=await one("SELECT status,message_id FROM local_receipts WHERE job_id=? AND proposal_id='legacy'",r.jobId);assert.equal(receipt.status,'sent');assert.equal(receipt.message_id,message.id)
   assert.deepEqual(await presented(r),await presented(l),replyMode+': the report presents the reply as delivered')
  }
 }finally{await runtime.close()}
 await delegatedTicketScopeAssertions()
}
