import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

const mime=(id,{references='',attachment=false,automatic=false}={})=>`From: Customer <customer@customer.example>\r\nTo: support@parcel.example\r\nMessage-ID: <${id}@customer.example>\r\nSubject: ${references?'Changed subject':'Damaged parcel'}\r\n${references?`In-Reply-To: <${references}@customer.example>\r\nReferences: <${references}@customer.example>\r\n`:''}${automatic?'Auto-Submitted: auto-replied\r\n':''}Authentication-Results: mx.parcel.example; dkim=pass header.d=customer.example; dmarc=pass header.from=customer.example\r\nMIME-Version: 1.0\r\n${attachment?'Content-Type: multipart/mixed; boundary="parcel"\r\n\r\n--parcel\r\nContent-Type: text/plain\r\n\r\nHere is the damage.\r\n--parcel\r\nContent-Type: text/plain; name="damage.txt"\r\nContent-Disposition: attachment; filename="damage.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nZGFtYWdl\r\n--parcel--\r\n':'Content-Type: text/plain; charset=utf-8\r\n\r\nPlease replace my damaged parcel.\r\n'}`

export async function imapProviderJourney(){
 const app=await startApp({captureQueue:true,entry:'tests/helpers/email/socket-worker.ts',bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-1',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MAILBOX_SOCKET_HOSTS:'mail.parcel.example',MAILBOX_IMAP_AUTHSERV:'mx.parcel.example'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'cloudflare-dns.com')
  return Response.json({Status:0,Answer:[{type:15,data:'10 mx.parcel.example.'}]})
 }})
 try{
  const workspace=await app.seedWorkspace('imap'),other=await app.seedWorkspace('imap-other'),token=workspace.tokens.owner,base=`/api/management/projects/${workspace.projectId}/mailboxes`
  const edge=body=>app.ok('/_test/mail-socket',body?{body}:{})
  const input={address:'support@parcel.example',imapHost:'mail.parcel.example',smtpHost:'mail.parcel.example',username:'synthetic-happytohelp-2',password:'synthetic-happytohelp-3'}
  assert.equal((await app.call(base+'/imap',{token,body:{...input,imapHost:'127.0.0.1'}})).status,400)
  assert.equal((await app.call(base+'/imap',{token,body:{...input,smtpPort:25}})).status,400)
  await edge({imapDenied:true});assert.equal((await app.call(base+'/imap',{token,body:input})).status,502)
  assert.equal((await app.ok(base,{token})).data.length,0,'a failed connection is never saved')
  await edge({imapDenied:false,messages:[mime('first')]})
  const row=(await app.ok(base+'/imap',{token,body:input})).data,path=base+'/'+row.id,poll=()=>app.ok(path+'/poll',{token,body:{}})
  assert.equal(row.status,'connected');assert.equal(JSON.stringify(row).includes(input.password),false)
  assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher.includes(input.password),false)
  assert.equal((await app.call(path+'/poll',{token:other.tokens.owner,body:{}})).status,403)
  const first=await poll();assert.equal(first.received,1);assert.deepEqual(first.cursor,{kind:'imap',uidValidity:'42',lastUid:1})
  assert.equal((await poll()).received,0)
  const admitted=await app.first('SELECT conversation_id FROM inbound_emails WHERE id=?','<first@customer.example>')
  assert.ok(admitted);await app.takeJobs()
  await app.ok(path+'/signatures/default',{token,method:'PUT',body:{text:'Parcel support'}})
  const ticketPath=`/api/dashboard/projects/${workspace.projectId}/tickets`
  const send=localId=>app.ok(ticketPath,{token,body:{kind:'email',localId,requesterEmail:'customer@customer.example',subject:'Replacement',content:'.Your replacement ships today.',mailboxId:row.id,cc:['finance@customer.example'],bcc:['archive@customer.example']}})
  const settle=async()=>app.until(async()=>{const rows=await app.sql('SELECT state FROM mailbox_sends');return rows.length&&!rows.some(row=>row.state==='sending')&&rows},{message:'SMTP outcome'})
  const ticket=await send('synthetic-happytohelp-4');await settle()
  const wire=(await edge()).sent;assert.equal(wire.length,1);assert.match(wire[0],/Cc: <finance@customer.example>/);assert.doesNotMatch(wire[0],/Bcc:/i)
  assert.ok((await edge()).commands.includes('RCPT TO:<archive@customer.example>'))
  assert.match(wire[0],/Message-ID: <h2h\./)
  const decoded=wire[0].split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1).map(part=>Buffer.from(part.split('\r\n--')[0].replace(/\s/g,''),'base64').toString()).join('\n')
  assert.match(decoded,/Parcel support/)
  assert.equal((await send('synthetic-happytohelp-4')).conversation.id,ticket.conversation.id);assert.equal((await edge()).sent.length,1)
  await edge({messages:[mime('first'),mime('follow',{references:'first',attachment:true})]})
  assert.equal((await poll()).received,1)
  assert.equal((await app.first('SELECT conversation_id FROM inbound_emails WHERE id=?','<follow@customer.example>')).conversation_id,admitted.conversation_id)
  const media=await app.first("SELECT * FROM media WHERE filename='damage.txt'");assert.ok(media)
  assert.equal(await (await (await app.files).get(media.object_key)).text(),'damage')
  await edge({imapDenied:true});assert.equal((await app.call(path+'/poll',{token,body:{}})).status,502)
  const rejected=(await app.ok(base,{token})).data.find(box=>box.id===row.id);assert.equal(rejected.status,'reconnect_required');assert.equal(rejected.error_code,'provider_authorization_rejected')
  assert.equal((await app.call(path+'/poll',{token,body:{}})).status,409)
  await edge({imapDenied:false});await app.ok(path+'/reconnect',{token,body:input})
  assert.equal((await app.ok(path+'/backfill',{token,body:{}})).received,0,'reconnect redelivery retains receipts')
  await edge({uidValidity:'43'})
  assert.equal((await app.call(path+'/poll',{token,body:{}})).status,502)
  assert.equal((await app.ok(base,{token})).data.find(box=>box.id===row.id).status,'needs_backfill')
  const beforeBackfill=await app.sql('SELECT id FROM messages ORDER BY id')
  await app.ok(path+'/backfill',{token,body:{}})
  assert.deepEqual(await app.sql('SELECT id FROM messages ORDER BY id'),beforeBackfill,'new UID validity never duplicates Message-ID admission')
  await edge({smtpCode:550});await send('synthetic-happytohelp-5');await settle()
  assert.ok((await app.sql('SELECT state FROM mailbox_sends')).some(row=>row.state==='failed'),'explicit SMTP refusal is a failed send')
  await edge({smtpCode:250,lost:true});await send('synthetic-happytohelp-6');await settle()
  assert.ok((await app.sql('SELECT state FROM mailbox_sends')).some(row=>row.state==='uncertain'),'lost acceptance remains unknown')
  const attempts=(await edge()).sent.length
  await send('synthetic-happytohelp-5');await send('synthetic-happytohelp-6');assert.equal((await edge()).sent.length,attempts,'neither refused nor unknown delivery is automatically replayed')
  await app.ok(path,{token,method:'DELETE'})
  assert.equal((await app.call(path+'/poll',{token,body:{}})).status,409)
  assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher,null)
  assert.ok(await app.first('SELECT 1 FROM conversations WHERE id=?',admitted.conversation_id),'disconnect retains ticket history')
 }finally{await app.close()}
}
