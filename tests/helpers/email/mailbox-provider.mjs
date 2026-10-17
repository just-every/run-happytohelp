import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// Provider HTTP response shapes from Gmail REST users/profile, settings/sendAs,
// messages/list+get and history/list, and Microsoft Graph /me, message/delta and
// MIME sendMail. Identifiers/addresses are synthetic; only the HTTP edge is fake.
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
// https://learn.microsoft.com/en-us/graph/api/message-delta
// https://learn.microsoft.com/en-us/graph/api/user-sendmail
const b64=value=>Buffer.from(value).toString('base64url')
const mime=(provider,address,id)=>`From: Customer <customer@example.com>\r\nTo: ${address}\r\nSubject: Shipment arrives damaged\r\nMessage-ID: <${id}@example.com>\r\nAuthentication-Results: ${provider==='gmail'?'mx.google.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com':'spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass action=none header.from=example.com; compauth=pass reason=100'}\r\nContent-Type: text/plain\r\n\r\nPlease replace the damaged shipment.`

export async function mailboxProviderJourney(){
 const sent=[],authorization=[],failures={gmail:false,microsoft:false}
 const addresses={gmail:'gmail.support@example.test',microsoft:'m365.support@example.test'}
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'gateway-fixture',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'installation-fixture',EMAIL_FROM:'support@example.test',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'google-client-fixture',GOOGLE_MAIL_CLIENT_SECRET:'google-secret-fixture',MICROSOFT_MAIL_CLIENT_ID:'microsoft-client-fixture',MICROSOFT_MAIL_CLIENT_SECRET:'microsoft-secret-fixture'},outbound:async request=>{
  const url=new URL(request.url),provider=url.hostname.includes('google')?'gmail':'microsoft',base='https://gmail.googleapis.com/gmail/v1/users/me'
  if(url.pathname.endsWith('/token')){const body=new URLSearchParams(await request.text());authorization.push(body);assert.ok(body.get('code_verifier')||body.get('grant_type')==='refresh_token');return Response.json({access_token:provider+'-access-fixture',refresh_token:provider+'-refresh-fixture',expires_in:3600,token_type:'Bearer',scope:provider==='gmail'?'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic':'Mail.Read Mail.Send User.Read'})}
  if(url.href===base+'/profile')return Response.json({emailAddress:addresses.gmail,messagesTotal:41,threadsTotal:22,historyId:'451'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:addresses.gmail,displayName:'Parcel Support',isPrimary:true,isDefault:true,verificationStatus:'accepted'},{sendAsEmail:'returns@example.test',displayName:'Returns',verificationStatus:'accepted'}]})
  if(url.pathname==='/v1.0/me')return Response.json({id:'directory-user',mail:addresses.microsoft,userPrincipalName:addresses.microsoft,proxyAddresses:['SMTP:'+addresses.microsoft,'smtp:billing@example.test']})
  if(url.pathname.endsWith('/messages/send')){sent.push({provider,raw:Buffer.from((await request.json()).raw,'base64url').toString()});return Response.json({id:'sent-message-gmail',threadId:'thread-gmail',labelIds:['SENT']})}
  if(url.pathname.endsWith('/sendMail')){sent.push({provider,raw:Buffer.from(await request.text(),'base64').toString()});return new Response(null,{status:202})}
  if(failures[provider])return new Response(null,{status:401})
  if(url.pathname.endsWith('/messages/delta'))return Response.json({'@odata.context':'https://graph.microsoft.com/v1.0/$metadata#Collection(message)','@odata.deltaLink':"https://graph.microsoft.com/v1.0/me/mailfolders('inbox')/messages/delta?$deltatoken=opaque",value:[{id:'AAMk-message-001'}]})
  if(url.pathname.endsWith('/$value'))return new Response(mime('microsoft',addresses.microsoft,'graph-first'),{headers:{'Content-Type':'message/rfc822'}})
  if(url.href.startsWith(base+'/messages?'))return Response.json({messages:[{id:'18f-message-001',threadId:'18f-thread-001'}],resultSizeEstimate:1})
  if(url.pathname.endsWith('/messages/18f-message-001'))return Response.json({id:'18f-message-001',threadId:'18f-thread-001',labelIds:['INBOX'],historyId:'452',raw:b64(mime('gmail',addresses.gmail,'gmail-first'))})
  if(url.pathname.endsWith('/history'))return Response.json({history:[],historyId:'452'})
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  throw new Error('Unexpected provider edge '+url)
 }})
 try{
  const workspace=await app.seedWorkspace('mailboxes'),base=`/api/management/projects/${workspace.projectId}/mailboxes`,token=workspace.tokens.owner
  const other=await app.seedWorkspace('mailboxes-other')
  for(const provider of ['gmail','microsoft']){
   const started=await app.ok(base+'/connect',{token,body:{provider,displayName:'Parcel Support'}}),url=new URL(started.url)
   assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'))
   const callback=`/api/management/mailboxes/oauth/${provider}/callback?state=${url.searchParams.get('state')}&code=provider-code-fixture`
   assert.equal((await app.call(callback,{token:other.tokens.owner})).status,403)
   assert.equal((await app.call(callback,{token})).status,302)
   assert.equal((await app.call(callback,{token})).status,403,'OAuth state is single use')
   const row=(await app.ok(base,{token})).data.find(row=>row.provider===provider)
   assert.equal(row.status,'connected');assert.equal(JSON.stringify(row).includes('access-fixture'),false)
   assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher.includes('refresh-fixture'),false)
   await app.ok(`${base}/${row.id}/signatures/default`,{token,method:'PUT',body:{text:'Parcel Support team'}})
   await app.ok(`${base}/${row.id}/signatures/${workspace.users.owner}`,{token,method:'PUT',body:{text:'Alex | Parcel Support'}})
   const sync=await app.ok(`${base}/${row.id}/poll`,{token,body:{}});assert.equal(sync.received,1)
   const message=await app.first('SELECT m.*,c.mailbox_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.mailbox_id=?',row.id)
   assert.ok(message,provider+' provider-authenticated mail becomes a ticket: '+JSON.stringify(await app.sql('SELECT state,error,conversation_id FROM inbound_emails')));assert.match(message.content,/damaged shipment/)
   assert.equal((await app.ok(`${base}/${row.id}/poll`,{token,body:{}})).received,0,'cursor redelivery creates no second message')
   const ticket=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:provider+'-operator-ticket',requesterEmail:'new.customer@example.com',subject:'Replacement shipment',content:'Your replacement ships today.',mailboxId:row.id,cc:['finance@example.com'],bcc:['archive@example.com']}})
   await app.until(()=>sent.some(wire=>wire.provider===provider),{message:provider+' send'})
   const wire=sent.find(wire=>wire.provider===provider);assert.match(wire.raw,/Cc: <finance@example.com>/i);assert.match(wire.raw,/Bcc: <archive@example.com>/i)
   const parts=wire.raw.split(/Content-Transfer-Encoding: base64\r\n\r\n/).slice(1).map(part=>Buffer.from(part.split('\r\n--')[0].replace(/\s/g,''),'base64').toString()).join('\n')
   assert.match(parts,/Alex \| Parcel Support/);assert.match(wire.raw,/Message-ID: <h2h\./i)
   const repeated=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:provider+'-operator-ticket',requesterEmail:'new.customer@example.com',subject:'Replacement shipment',content:'Your replacement ships today.',mailboxId:row.id,cc:['finance@example.com'],bcc:['archive@example.com']}})
   assert.equal(repeated.conversation.id,ticket.conversation.id);assert.equal(sent.filter(wire=>wire.provider===provider).length,1)
   failures[provider]=true;assert.equal((await app.call(`${base}/${row.id}/poll`,{token,body:{}})).status,502)
   assert.equal((await app.ok(base,{token})).data.find(m=>m.id===row.id).status,'reconnect_required')
   failures[provider]=false
   const restart=await app.ok(`${base}/${row.id}/reconnect`,{token,body:{}}),state=new URL(restart.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/${provider}/callback?state=${state}&code=new-code`,{token})).status,302)
   assert.equal((await app.ok(`${base}/${row.id}/backfill`,{token,body:{}})).received,0,'backfill retains deduplication')
   await app.ok(`${base}/${row.id}`,{token,method:'DELETE'})
   assert.equal((await app.call(`${base}/${row.id}/poll`,{token,body:{}})).status,409)
   assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher,null)
  }
  assert.equal(authorization.length,4)
 }finally{await app.close()}
}
