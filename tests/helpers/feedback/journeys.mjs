import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
const penny='https://penny.example.test/requests/export-progress',issue='https://vector.example.test/issues/export-progress',secret='synthetic-happytohelp-1-release-signing-secret'
export async function feedbackHarness(){
 const pennyCalls=[],failures=[]
 const app=await startApp({outbound:async(request,entry)=>{if(new URL(request.url).origin!=='https://penny.example.com')throw Error('Unexpected provider');pennyCalls.push(entry);if(failures.shift())throw Error('Provider receipt lost');return Response.json({requesterId:String(pennyCalls.length).padStart(26,'0'),created:true})},bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}})
 try{
 const ws=await app.seedWorkspace('feedback'),foreign=await app.seedWorkspace('feedback-foreign'),token=ws.tokens.owner,base=`/api/feedback/projects/${ws.projectId}`,records=[]
 await app.presenceAwayOff(ws.projectId)
 for(let i=0;i<2;i++){
  const headers={Origin:ws.allowedOrigin,'CF-Connecting-IP':`198.51.100.${40+i}`}
  const visitor=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:ws.widgetKey,name:`Requester ${i}`,email:`feedback-${i}@example.test`}})
  const conversation=await app.ok('/api/conversations',{token:visitor.token,headers,body:{projectId:ws.projectId}})
  const send=async(content,localId)=>{const current=await app.ok('/api/conversations/'+conversation.id,{token});return app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,headers,body:{content,localId,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}})}
  const opening=await send(`Export ${i} hangs. Please keep me informed about this fix.`,'opening'),consent=await send('Yes, share my quote and name with Penny and send me a service update here when the export fix ships.','consent')
  records.push({visitor,conversation,message:opening.message,consent:consent.message,send})
 }
 const call=(path,body,options={})=>app.ok(base+path,{token,body,...options})
 const root=r=>`/conversations/${r.conversation.id}`
 const capture=(r,extra={})=>call(root(r),{message_id:r.message.id,penny_url:penny,issue_url:issue,...extra})
 const subscribe=(r,id,subscribed=true)=>call(root(r)+`/sources/${id}/preference`,{subscribed,preference_message_id:r.consent.id},{method:'PUT'})
 const snapshot=r=>call(root(r))
 const event=(id='release-1',extra={})=>({id,issue_url:issue,release_url:'https://releases.example.test/export-fixed',released_at:new Date().toISOString(),...extra})
 const release=async body=>{const raw=JSON.stringify(body),signature=createHmac('sha256',secret).update(raw).digest('hex');return app.call('/api/feedback/releases/'+ws.projectId,{raw:true,body:raw,headers:{'Content-Type':'application/json','X-HappyToHelp-Signature':signature}})}
 const connect=()=>call('/settings',{secret},{method:'PUT'})
 return {pennyCalls,failures,app,ws,foreign,token,base,records,root,call,capture,subscribe,snapshot,event,release,connect,async close(){await app.close()}}
 }catch(e){await app.close();throw e}
}
export async function feedbackCaptureJourney(){const h=await feedbackHarness();try{
 const {app,records,capture,root}=h
 const company=await app.ok(`/api/management/projects/${h.ws.projectId}/companies`,{token:h.token,body:{name:'Export customer account'}})
 const companyId=company.company.id
 assert.ok(companyId)
 // Company membership is prerequisite fixture state; all feedback commands use the public route.
 await app.db.prepare('INSERT INTO contact_companies(project_id,contact_id,company_id) VALUES(?,?,?)').bind(h.ws.projectId,records[0].visitor.contactId,companyId).run()
 for(const r of records){const response=await capture(r);assert.equal(response.data.quote,r.message.content);assert.equal(response.data.contact_id,r.visitor.contactId);assert.equal(response.data.subscribed,0);assert.equal(response.data.penny_url,penny);assert.equal(response.data.issue_url,issue)}
 assert.equal((await h.snapshot(records[0])).data[0].account_id,companyId)
 const duplicates=await Promise.all([capture(records[0]),capture(records[0])]);assert.ok(duplicates.every(r=>r.duplicate));assert.equal((await h.snapshot(records[0])).data.length,1)
 assert.equal((await app.call(h.base+root(records[0]),{token:h.token,body:{message_id:records[1].message.id,penny_url:penny,issue_url:issue}})).status,400)
 const current=await app.ok('/api/conversations/'+records[0].conversation.id,{token:h.token}),operator=await app.ok(`/api/conversations/${records[0].conversation.id}/messages`,{token:h.token,body:{content:'Private operator comment is not a customer quote',localId:'operator',expectedRevision:current.revision}})
 assert.equal((await app.call(h.base+root(records[0]),{token:h.token,body:{message_id:operator.message.id,penny_url:penny,issue_url:issue}})).status,400)
 assert.equal((await app.call(h.base+root(records[0]),{token:h.foreign.tokens.owner})).status,403)
 await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(h.ws.projectId,h.ws.users.operator,Date.now()).run()
 assert.equal((await app.call(h.base+root(records[0]),{token:h.ws.tokens.operator,body:{message_id:records[0].message.id,penny_url:penny,issue_url:issue}})).status,403)
 const audit=await app.sql("SELECT detail_json FROM audit_events WHERE action='feedback.source_linked'");assert.equal(audit.length,2);assert.ok(!JSON.stringify(audit).includes(records[0].message.content))
}finally{await h.close()}}
export async function feedbackReleaseJourney(){const h=await feedbackHarness();const sockets=[];try{
 const {app,records,capture,subscribe,snapshot,root}=h
 await h.connect();const sources=[];for(const r of records)sources.push((await capture(r)).data)
 const firstBody=h.event('before-consent');assert.equal((await h.release(firstBody)).data.updates,0)
 for(let i=0;i<2;i++)await subscribe(records[i],sources[i].id)
 const settings=JSON.stringify(await h.call('/settings'));assert.ok(!settings.includes(secret));assert.ok(settings.includes('release_url'))
 const unsigned=await app.call('/api/feedback/releases/'+h.ws.projectId,{body:h.event()});assert.equal(unsigned.status,401)
 const payload=h.event();const accepted=await h.release(payload);assert.equal(accepted.status,200);assert.equal(accepted.data.updates,2)
 assert.equal((await h.release(payload)).data.duplicate,true);assert.equal((await h.release({...payload,release_url:'https://releases.example.test/different'})).status,409)
 const r=records[0],state=await snapshot(r),draft=state.updates[0];assert.equal(draft.state,'draft')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',r.conversation.id)).n,2,'release sends no customer message')
 const upgrade=await app.request(`/api/conversations/${r.conversation.id}/socket?token=${r.visitor.token}`,{headers:{Upgrade:'websocket',Origin:h.ws.allowedOrigin}});assert.equal(upgrade.status,101);const socket=upgrade.webSocket,frames=[];sockets.push(socket);socket.accept();socket.addEventListener('message',e=>frames.push(JSON.parse(e.data)))
 const frontier=await app.ok('/api/conversations/'+r.conversation.id,{token:h.token}),body={content:'The export fix shipped. Please try it and tell us if you still need help.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id,resolve:true}
 const sent=await h.call(root(r)+`/updates/${draft.id}/send`,body);assert.equal(sent.accepted,true)
 await app.until(()=>frames.some(f=>f.type==='message'&&f.message.id===sent.message.id),{message:'approved feedback update on visitor channel'})
 assert.equal((await h.call(root(r)+`/updates/${draft.id}/send`,body)).duplicate,true)
 assert.equal((await app.sql('SELECT id FROM messages WHERE conversation_id=? AND local_id=?',r.conversation.id,'feedback:'+draft.id)).length,1)
 await r.send('It still fails for my account. Please keep this open.','still-failing')
 const conversation=await app.ok('/api/conversations/'+r.conversation.id,{token:h.token});assert.notEqual(conversation.status_category,'closed');assert.equal(conversation.resolved_at,null)
 const secondDraft=(await snapshot(records[1])).updates[0]
 await app.ok(`/api/feedback/conversations/${records[1].conversation.id}/opt-out`,{token:records[1].visitor.token,body:{}})
 assert.equal((await snapshot(records[1])).updates[0].state,'cancelled')
 const secondFrontier=await app.ok('/api/conversations/'+records[1].conversation.id,{token:h.token});assert.equal((await app.call(h.base+root(records[1])+`/updates/${secondDraft.id}/send`,{token:h.token,body:{content:'Must not send',expectedRevision:secondFrontier.revision}})).status,409)
 assert.equal((await h.release(h.event('next-release'))).data.updates,1,'opted-out requester gets no new draft')
 await h.call('/settings',{revoke:true},{method:'PUT'});assert.equal((await h.release(h.event('revoked'))).status,401)
 assert.ok((await app.sql("SELECT id FROM audit_events WHERE action='feedback.update_approved'")).length)
}finally{for(const socket of sockets)socket.close();await h.close()}}
export async function feedbackCustodyJourney(){const h=await feedbackHarness();try{
 const {app,records}=h;await h.connect();for(const r of records){const source=(await h.capture(r)).data;await h.subscribe(r,source.id)}
 await h.release(h.event())
 await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${records[0].visitor.contactId}/erase`,{token:h.token,body:{}})
 assert.equal((await app.sql('SELECT id FROM feedback_sources WHERE contact_id=?',records[0].visitor.contactId)).length,0)
 assert.equal((await app.sql('SELECT id FROM feedback_updates WHERE source_id NOT IN (SELECT id FROM feedback_sources)')).length,0)
 assert.equal((await h.snapshot(records[1])).data.length,1)
 assert.equal((await app.call(h.base+h.root(records[0]),{token:h.token,body:{message_id:records[0].message.id,penny_url:penny,issue_url:issue}})).status,404)
 assert.equal((await h.release(h.event('after-erasure'))).data.updates,1)
 const report=await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${records[0].visitor.contactId}/erasure`,{token:h.token});assert.ok(report.data.providers.requests.some(r=>r.store==='feedback:linked_records'&&r.state==='unsupported'))
 const all=JSON.stringify(await app.sql('SELECT * FROM feedback_sources'));assert.ok(!all.includes(records[0].message.content))
}finally{await h.close()}}

export async function feedbackHandoffJourney(){const h=await feedbackHarness();try{
 const key='synthetic-happytohelp-2-penny-api-key',origin='https://penny.example.com',pennyUrl=origin+'/portal/feedback/export-progress'
 const {app,records}=h
 await h.call('/penny-connection',{origin,token:key},{method:'PUT'})
 assert.ok(!JSON.stringify(await h.call('/penny-connection')).includes(key))
 const sources=[]
 for(const r of records)sources.push((await h.capture(r,{penny_url:pennyUrl})).data)
 assert.equal(h.pennyCalls.length,0,'linking alone shares no customer data')
 for(let i=0;i<2;i++){
  const r=records[i],path=h.root(r)+`/sources/${sources[i].id}`;let preview=await h.call(path+'/handoff-preview')
  assert.ok(preview.data.source.includes(r.message.content));assert.ok(!JSON.stringify(preview.data).includes(r.visitor.email||'@example.test'))
  assert.equal((await app.call(h.base+path+'/handoff',{token:h.token,body:{approve:false,sharing_message_id:r.consent.id}})).status,400)
  assert.equal((await app.call(h.base+path+'/handoff',{token:h.token,body:{approve:true,sharing_message_id:records[1-i].consent.id,preview_hash:preview.preview_hash}})).status,400)
  if(i===0){await app.db.prepare('UPDATE contacts SET name=? WHERE id=?').bind('Updated requester name',r.visitor.contactId).run();assert.equal((await app.call(h.base+path+'/handoff',{token:h.token,body:{approve:true,sharing_message_id:r.consent.id,preview_hash:preview.preview_hash}})).status,409,'a changed sharing preview requires a new approval');assert.equal(h.pennyCalls.length,0);preview=await h.call(path+'/handoff-preview')}
  const accepted=await h.call(path+'/handoff',{approve:true,sharing_message_id:r.consent.id,preview_hash:preview.preview_hash});assert.equal(accepted.accepted,true)
  const duplicate=await h.call(path+'/handoff',{approve:true,sharing_message_id:r.consent.id,preview_hash:preview.preview_hash});assert.equal(duplicate.duplicate,true)
 }
 assert.equal(h.pennyCalls.length,2)
 for(const call of h.pennyCalls){assert.equal(new URL(call.url).pathname,'/api/v1/requests/export-progress/proxy-votes');const payload=JSON.parse(call.body);assert.ok(payload.sourceUrl.includes('/conversations/'));assert.ok(payload.source.includes('HappyToHelp support feedback'));assert.ok(payload.contact.displayName);assert.equal(payload.contact.email,undefined)}
 const extra=(await h.capture(records[0],{penny_url:pennyUrl,message_id:records[0].consent.id})).data,path=h.root(records[0])+`/sources/${extra.id}`
 const retryPreview=await h.call(path+'/handoff-preview')
 h.failures.push(true);assert.equal((await app.call(h.base+path+'/handoff',{token:h.token,body:{approve:true,sharing_message_id:records[0].consent.id,preview_hash:retryPreview.preview_hash}})).status,409)
 assert.equal((await app.call(h.base+path+'/handoff',{token:h.token,body:{approve:true,sharing_message_id:records[0].consent.id,preview_hash:retryPreview.preview_hash}})).status,409)
 assert.equal(h.pennyCalls.length,3,'an uncertain external write is never replayed')
 assert.ok(JSON.parse(h.pennyCalls[2].body).requesterId,'subsequent tickets reuse the mapped Penny requester')
 await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${records[0].visitor.contactId}/erase`,{token:h.token,body:{}})
 assert.equal((await app.sql('SELECT * FROM feedback_penny_requesters WHERE contact_id=?',records[0].visitor.contactId)).length,0)
 assert.equal((await app.sql('SELECT * FROM feedback_handoffs WHERE source_id IN (?,?)',sources[0].id,extra.id)).length,0)
 assert.equal((await h.snapshot(records[1])).data[0].handoff_state,'accepted')
 await h.call('/penny-connection',{revoke:true},{method:'PUT'})
 assert.equal((await app.call(h.base+h.root(records[1])+`/sources/${sources[1].id}/handoff-preview`,{token:h.token})).status,409)
}finally{await h.close()}}
