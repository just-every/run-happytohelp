import assert from 'node:assert/strict'
import {mailApp,recipients} from './app.mjs'

const png=Uint8Array.from([137,80,78,71,13,10,26,10]),pdf=new TextEncoder().encode('%PDF-fixture')
const b64=bytes=>btoa(String.fromCharCode(...bytes))

// Replies reach a conversation's customers by email: rendered safely with inline images and files, to the
// preferred address and participants of this workspace only, never the author, with a snapshot of recipients
// frozen at first send, a lost provider response never resent, and oversized or missing files linked instead.
export async function customerMailJourney(){
 const m=await mailApp({outbox:'sender@example.com'}),{DB,app,mail,replay,idle}=m
 const initialMailStatus=new Map()
 const upload=async(name,type,bytes)=>{const response=await app.request('/api/conversations/c/media',{method:'POST',raw:true,headers:{...m.operator,'Content-Type':type,'X-Filename':name},body:bytes});assert.equal(response.status,201,await response.clone().text());return (await response.json()).id}
 const reply=async(localId,content,mediaIds=[])=>{const head=await DB.prepare("SELECT revision,last_message_id FROM conversations WHERE id='c'").first();const response=await m.post('c/messages',{localId,content,expectedRevision:head.revision,expectedLastMessageId:head.last_message_id,mediaIds});assert.equal(response.status,200,await response.clone().text());const result=await response.json(),message=result.message;initialMailStatus.set(message.id,result.dashboardMessage.email_status.state);await app.scheduled();return message}
 const deliveries=id=>DB.prepare("SELECT recipient,state FROM email_deliveries WHERE id LIKE ? ORDER BY recipient").bind(`message:${id}:%`).all().then(rows=>rows.results)
 try{
  await DB.batch([
   DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('other','Other','other-w','https://other.example.com',1)"),
   DB.prepare("INSERT INTO contacts(id,project_id,email,is_verified,metadata_json,created_at) VALUES('contact','p','first@example.com',1,'{}',1),('participant','p','teammate@example.com',0,'{}',1),('foreign','other','foreign@example.com',0,'{}',1)"),
   DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('c','p','contact',1,'earlier',1,1),('foreign-c','other','foreign',0,NULL,1,1)"),
   DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('earlier','p','c','earlier','contact','contact','An earlier question',1,1)"),
  ])
  // A lost provider response is uncertain and never resent, even after recipients change.
  mail.mode='lost';const first=await reply('lost','A reply');const attempts=mail.attempts
  assert.deepEqual(await deliveries(first.id),[{recipient:'first@example.com',state:'uncertain'}])
  await DB.batch([DB.prepare("UPDATE contacts SET email='changed@example.com',metadata_json='{}' WHERE id='contact'"),DB.prepare("INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('cp','c','participant',1),('invalid-tenant','c','foreign',1)")])
  await app.call('/api/management/projects/p/contacts/contact',{headers:m.operator,method:'PUT',body:{provided_email:'preferred@example.com'},status:200})
  mail.mode='deliver';await replay(first);assert.equal(mail.attempts,attempts);assert.deepEqual(await deliveries(first.id),[{recipient:'first@example.com',state:'uncertain'}])
  // A rich reply with an image and a file: sanitised HTML, inline image by content id, preferred address and participants only.
  const content='**Resolved**\n\n- Try again\n\n[Guide](https://example.com/help)\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))'
  const rich=await reply('rich',content,[await upload('screenshot.png','image/png',png),await upload('guide.pdf','application/pdf',pdf)])
  const sent=mail.sent.filter(entry=>entry.body.text?.includes('Try again'));assert.deepEqual(sent.map(entry=>entry.body.to[0]).sort(),['preferred@example.com','teammate@example.com'])
  assert.deepEqual({...await DB.prepare("SELECT email,is_verified FROM contacts WHERE id='contact'").first()},{email:'changed@example.com',is_verified:1},'sending changes no identity')
  for(const {body} of sent){
   assert.match(body.html,/<strong>Resolved<\/strong>/);assert.match(body.html,/<li>Try again<\/li>/);assert.match(body.html,/href="https:\/\/example.com\/help"/);assert.doesNotMatch(body.html,/<script>|href="javascript:/)
   assert.deepEqual(body.attachments.map(a=>a.filename),['screenshot.png','guide.pdf']);assert.equal(body.attachments[0].content,b64(png));assert.equal(body.attachments[0].content_type,'image/png')
   assert.match(body.html,new RegExp('src="cid:'+body.attachments[0].content_id+'"'));assert.equal(body.attachments[1].content,b64(pdf));assert.match(body.text,/Attachment: guide.pdf/)
  }
  // Interrupted replay keeps the recipient snapshot taken at first send.
  const calls=mail.sent.length
  await DB.prepare("UPDATE email_deliveries SET state='sending' WHERE recipient='teammate@example.com' AND id LIKE ?").bind(`message:${rich.id}:%`).run();await DB.prepare("DELETE FROM conversation_participants WHERE id='cp'").run()
  await replay(rich);assert.equal(mail.sent.length,calls);assert.deepEqual((await deliveries(rich.id)).map(row=>row.recipient),['preferred@example.com','teammate@example.com'])
  // A participant's emailed message reaches the other customers at once and the operator after a quiet minute, never its author.
  await DB.prepare("INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('cp2','c','participant',2)").run()
  const to=await m.replyAddress('c','teammate@example.com'),before=mail.sent.length
  const raw=`From: Teammate <teammate@example.com>\r\nTo: ${to}\r\nMessage-ID: <customer-message@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nMore detail: try this export\r\n--b\r\nContent-Type: image/png\r\nContent-Disposition: attachment; filename="customer.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(png)}\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="customer.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(pdf)}\r\n--b--`
  assert.equal(await m.email(raw,{from:'teammate@example.com',to}),undefined)
  // Both MIME parts are staged in one millisecond. Give the fixture a strict
  // chronology before either delivery; random media ids are not MIME part order.
  await DB.prepare("UPDATE media SET created_at=CASE filename WHEN 'customer.png' THEN 1 ELSE 2 END WHERE message_id=?").bind((await m.admitted('customer-message@example.com')).id).run()
  await app.scheduled()
  assert.deepEqual(mail.sent.slice(before).map(entry=>entry.body.to[0]),['preferred@example.com'])
  await idle();const notices=mail.sent.slice(before);assert.deepEqual(notices.map(entry=>entry.body.to[0]).sort(),['op@example.com','preferred@example.com'])
  for(const {body} of notices){assert.deepEqual(body.attachments.map(file=>file.filename),['customer.png','customer.pdf']);assert.equal(body.attachments[0].content,b64(png));assert.equal(body.attachments[1].content,b64(pdf))}
  const digest=notices.find(entry=>entry.body.to[0]==='op@example.com').body;assert.match(digest.html,/<h2>Unread customer messages:<\/h2>/);assert.match(digest.text,/Unread customer messages:/)
  const settled=mail.sent.length;await idle();assert.equal(mail.sent.length,settled,'no second digest without new activity')
  // The reply address in the customer's copy continues this conversation as that customer.
  const customerCopy=notices.find(entry=>entry.body.to[0]==='preferred@example.com').body
  const back=`From: preferred@example.com\r\nTo: ${customerCopy.reply_to}\r\nMessage-ID: <preferred-back@example.com>\r\nContent-Type: text/plain\r\n\r\nThanks`
  assert.equal(await m.email(back,{from:'preferred@example.com',to:customerCopy.reply_to}),undefined);assert.equal((await m.admitted('preferred-back@example.com')).conversation_id,'c')
  // A file-only reply is useful mail with its bytes; concurrent replays send once.
  const fileOnly=await reply('file-only','',[await upload('result.txt','text/plain',new TextEncoder().encode('done'))]),fileBefore=mail.sent.length
  await Promise.all([replay(fileOnly),replay(fileOnly)]);assert.equal(mail.sent.length,fileBefore)
  const fileMail=mail.sent.filter(entry=>entry.body.text?.includes('result.txt'));assert.deepEqual(fileMail.map(entry=>entry.body.to[0]).sort(),['preferred@example.com','teammate@example.com']);assert.ok(fileMail.every(entry=>entry.body.attachments[0].content===btoa('done')))
  // Too large or missing files never stop the email: they are named, with a link that opens them from the conversation.
  const large=new Uint8Array(9*1024*1024).fill(65),statement=await upload('statement.pdf','application/pdf',large),receipt=await upload('receipt.pdf','application/pdf',new TextEncoder().encode('receipt'))
  await (await app.files).delete((await DB.prepare('SELECT object_key FROM media WHERE id=?').bind(receipt).first()).object_key)
  const largeBefore=mail.sent.length;await reply('large-files','Your statement',[statement,receipt]);const linked=mail.sent.slice(largeBefore);assert.equal(linked.length,2)
  for(const {body} of linked){
   assert.ok(!body.attachments?.length);assert.match(body.text,/Not attached: receipt\.pdf \(could not be attached\)/)
   const url=new URL(body.text.match(/Not attached: statement\.pdf \(9\.0 MB, too large to attach\)\. View it in the conversation: (\S+)/)[1])
   const file=await app.request(url.pathname+url.search);assert.equal(file.status,200);assert.equal((await file.arrayBuffer()).byteLength,large.length)
   assert.equal((await app.request(url.pathname.replace(/.$/,c=>c==='0'?'1':'0')+url.search)).status,404)
  }
  // An operator replying to their own visitor address gets a reason, with no provider
  // attempt. Preferred addresses use the same selection as sending; another eligible
  // participant still receives the reply and its durable outcome wins on reload.
  await DB.prepare("DELETE FROM conversation_participants WHERE conversation_id='c'").run()
  const readMailStatus=async messageId=>{
   const response=await app.request('/api/dashboard/projects/p/conversations/c/buckets/c',{headers:m.operator})
   assert.equal(response.status,200,await response.clone().text())
   const bucket=(await response.json()).data
   return bucket.messages.find(message=>message.id===messageId).email_status.state
  }
  for(const [key,email,flags,state] of [
   ['same-address',' OP@EXAMPLE.COM ',{},'sender_address'],
   ['same-preferred','other@example.com',{provided_email:' OP@EXAMPLE.COM '},'sender_address'],
   ['different-preferred','op@example.com',{provided_email:'another@example.com'},'sent'],
   ['missing-address',null,{},'no_recipient'],
   ['blocked-address','op@example.com',{is_blocked:true},'no_recipient'],
  ]){
   await DB.prepare("UPDATE contacts SET email=?,metadata_json=? WHERE id='contact'").bind(email,JSON.stringify(flags)).run()
   const attempts=mail.attempts,message=await reply(key,'Mail status '+key)
   assert.equal(await readMailStatus(message.id),state,key+' retains its reason on reload')
   if(state==='sent')assert.deepEqual(await deliveries(message.id),[{recipient:'another@example.com',state:'sent'}])
   else{
    assert.equal(initialMailStatus.get(message.id),state,key+' names the reason in the send response')
    assert.equal(mail.attempts,attempts,key+' does not contact a provider')
    assert.deepEqual(await deliveries(message.id),[],key+' does not invent a send attempt')
   }
  }
  await DB.batch([DB.prepare("UPDATE contacts SET email='op@example.com',metadata_json='{}' WHERE id='contact'"),DB.prepare("INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('status-participant','c','participant',3)")])
  const participantReply=await reply('same-with-participant','Reply also reaches the other recipient')
  assert.deepEqual(await deliveries(participantReply.id),[{recipient:'teammate@example.com',state:'sent'}])
  await DB.prepare("DELETE FROM conversation_participants WHERE id='status-participant'").run()
  assert.equal(await readMailStatus(participantReply.id),'sent','a durable provider outcome takes precedence over a current same-address exclusion')
 }finally{await m.close()}
 await automaticRelayRows()
}

// The same reply journey also covers customer-authored fan-out. A Cc header or
// Reply-To preference cannot authorize an automatic copy to a different mailbox.
async function automaticRelayRows(){
 const m=await mailApp(),{app,mail,operator}=m
 const settle=async()=>{await app.scheduled();await app.scheduled()}
 const relays=from=>mail.sent.slice(from).filter(e=>e.body.subject==='Reply to your support conversation').flatMap(e=>recipients(e.body))
 try{
  await m.gateway({messageId:'relay-proven',to:'inbound@example.com',from:'proven-relay@example.com',replyTo:'relay-preference@example.net',text:'My own request'});await settle()
  const start=mail.sent.length
  await m.gateway({messageId:'relay-customer',to:'inbound@example.com',from:'relay-requester@example.com',replyTo:'requester-preference@example.net',cc:['proven-relay@example.com','unproven-relay@example.net'],text:'Please check order 4827'});await settle()
  assert.deepEqual(relays(start),['proven-relay@example.com'],'only the independently proven participant gets one automatic relay')
  const id=(await m.claim('relay-customer')).conversation_id,first=await m.admitted('relay-customer')
  await m.replay(first);await settle();assert.deepEqual(relays(start),['proven-relay@example.com'],'replay cannot add recipients')
  const head=await m.DB.prepare('SELECT revision FROM conversations WHERE id=?').bind(id).first(),human=mail.sent.length,humanContent='Your replacement ships tomorrow.'
  await app.call(`/api/conversations/${id}/messages`,{headers:operator,body:{localId:'human-reply',content:humanContent,expectedRevision:head.revision},status:200});await settle()
  // Human email carries the ticket's threading subject. Select this reply by
  // its submitted content so the recipient assertion covers every actual copy.
  const humanRecipients=mail.sent.slice(human).filter(entry=>entry.body.text?.includes(humanContent)).flatMap(entry=>recipients(entry.body))
  assert.deepEqual(humanRecipients.sort(),['relay-preference@example.net','requester-preference@example.net','unproven-relay@example.net'].sort(),'the human reply retains its Reply-To preferences and participants')
 }finally{await m.close()}
}
