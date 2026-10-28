import assert from 'node:assert/strict'

// The customer continues the same ticket after the lead connects its mailbox. Header threading
// crosses the new IMAP transport; the next native Send crosses its real SMTP implementation.
export async function continueViaMailbox({f,tls,owner,id}){
 const {app}=f,base='/api/management/projects/p/mailboxes',path=`/api/conversations/${id}/messages`
 // Use the newly connected inbox's own address. Reusing the legacy gateway
 // address would route its messages through email_settings before this inbox.
 const command={address:'orders@example.com',imapHost:'imap.synthetic.example',smtpHost:'smtp.synthetic.example',username:'synthetic-user',password:'synthetic-password'}
 const box=(await app.ok(base+'/imap',{token:owner,body:command})).data
 assert.equal(box.status,'connected');assert.equal(box.provider,'imap')
 await app.ok(`/api/dashboard/projects/p/conversations/${id}/actions`,{token:owner,body:{action:'assignAi',data:{ai_id:null}}})
 const raw=(key,automatic=false)=>`From: Customer <customer@example.com>\r\nTo: ${command.address}\r\nMessage-ID: <${key}>\r\nIn-Reply-To: <first-mail>\r\nSubject: My café parcel\r\nAuthentication-Results: mx.customer.example; dkim=pass header.d=example.com; dmarc=pass header.from=example.com\r\n${automatic?'Auto-Submitted: auto-replied\r\n':''}Content-Type: text/plain; charset=utf-8\r\n\r\nThe café parcel arrived. Thank you.\r\n`
 const transcript=()=>app.ok(path,{token:owner}),poll=()=>app.ok(`${base}/${box.id}/poll`,{token:owner,body:{}})
 const before=(await transcript()).messages.length
 tls.messages.push(raw('imap-followup'))
 assert.equal((await poll()).received,1)
 const after=await transcript();assert.equal(after.messages.length,before+1);assert.ok(after.messages.at(-1).content.includes('café parcel'))
 assert.equal((await app.ok(`/api/dashboard/projects/p/conversations/${id}/ticket`,{token:owner})).data.mailbox_id,box.id)
 tls.messages.push(tls.messages[0]);await poll()
 await app.ok(`${base}/${box.id}/backfill`,{token:owner,body:{}})
 assert.equal((await transcript()).messages.length,after.messages.length,'a duplicate UID and backfill cannot repeat a customer turn')
 const updated=(await app.ok(`${base}/${box.id}/reconnect`,{token:owner,body:command})).data
 assert.equal(updated.status,'connected');await poll();assert.equal((await transcript()).messages.length,after.messages.length)
 const head=await transcript(),reply={localId:'smtp-reply',content:'Your café replacement is complete.',expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId}
 const sent=await app.ok(path,{token:owner,body:reply});await app.scheduled()
 await app.until(()=>tls.sent.length>0,{message:'native SMTP accepted the reply'})
 assert.ok(tls.sent.every(raw=>/Message-ID: <h2h\./i.test(raw)))
 assert.ok(tls.commands.some(line=>line.startsWith('RCPT TO:<ai-preference@example.net>')))
 assert.equal((await app.ok(path,{token:owner,body:reply})).duplicate,true)
 const copies=tls.sent.length;await f.replay(sent.message);assert.equal(tls.sent.length,copies)
 tls.messages.push(raw('imap-machine',true));await poll();await app.drainJobs();await f.idle()
 const automatic=(await transcript()).messages.find(m=>m.origin?.automatic&&m.content.includes('café parcel'))
 assert.ok(automatic);assert.equal(tls.sent.length,copies,'automatic IMAP mail cannot start an SMTP reply loop')
 await app.ok(`${base}/${box.id}`,{token:owner,method:'DELETE'})
 assert.equal((await app.ok(base,{token:owner})).data.find(row=>row.id===box.id).status,'disconnected')
 assert.ok((await transcript()).messages.some(m=>m.id===sent.message.id),'disconnect retains the customer history')
}
