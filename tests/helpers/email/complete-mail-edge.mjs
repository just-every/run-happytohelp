import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {mailSocket,mailSocketEdge} from './complete-mail-socket.mjs'

// Official wire schemas, synthetic identities, real application routes/storage:
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
// https://learn.microsoft.com/en-us/graph/api/message-delta
// https://learn.microsoft.com/en-us/graph/api/user-sendmail
export async function completeMailEdge(kind){
 const address=`${kind}@support.example`,alias=`returns-${kind}@support.example`
 const edge={kind,address,alias,messages:[],sent:[],attempts:0,permission:false,rejectSend:false,sessions:new Map(),commands:[]}
 const app=await startApp({captureQueue:true,...(kind==='imap'?{socketModule:`export const connect=${mailSocket.toString()}`} : {}),bindings:{
  APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-installation',EMAIL_FROM:'support@support.example',INBOUND_EMAIL_TOKEN:'synthetic-gateway',
  INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'synthetic-google',GOOGLE_MAIL_CLIENT_SECRET:'synthetic-google',
  MICROSOFT_MAIL_CLIENT_ID:'synthetic-microsoft',MICROSOFT_MAIL_CLIENT_SECRET:'synthetic-microsoft',
  MAILBOX_SOCKET_HOSTS:'imap.synthetic.example,smtp.synthetic.example',MAILBOX_IMAP_AUTHSERV:'mx.customer.example',
 },outbound:async request=>{
  const url=new URL(request.url),path=url.pathname
  if(url.hostname==='synthetic-mail-edge.example')return mailSocketEdge(edge,request)
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.support.example.'}]})
  if(url.hostname==='api.resend.com'){
   const body=await request.json();edge.attempts++
   if(edge.rejectSend)return Response.json({message:'Sender permission revoked'},{status:403})
   edge.sent.push({body});if(edge.loseSend)return new Response(null,{status:503})
   return Response.json({id:'synthetic-'+edge.sent.length})
  }
  assert.ok(['oauth2.googleapis.com','gmail.googleapis.com','login.microsoftonline.com','graph.microsoft.com'].includes(url.hostname),'unexpected network edge '+url.hostname)
  if(path.endsWith('/token')){
   const body=new URLSearchParams(await request.text());assert.ok(body.get('code_verifier')||body.get('grant_type')==='refresh_token')
   return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer',scope:kind==='gmail'?'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic':'Mail.Read Mail.Send User.Read'})
  }
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-access')
  if(path.endsWith('/messages/send')||path.endsWith('/sendMail')){
   edge.attempts++
   if(edge.rejectSend)return Response.json({error:{code:'ErrorAccessDenied',message:'Send permission revoked'}},{status:403})
   const raw=path.endsWith('/sendMail')?Buffer.from(await request.text(),'base64').toString():Buffer.from((await request.json()).raw,'base64url').toString()
   edge.sent.push({raw});if(edge.loseSend)return new Response(null,{status:503})
   return kind==='gmail'?Response.json({id:'sent-'+edge.sent.length,threadId:'synthetic-thread',labelIds:['SENT']}):new Response(null,{status:202})
  }
  if(edge.permission)return Response.json({error:{code:'InvalidAuthenticationToken',message:'Mailbox permission revoked'}},{status:401})
  if(path.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:address,isPrimary:true,isDefault:true,verificationStatus:'accepted'}]})
  if(path.endsWith('/profile'))return Response.json({emailAddress:address,historyId:String(edge.messages.length+1)})
  if(path==='/v1.0/me')return Response.json({id:'synthetic-user',mail:address,userPrincipalName:address,proxyAddresses:['SMTP:'+address]})
  if(path.endsWith('/messages/delta'))return Response.json({value:edge.messages.slice(Number(url.searchParams.get('$deltatoken')||0)).map(m=>({id:m.id})),
   '@odata.deltaLink':`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=${edge.messages.length}`})
  if(path.endsWith('/history'))return Response.json({history:edge.messages.flatMap((m,i)=>i+2>Number(url.searchParams.get('startHistoryId'))?[{id:String(i+2),messagesAdded:[{message:{id:m.id,labelIds:['INBOX']}}]}]:[]),historyId:String(edge.messages.length+1)})
  if(path.endsWith('/messages'))return Response.json({messages:edge.messages.map(m=>({id:m.id})),resultSizeEstimate:edge.messages.length})
  const id=decodeURIComponent(path.match(/\/messages\/([^/]+)/)?.[1]||''),message=edge.messages.find(m=>m.id===id)
  assert.ok(message,'unexpected provider path '+path)
  return kind==='gmail'?Response.json({id,raw:Buffer.from(message.raw).toString('base64url'),labelIds:['INBOX']}):new Response(message.raw,{headers:{'Content-Type':'message/rfc822'}})
 }})
 const workspace=await app.seedWorkspace('complete-'+kind),token=workspace.tokens.owner,projectId=workspace.projectId,base=`/api/management/projects/${projectId}`,boxes=base+'/mailboxes'
 const ok=(path,body,method)=>app.ok(path,{token,body,method})
 await ok(base+'/email-settings',{from_name:'Parcel Support',from_address:'support@support.example',is_enabled:true},'PUT')
 const imap={address,imapHost:'imap.synthetic.example',smtpHost:'smtp.synthetic.example',username:'synthetic-user',password:'synthetic-password'}
 const oauth=async(path)=>{
  const started=await ok(path,{provider:kind,displayName:'Parcel Support'}),state=new URL(started.url).searchParams.get('state')
  assert.equal((await app.call(`/api/management/mailboxes/oauth/${kind}/callback?state=${state}&code=synthetic-code`,{token})).status,302)
 }
 let box
 if(kind==='gmail'||kind==='microsoft'){await oauth(boxes+'/connect');box=(await ok(boxes)).data[0]}
 else box=(await ok(boxes+(kind==='imap'?'/imap':''),kind==='imap'?imap:{provider:'forwarding',address,displayName:'Parcel Support'})).data
 await ok(boxes+'/'+box.id,{displayName:'Parcel Support',senderAddress:address},'PATCH')
 await ok(`${boxes}/${box.id}/aliases`,{address:alias})
 await ok(`${boxes}/${box.id}/signatures/default`,{text:'Parcel Support team'},'PUT')
 const mailbox=async()=>(await ok(boxes)).data.find(m=>m.id===box.id)
 const deliver=async(raw,{duplicate=false,envelopeTo=address}={})=>{
  if(kind==='forwarding'){
   const result=await app.email(raw,{from:'customer@customer.example',to:envelopeTo,direct:true})
   assert.equal(result.status,200);return result
  }
  edge.messages.push({id:'message-'+edge.messages.length,raw})
  const result=await ok(`${boxes}/${box.id}/poll`,{})
  assert.equal(result.failed,0);if(!duplicate)assert.equal(result.received,1)
  return result
 }
 const reconnect=async()=>{
  if(kind==='gmail'||kind==='microsoft')await oauth(`${boxes}/${box.id}/reconnect`)
  else await ok(`${boxes}/${box.id}/reconnect`,kind==='imap'?imap:{})
  // DELETE deliberately removes aliases; restoring one is an explicit operator action.
  await ok(`${boxes}/${box.id}/aliases`,{address:alias})
 }
 return {app,edge,kind,address,alias,workspace,projectId,token,base,boxes,box,ok,mailbox,deliver,reconnect,
  disconnect:()=>ok(`${boxes}/${box.id}`,undefined,'DELETE'),
  backfill:()=>ok(`${boxes}/${box.id}/backfill`,{}),
  close:()=>app.close()}
}

export function customerMime(m,{id,to=m.address,subject='A damaged parcel',headers='',attachment=false,failed=false}={}){
 const auth=m.kind==='gmail'?'mx.google.com':m.kind==='forwarding'?'mx.cloudflare.net':m.kind==='imap'?'mx.customer.example':''
 const verdict=`${auth?auth+'; ':''}dkim=${failed?'fail':'pass'} header.d=customer.example; dmarc=${failed?'fail':'pass'} header.from=customer.example`
 const body=attachment?`Content-Type: multipart/mixed; boundary=parcel\r\n\r\n--parcel\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPhoto of the damaged café parcel.\r\n--parcel\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=parcel.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from([0,1,2,127,128,255]).toString('base64')}\r\n--parcel--\r\n`:'Content-Type: text/plain; charset=utf-8\r\n\r\nPlease replace the damaged café parcel.'
 return `From: Customer <customer@customer.example>\r\nTo: ${to}\r\nMessage-ID: <${id}@customer.example>\r\nSubject: ${subject}\r\nAuthentication-Results: ${verdict}\r\n${headers}MIME-Version: 1.0\r\n${body}`
}
