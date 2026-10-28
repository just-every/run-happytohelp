import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

function fakeTlsConnect(address,options){
 const id=crypto.randomUUID(),encoder=new TextEncoder()
 let controller,resolveClosed,ended=false
 const closed=new Promise(resolve=>{resolveClosed=resolve})
 const receive=async(body)=>{
  const response=await fetch('https://synthetic-mail-edge.example/socket',{method:'POST',body:JSON.stringify({id,address,options,...body})})
  if(!response.ok)throw new Error('TLS fixture refused connection')
  const bytes=new Uint8Array(await response.arrayBuffer())
  for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7))
 }
 const readable=new ReadableStream({start(value){controller=value}}),opened=receive({open:true})
 return {readable,writable:new WritableStream({async write(bytes){await opened;await receive({data:Array.from(bytes)})}}),opened,closed,
  async close(){if(!ended){ended=true;await opened;controller.close();resolveClosed()}}}
}
export async function imapSmtpJourney(){
 const sessions=new Map(),commands=[],sent=[],messages=[]
 const raw=(id,automatic=false)=>`From: synthetic-happytohelp-1 <synthetic-happytohelp-1@customer.example>\r\nTo: synthetic-happytohelp-2@support.example\r\nMessage-ID: <${id}@customer.example>\r\nSubject: Damaged café parcel\r\nAuthentication-Results: mx.customer.example; dkim=pass header.d=customer.example; dmarc=pass header.from=customer.example\r\n${automatic?'Auto-Submitted: auto-replied\r\n':''}Content-Type: text/plain; charset=utf-8\r\n\r\nPlease replace the café parcel.\r\n`
 const app=await startApp({captureQueue:true,socketModule:`export const connect=${fakeTlsConnect.toString()}`,bindings:{APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MAILBOX_SOCKET_HOSTS:'imap.synthetic.example,smtp.synthetic.example',MAILBOX_IMAP_AUTHSERV:'mx.customer.example',EMAIL_FROM:'synthetic-happytohelp-2@support.example'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'synthetic-mail-edge.example','mail never leaves the TLS edge')
  const input=await request.json();assert.equal(input.options.secureTransport,'on');assert.equal(input.options.allowHalfOpen,false)
  const smtp=input.address.hostname==='smtp.synthetic.example';assert.equal(input.address.port,smtp?465:993)
  if(input.open){sessions.set(input.id,{smtp,data:false,raw:''});return new Response(smtp?'220 synthetic ESMTP ready\r\n':'* OK synthetic IMAP ready\r\n')}
  const session=sessions.get(input.id);assert.ok(session)
  const text=Buffer.from(input.data).toString();commands.push(text)
  if(smtp){
   if(session.data){session.raw+=text;if(!session.raw.endsWith('\r\n.\r\n'))return new Response('');sent.push(session.raw.slice(0,-3));session.data=false;return new Response('250 queued synthetic-happytohelp-1\r\n')}
   if(text.startsWith('EHLO '))return new Response('250-synthetic.example\r\n250 AUTH PLAIN\r\n')
   if(text.startsWith('AUTH PLAIN ')){assert.equal(Buffer.from(text.trim().split(' ')[2],'base64').toString(),'\0synthetic-happytohelp-1\0synthetic-happytohelp-2');return new Response('235 authenticated\r\n')}
   if(text.startsWith('MAIL FROM:')||text.startsWith('RCPT TO:'))return new Response('250 accepted\r\n')
   assert.equal(text,'DATA\r\n');session.data=true;return new Response('354 end with dot\r\n')
  }
  const [,tag,command]=text.match(/^(A\d+) (.*)\r\n$/)||[];assert.ok(tag)
  if(command.startsWith('LOGIN ')){assert.equal(command,'LOGIN "synthetic-happytohelp-1" "synthetic-happytohelp-2"');return new Response(`${tag} OK authenticated\r\n`)}
  if(command==='EXAMINE INBOX')return new Response(`* OK [UIDVALIDITY 73] stable\r\n* OK [UIDNEXT ${messages.length+1}] next\r\n${tag} OK examined\r\n`)
  const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
  if(search)return new Response(`* SEARCH ${messages.map((_,i)=>i+1).filter(uid=>uid>=Number(search[1])&&uid<=Number(search[2])).join(' ')}\r\n${tag} OK searched\r\n`)
  const fetch=command.match(/^UID FETCH (\d+) \(UID BODY\.PEEK\[\]\)$/);assert.ok(fetch,command)
  const bytes=Buffer.from(messages[Number(fetch[1])-1]);return new Response(Buffer.concat([Buffer.from(`* 1 FETCH (UID ${fetch[1]} BODY[] {${bytes.length}}\r\n`),bytes,Buffer.from(`)\r\n${tag} OK fetched\r\n`)]))
 }})
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-tls'),token=workspace.tokens.owner,base=`/api/management/projects/${workspace.projectId}/mailboxes`
  const connected=await app.ok(base+'/imap',{token,body:{address:'synthetic-happytohelp-2@support.example',imapHost:'imap.synthetic.example',smtpHost:'smtp.synthetic.example',username:'synthetic-happytohelp-1',password:'synthetic-happytohelp-2'}}),box=connected.data
  assert.equal(box.status,'connected');assert.equal(box.provider,'imap')
  messages.push(raw('synthetic-happytohelp-3'))
  const poll=()=>app.ok(`${base}/${box.id}/poll`,{token,body:{}})
  assert.equal((await poll()).received,1)
  const receipt=await app.first('SELECT * FROM inbound_emails WHERE id=?','<synthetic-happytohelp-3@customer.example>');assert.equal(receipt.state,'delivered')
  const original=await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',receipt.conversation_id)
  assert.equal(original.n,1);assert.match((await app.first('SELECT content FROM messages WHERE id=?',receipt.message_id)).content,/café parcel/)
  await app.takeJobs()
  // Same MIME arrives at a fresh UID, then again during a backfill.
  const ticketsBefore=(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',workspace.projectId)).n
  messages.push(messages[0]);assert.equal((await poll()).failed,0)
  await app.ok(`${base}/${box.id}/backfill`,{token,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',receipt.conversation_id)).n,1)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',workspace.projectId)).n,ticketsBefore,'redelivery creates no duplicate ticket')
  assert.deepEqual(await app.takeJobs(),[],'redelivery cannot repeat reply/notification effects')
  const ticket=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:'synthetic-happytohelp-4',requesterEmail:'synthetic-happytohelp-1@customer.example',mailboxId:box.id,subject:'Replacement parcel',content:'Your replacement café parcel ships today.'}})
  await app.until(()=>sent.length===1,{message:'SMTP first comment'})
  assert.ok(ticket.accepted);assert.match(sent[0],/Message-ID: <h2h\./i)
  assert.ok(commands.some(line=>line==='RCPT TO:<synthetic-happytohelp-1@customer.example>\r\n'))
  messages.push(raw('synthetic-happytohelp-5',true));assert.equal((await poll()).received,1)
  const automatic=await app.first('SELECT automatic,conversation_id FROM inbound_emails WHERE id=?','<synthetic-happytohelp-5@customer.example>');assert.equal(automatic.automatic,1)
  const jobs=await app.takeJobs();await app.runJobs(jobs);await app.drainJobs()
  messages.push(messages.at(-1));assert.equal((await poll()).failed,0)
  assert.deepEqual(await app.takeJobs(),[],'automatic-mail redelivery remains inert')
  assert.equal(sent.length,1,'automatic incoming mail cannot start an SMTP auto-reply loop')
  assert.equal((await app.first('SELECT count(*) n FROM inbound_emails WHERE id=?','<synthetic-happytohelp-3@customer.example>')).n,1)
 }finally{await app.close()}
}
