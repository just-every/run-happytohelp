import assert from 'node:assert/strict'

function fakeTlsConnect(address,options){
 const id=crypto.randomUUID()
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

// The paid/network boundary only: app-owned TLS, IMAP and SMTP parsers remain real.
export function tlsEdge(){
 const sessions=new Map(),commands=[],sent=[],messages=[]
 return {commands,sent,messages,socketModule:`export const connect=${fakeTlsConnect.toString()}`,
 bindings:{INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MAILBOX_SOCKET_HOSTS:'imap.synthetic.example,smtp.synthetic.example',MAILBOX_IMAP_AUTHSERV:'mx.customer.example'},
 async outbound(request){
  assert.equal(new URL(request.url).hostname,'synthetic-mail-edge.example','mail never leaves the TLS edge')
  const input=await request.json();assert.equal(input.options.secureTransport,'on');assert.equal(input.options.allowHalfOpen,false)
  const smtp=input.address.hostname==='smtp.synthetic.example';assert.equal(input.address.port,smtp?465:993)
  if(input.open){sessions.set(input.id,{smtp,data:false,raw:''});return new Response(smtp?'220 synthetic ESMTP ready\r\n':'* OK synthetic IMAP ready\r\n')}
  const session=sessions.get(input.id);assert.ok(session)
  const text=Buffer.from(input.data).toString();commands.push(text)
  if(smtp){
   if(session.data){session.raw+=text;if(!session.raw.endsWith('\r\n.\r\n'))return new Response('');sent.push(session.raw.slice(0,-3));session.data=false;return new Response('250 queued synthetic-happytohelp-1\r\n')}
   if(text.startsWith('EHLO '))return new Response('250-synthetic.example\r\n250 AUTH PLAIN\r\n')
   if(text.startsWith('AUTH PLAIN ')){assert.equal(Buffer.from(text.trim().split(' ')[2],'base64').toString(),'\0synthetic-user\0synthetic-password');return new Response('235 authenticated\r\n')}
   if(text.startsWith('MAIL FROM:')||text.startsWith('RCPT TO:'))return new Response('250 accepted\r\n')
   assert.equal(text,'DATA\r\n');session.data=true;return new Response('354 end with dot\r\n')
  }
  const [,tag,command]=text.match(/^(A\d+) (.*)\r\n$/)||[];assert.ok(tag)
  if(command.startsWith('LOGIN ')){assert.equal(command,'LOGIN "synthetic-user" "synthetic-password"');return new Response(`${tag} OK authenticated\r\n`)}
  if(command==='EXAMINE INBOX')return new Response(`* OK [UIDVALIDITY 73] stable\r\n* OK [UIDNEXT ${messages.length+1}] next\r\n${tag} OK examined\r\n`)
  const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
  if(search)return new Response(`* SEARCH ${messages.map((_,i)=>i+1).filter(uid=>uid>=Number(search[1])&&uid<=Number(search[2])).join(' ')}\r\n${tag} OK searched\r\n`)
  const fetch=command.match(/^UID FETCH (\d+) \(UID BODY\.PEEK\[\]\)$/);assert.ok(fetch,command)
  const bytes=Buffer.from(messages[Number(fetch[1])-1]);return new Response(Buffer.concat([Buffer.from(`* 1 FETCH (UID ${fetch[1]} BODY[] {${bytes.length}}\r\n`),bytes,Buffer.from(`)\r\n${tag} OK fetched\r\n`)]))

 }}
}
