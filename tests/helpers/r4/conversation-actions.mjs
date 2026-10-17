import assert from 'node:assert/strict'
import {mailApp,message,replyTo,recipients} from '../email/app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

/** One real public-door journey; DNS and outbound mail are the only network fakes. */
export async function conversationActionsJourney(){
 const f=await mailApp(),{app,operator,mail}=f
 try{
  const base='/api/dashboard/projects/p/conversations'
  const visitor=async name=>app.ok('/api/identity/widget/session',{body:{widgetKey:'w',name,email:`${name.toLowerCase()}@example.test`},headers:{Origin:'https://example.com'}})
  const alice=await visitor('Alice'),bob=await visitor('Bob')
  const create=async(person,text)=>{
   const ticket=await app.ok('/api/conversations',{body:{projectId:'p',contactId:person.contactId},token:person.token})
   const message=await app.ok(`/api/conversations/${ticket.id}/messages`,{body:{localId:crypto.randomUUID(),content:text,expectedRevision:0},token:person.token})
   return {id:ticket.id,message:message.message,person}
  }
  const target=await create(alice,'Customer order A needs repair'),source=await create(bob,'Customer order B has the same defect')
  const call=(id,suffix,body,method)=>app.call(`${base}/${id}${suffix}`,{headers:operator,...(body!==undefined?{body}:{}),...(method?{method}:{})})
  const ok=async(id,suffix,body,method)=>{const result=await call(id,suffix,body,method);assert.ok(result.status>=200&&result.status<300,JSON.stringify(result.data));return result.data.data}
  const upload=await app.ok(`/api/conversations/${source.id}/media`,{token:bob.token,method:'POST',raw:true,headers:{'Content-Type':'text/plain','X-Filename':'order-proof.txt'},body:'Source attachment evidence'})
  await app.ok(`/api/conversations/${source.id}/messages`,{token:bob.token,body:{localId:'source-file',content:'Here is the order proof',mediaIds:[upload.id],expectedRevision:1}})
  const note=await ok(source.id,'/notes',{content:'PRIVATE: fraud review must never leave the team'})
  const mergeInput=async()=>({source_id:source.id,source_version:(await ok(source.id,'/ticket')).ticket_version,target_version:(await ok(target.id,'/ticket')).ticket_version})
  const beforeMessages=(await app.first('SELECT count(*) n FROM messages')).n,beforeOutbox=(await app.first('SELECT count(*) n FROM conversation_outbox')).n,beforeMail=mail.sent.length
  const preview=await ok(target.id,'/merge/preview',await mergeInput())
  assert.equal(preview.customer_history_shared,false);assert.equal(preview.tickets.find(t=>t.id===source.id).attachments,1)
  const foreign=await app.seedWorkspace('merge-foreign')
  const other=await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey,name:'Other'},headers:{Origin:foreign.allowedOrigin}})
  const foreignTicket=await app.ok('/api/conversations',{token:other.token,body:{projectId:foreign.projectId}})
  assert.equal((await call(target.id,'/merge',{...await mergeInput(),source_id:foreignTicket.id})).status,404)
  const merged=await ok(target.id,'/merge',await mergeInput())
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,beforeMessages)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox')).n,beforeOutbox)
  assert.equal(mail.sent.length,beforeMail,'merges send no acknowledgements or solved notices')
  const histories=await ok(target.id,'/merged-history')
  assert.ok(histories.some(thread=>thread.conversation_id===source.id&&JSON.stringify(thread).includes(upload.filename)))
  assert.ok(JSON.stringify(histories).includes('PRIVATE: fraud review'))
  const customerTranscript=await app.ok(`/api/conversations/${target.id}/messages`,{token:alice.token})
  assert.ok(!JSON.stringify(customerTranscript).includes('Customer order B'))
  assert.equal((await app.call(`/api/conversations/${source.id}/messages`,{token:alice.token})).status,404)
  assert.equal((await app.call(`/api/conversations/${source.id}/media/${upload.id}`,{token:alice.token})).status,404)
  assert.ok(!('mergedInto' in await app.ok(`/api/conversations/${source.id}/messages`,{token:bob.token})),'different-contact merges never disclose the survivor to the source customer')
  assert.equal((await app.call(`/api/conversations/${source.id}/messages`,{token:bob.token,body:{localId:'stale-source',content:'Late source reply',expectedRevision:2}})).status,409)
  await ok(target.id,`/merges/${merged.id}/undo`,{})
  assert.equal((await ok(target.id,'/merged-history')).length,1)
  const remerged=await ok(target.id,'/merge',await mergeInput())
  await app.ok(`/api/conversations/${target.id}/messages`,{token:alice.token,body:{localId:'new-frontier',content:'An update after merging',expectedRevision:1}})
  assert.equal((await call(target.id,`/merges/${remerged.id}/undo`,{})).status,409,'unsafe undo refuses changed ticket frontiers')
  const sameTarget=await create(alice,'A duplicate from the same authenticated customer'),sameSource=await create(alice,'Another copy from the same authenticated customer')
  await ok(sameTarget.id,'/merge',{source_id:sameSource.id,source_version:(await ok(sameSource.id,'/ticket')).ticket_version,target_version:(await ok(sameTarget.id,'/ticket')).ticket_version})
  assert.equal((await app.ok(`/api/conversations/${sameSource.id}/messages`,{token:alice.token})).mergedInto,sameTarget.id,'only a contact owning both tickets receives a scoped redirect')
  assert.equal((await app.call(`/api/conversations/${sameSource.id}/messages`,{token:alice.token,body:{localId:'same-contact-stale',content:'Reload the survivor first',expectedRevision:1}})).status,409)
  assert.equal((await app.call(`/api/conversations/${sameSource.id}/media`,{token:alice.token,method:'POST',raw:true,headers:{'Content-Type':'text/plain'},body:'Stale source upload'})).status,409)
  assert.equal((await call(target.id,'/partner-forwards/preview',{recipient:'partner@example.net',message_ids:[note.id]})).status,400)
  const forwardBody={recipient:'partner@example.net',subject:'Investigate order A',note:'Please investigate this customer-visible evidence.',message_ids:[target.message.id],idempotencyKey:'partner-forward-once',expected_version:(await ok(target.id,'/ticket')).ticket_version}
  const forwardPreview=await ok(target.id,'/partner-forwards/preview',forwardBody)
  assert.equal(forwardPreview.reply_visibility,'private');assert.equal(forwardPreview.private_notes_included,false)
  const sent=await ok(target.id,'/partner-forwards',forwardBody)
  await ok(target.id,'/partner-forwards',forwardBody)
  const outgoing=mail.sent.filter(entry=>recipients(entry.body).includes('partner@example.net'))
  assert.equal(outgoing.length,1);assert.ok(!JSON.stringify(outgoing).includes('PRIVATE: fraud review'))
  const address=replyTo(outgoing[0].body);assert.ok(address?.includes('+r.'))
  const reply={messageId:'partner-reply-one',to:address,from:'partner@example.net',text:'Private vendor analysis: replace the batch'}
  const publicCount=(await app.first('SELECT count(*) n FROM messages')).n,sends=mail.sent.length
  assert.equal((await f.gateway({...reply,from:'attacker@example.net'})).status,403)
  assert.equal((await app.call('/api/integrations/email/inbound',{body:reply})).status,403)
  assert.equal((await f.gateway(reply)).status,201)
  assert.equal((await f.gateway(reply)).status,200)
  const privateThread=await ok(target.id,'/partner-forwards')
  assert.equal(privateThread.replies.length,1);assert.match(privateThread.replies[0].content,/Private vendor analysis/)
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,publicCount)
  assert.equal(mail.sent.length,sends,'a private partner reply cannot notify the requester')
  assert.ok(!JSON.stringify(await app.ok(`/api/conversations/${target.id}/messages`,{token:alice.token})).includes('Private vendor analysis'))
  assert.equal((await app.call(`${base}/${target.id}/partner-forwards`,{token:alice.token})).status,403)
  const form=new FormData();form.set('envelope',JSON.stringify({to:[address,'inbound@example.com'],from:'partner@example.net'}));form.set('from','Partner <partner@example.net>');form.set('to',address);form.set('headers','From: Partner <partner@example.net>\r\nMessage-ID: <partner-sendgrid-reply>');form.set('text','Second private partner reply');form.set('dkim','{@example.net : pass}');form.set('attachment1',new File(['Private file bytes'],'partner-analysis.txt',{type:'text/plain'}))
  const encoded=new Request('https://sendgrid.example',{method:'POST',body:form})
  const sg=await app.request('/api/integrations/email/sendgrid/inbound',{headers:{Authorization:'Bearer fixture-gateway','Content-Type':encoded.headers.get('Content-Type')},body:await encoded.arrayBuffer(),raw:true})
  assert.equal(sg.status,201,await sg.text())
  const withFile=await ok(target.id,'/partner-forwards');assert.equal(withFile.files.length,1)
  const filePath=`${base}/${target.id}/partner-files/${withFile.files[0].id}`
  assert.equal(await (await app.request(filePath,{headers:operator})).text(),'Private file bytes')
  assert.equal((await app.call(filePath,{token:alice.token})).status,403)
  const workerReply=message({id:'partner-worker-reply',to:address,from:'Partner <partner@example.net>',headers:'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.net\r\n',text:'Third private reply through Email Routing'})
  assert.equal(await f.email(workerReply,{from:'partner@example.net',to:address,direct:true}),undefined)
  assert.equal((await ok(target.id,'/partner-forwards')).replies.length,3)
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,publicCount)
  assert.equal(mail.sent.length,sends)
  await ok(target.id,`/partner-forwards/${sent.id}`,undefined,'DELETE')
  assert.equal((await f.gateway({...reply,messageId:'revoked-partner-reply'})).status,403)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_participants WHERE conversation_id=?',target.id)).n,0,'partner invitations never confer customer participant authority')
  // A native owner fixture enters the same production erasure door, including step-up.
  const owner=await app.seedWorkspace('merge-erasure')
  await app.db.batch([
   app.db.prepare("INSERT INTO memberships(project_id,user_id,role) VALUES('p',?,'owner')").bind(owner.users.owner),
   app.db.prepare("UPDATE sessions SET project_id='p' WHERE token_hash=?").bind(sha(owner.tokens.owner)),
  ])
  const erased=await app.call(`/api/management/projects/p/contacts/${alice.contactId}/erase`,{token:owner.tokens.owner,body:{}})
  assert.equal(erased.status,200,JSON.stringify(erased.data))
  assert.equal((await app.first('SELECT count(*) n FROM partner_replies WHERE conversation_id=?',target.id)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM partner_reply_files WHERE conversation_id=?',target.id)).n,0)
  const tombstone=await app.first('SELECT recipient,subject,content,message_ids_json,revoked_at,state FROM partner_forwards WHERE id=?',sent.id)
  assert.equal(tombstone.recipient,'');assert.equal(tombstone.content,'');assert.ok(tombstone.revoked_at)
  assert.equal((await f.gateway({...reply,messageId:'erased-partner-reply'})).status,403,'erased private grants cannot fall through to customer intake')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_merges WHERE target_id=?',target.id)).n,0)
 }finally{await f.close()}
}
