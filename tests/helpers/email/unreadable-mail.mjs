import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

const auth=provider=>provider==='gmail'?'mx.google.com; dkim=pass header.d=customer.example; dmarc=pass header.from=customer.example':
 'spf=pass smtp.mailfrom=customer.example; dkim=pass header.d=customer.example; dmarc=pass action=none header.from=customer.example; compauth=pass reason=100'
const mime=(provider,id,body)=>`From: Nora Field <nora@customer.example>\r\nTo: ${provider}@parcel.example\r\nMessage-ID: <${id}@customer.example>\r\nSubject: Help with my parcel\r\nAuthentication-Results: ${auth(provider)}\r\n${body}`
function nested(depth){
 let body='Content-Type: text/plain\r\n\r\nPlease replace my damaged parcel.\r\n'
 for(let index=depth-1;index>=0;index--)body=`Content-Type: multipart/mixed; boundary="part-${index}"\r\n\r\n--part-${index}\r\n${body}\r\n--part-${index}--\r\n`
 return body
}
export async function unreadableMailJourney(){
 const boxes={gmail:{messages:[]},microsoft:{messages:[]}}
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'gateway-fixture',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'mail-fixture',EMAIL_FROM:'support@example.test',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'google-fixture',GOOGLE_MAIL_CLIENT_SECRET:'google-fixture',MICROSOFT_MAIL_CLIENT_ID:'microsoft-fixture',MICROSOFT_MAIL_CLIENT_SECRET:'microsoft-fixture'},outbound:async request=>{
  const url=new URL(request.url),provider=url.hostname.includes('google')?'gmail':'microsoft',box=boxes[provider]
  if(url.hostname==='api.resend.com')return Response.json({id:crypto.randomUUID()})
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.parcel.example.'}]})
  if(url.pathname.endsWith('/token'))return Response.json({access_token:provider+'-access',refresh_token:provider+'-refresh',expires_in:3600,token_type:'Bearer',scope:provider==='gmail'?'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic':'Mail.Read Mail.Send User.Read'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:'gmail@parcel.example',isPrimary:true,isDefault:true,verificationStatus:'accepted'}]})
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:'gmail@parcel.example',historyId:String(box.messages.length+1)})
  if(url.pathname==='/v1.0/me')return Response.json({id:'parcel-microsoft',mail:'microsoft@parcel.example',proxyAddresses:['SMTP:microsoft@parcel.example']})
  if(url.pathname.endsWith('/messages/delta'))return Response.json({value:box.messages.slice(Number(url.searchParams.get('$deltatoken')||0)).map(message=>({id:message.id})),
   '@odata.deltaLink':`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=${box.messages.length}`})
  if(url.pathname.endsWith('/history'))return Response.json({history:box.messages.filter((message,index)=>index+2>Number(url.searchParams.get('startHistoryId'))).map((message,index)=>({id:String(index+2),messagesAdded:[{message:{id:message.id,labelIds:['INBOX']}}]})),historyId:String(box.messages.length+1)})
  if(url.pathname.endsWith('/messages'))return Response.json({messages:box.messages.map(message=>({id:message.id}))})
  const id=decodeURIComponent(url.pathname.match(/\/messages\/([^/]+)/)?.[1]||''),message=box.messages.find(message=>message.id===id)
  assert.ok(message,'unexpected provider edge '+url.pathname)
  if(message.failure)return new Response(null,{status:503})
  return provider==='gmail'?Response.json({id,raw:Buffer.from(message.raw).toString('base64url')}):new Response(message.raw,{headers:{'Content-Type':'message/rfc822'}})
 }})
 try{
  const workspace=await app.seedWorkspace('unreadable'),token=workspace.tokens.owner,base=`/api/management/projects/${workspace.projectId}`,poll=row=>app.call(`${base}/mailboxes/${row.id}/poll`,{token,body:{}})
  for(const provider of ['gmail','microsoft']){
   const started=await app.ok(base+'/mailboxes/connect',{token,body:{provider}}),state=new URL(started.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/${provider}/callback?state=${state}&code=fixture`,{token})).status,302)
   const row=(await app.ok(base+'/mailboxes',{token})).data.find(row=>row.provider===provider),box=boxes[provider]
   assert.equal((await poll(row)).status,200)
   for(const [kind,body] of [['nesting',nested(257)],['headers',`X-Long: ${'x'.repeat(2*1024*1024+256)}\r\nContent-Type: text/plain\r\n\r\nPlease help.`]]){
    const id=provider+'-'+kind,raw=mime(provider,id,body)
    box.messages.push({id,raw},{id:id+'-next',raw:mime(provider,id+'-next','Content-Type: text/plain\r\n\r\nWhere is my parcel?')})
    assert.equal((await poll(row)).status,200)
    const suspended=(await app.ok(base+'/suspended',{token})).data
    const held=suspended.find(mail=>mail.reason==='message_unreadable'&&!box.held?.includes(mail.id));assert.ok(held,provider+' '+kind+' visibly held')
    box.held=[...(box.held||[]),held.id]
    const detail=(await app.ok(base+'/suspended/'+held.id,{token})).data
    assert.equal(detail.attachments.length,1);assert.equal(detail.attachments[0].filename,'original.eml')
    assert.equal(detail.text.includes('Please help.'),false,'unreadable content never becomes the preview')
    assert.equal(JSON.parse(detail.auth_json).verified,false)
    const attachment=await app.ok(base+`/suspended/${held.id}/attachments/0`,{token});assert.equal(attachment.text,null)
    const stored=JSON.parse((await app.first('SELECT input_json FROM suspended_emails WHERE id=?',held.id)).input_json)
    assert.equal(await (await (await app.files).get(stored.attachments[0].objectKey)).text(),raw,'the original bytes are retained')
    assert.deepEqual(await app.first('SELECT state,error FROM inbound_emails WHERE id=?',detail.receipt_id),{state:'suspended',error:'message_unreadable'})
    assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?',`<${id}-next@customer.example>`)).state,'delivered')
    assert.ok(await app.first('SELECT 1 FROM mailbox_sync_receipts WHERE mailbox_id=? AND provider_message_id=?',row.id,id))
    assert.deepEqual(await app.first('SELECT status,error_code FROM mailbox_connections WHERE id=?',row.id),{status:'connected',error_code:null})
   }
   // A listed message whose download fails also cannot keep the following mail
   // pinned forever. The failed-run counter survives a Worker restart.
   const id=provider+'-unavailable'
   box.messages.push({id,failure:true},{id:id+'-next',raw:mime(provider,id+'-next','Content-Type: text/plain\r\n\r\nI still need a return label.')})
   assert.equal((await poll(row)).status,502);assert.equal((await poll(row)).status,502)
   await app.configure({})
   assert.equal((await poll(row)).status,200)
   assert.ok((await app.ok(base+'/suspended',{token})).data.some(mail=>mail.reason==='message_unprocessable'))
   assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?',`<${id}-next@customer.example>`)).state,'delivered')
   assert.equal((await poll(row)).status,200)
  }
 }finally{await app.close()}
}
