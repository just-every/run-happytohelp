import assert from 'node:assert/strict'

// RFC 3501 IMAP and RFC 5321 SMTP at the existing cloudflare:sockets edge.
// Production parsing, authentication, encrypted credentials and send claims run unchanged.
export function mailSocket(address,options){
 const id=crypto.randomUUID();let controller,ended=false,resolveClosed
 const closed=new Promise(resolve=>{resolveClosed=resolve})
 const receive=async body=>{
  const response=await fetch('https://synthetic-mail-edge.example/socket',{method:'POST',body:JSON.stringify({id,address,options,...body})})
  if(!response.ok)throw new Error('synthetic TLS edge refused connection')
  const bytes=new Uint8Array(await response.arrayBuffer())
  for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7))
 }
 const readable=new ReadableStream({start(value){controller=value}}),opened=receive({open:true})
 return {readable,writable:new WritableStream({async write(bytes){await opened;await receive({data:Array.from(bytes)})}}),opened,closed,
  async close(){if(!ended){ended=true;await opened;controller.close();resolveClosed()}}}
}
export async function mailSocketEdge(edge,request){
 const input=await request.json(),smtp=input.address.hostname==='smtp.synthetic.example'
 assert.equal(input.options.secureTransport,'on');assert.equal(input.address.port,smtp?465:993)
 if(input.open){edge.sessions.set(input.id,{smtp,data:false,raw:'',recipients:[]});return new Response(smtp?'220 synthetic ESMTP ready\r\n':'* OK synthetic IMAP ready\r\n')}
 const session=edge.sessions.get(input.id);assert.ok(session)
 const text=Buffer.from(input.data).toString();edge.commands.push(text)
 if(smtp){
  if(session.data){
   session.raw+=text;if(!session.raw.endsWith('\r\n.\r\n'))return new Response('')
   edge.attempts++;session.data=false
   if(edge.rejectSend)return new Response('550 5.7.1 Sender permission revoked\r\n')
   edge.sent.push({raw:session.raw.slice(0,-3),recipients:session.recipients})
   return new Response(edge.loseSend?'truncated provider response\r\n':'250 queued synthetic-message\r\n')
  }
  if(text.startsWith('EHLO '))return new Response('250-synthetic.example\r\n250 AUTH PLAIN\r\n')
  if(text.startsWith('AUTH PLAIN ')){assert.equal(Buffer.from(text.trim().split(' ')[2],'base64').toString(),'\0synthetic-user\0synthetic-password');return new Response('235 authenticated\r\n')}
  if(text.startsWith('MAIL FROM:'))return new Response('250 accepted\r\n')
  if(text.startsWith('RCPT TO:')){session.recipients.push(text.match(/<([^>]+)>/)[1]);return new Response('250 accepted\r\n')}
  assert.equal(text,'DATA\r\n');session.data=true;return new Response('354 end with dot\r\n')
 }
 const [,tag,command]=text.match(/^(A\d+) (.*)\r\n$/)||[];assert.ok(tag)
 if(command.startsWith('LOGIN '))return new Response(`${tag} ${edge.permission?'NO permission revoked':'OK authenticated'}\r\n`)
 if(command==='EXAMINE INBOX')return new Response(`* OK [UIDVALIDITY 73] stable\r\n* OK [UIDNEXT ${edge.messages.length+1}] next\r\n${tag} OK examined\r\n`)
 const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
 if(search)return new Response(`* SEARCH ${edge.messages.map((_,i)=>i+1).filter(uid=>uid>=Number(search[1])&&uid<=Number(search[2])).join(' ')}\r\n${tag} OK searched\r\n`)
 const fetch=command.match(/^UID FETCH (\d+) \(UID BODY\.PEEK\[\]\)$/);assert.ok(fetch,command)
 const bytes=Buffer.from(edge.messages[Number(fetch[1])-1].raw)
 return new Response(Buffer.concat([Buffer.from(`* 1 FETCH (UID ${fetch[1]} BODY[] {${bytes.length}}\r\n`),bytes,Buffer.from(`)\r\n${tag} OK fetched\r\n`)]))
}
