import assert from 'node:assert/strict'
import tls from 'node:tls'
import {Readable} from 'node:stream'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'


export async function tlsMailbox(){
 const directory=await mkdtemp(join(tmpdir(),'h2h-mail-tls-')),sockets=new Set(),servers=[],state={messages:[],uidValidity:'42',imapDenied:false,smtpCode:250,lost:false,untrusted:false,wrongName:false},sent=[],commands=[],handshakes=[]
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-subj','/CN=mail.parcel.example','-addext','subjectAltName=DNS:mail.parcel.example','-days','1'],{stdio:'ignore'})
  const key=await readFile(join(directory,'key.pem')),cert=await readFile(join(directory,'cert.pem'))
  const ports={},connections=new Map()
  for(const kind of [993,465]){
   const server=tls.createServer({key,cert,minVersion:'TLSv1.2'},wire=>{
    sockets.add(wire);wire.on('error',()=>{});wire.on('close',()=>sockets.delete(wire))
    let pending='',data=false,body=''
    const emit=text=>{const bytes=Buffer.from(text);for(let offset=0;offset<bytes.length;offset+=17)wire.write(bytes.subarray(offset,offset+17))}
    emit(kind===993?'* OK IMAP ready\r\n':'220 SMTP ready\r\n')
    wire.on('data',chunk=>{
     pending+=chunk.toString()
     for(;;){const end=pending.indexOf('\r\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+2)
      if(kind===993){
       const split=line.indexOf(' '),tag=line.slice(0,split),command=line.slice(split+1);commands.push(command.startsWith('LOGIN ')?'LOGIN':command)
       if(command.startsWith('LOGIN ')){emit(`${tag} ${state.imapDenied?'NO [AUTHENTICATIONFAILED] Refused':'OK Logged in'}\r\n`);continue}
       if(command==='EXAMINE INBOX'){emit(`* OK [UIDVALIDITY ${state.uidValidity}]\r\n* OK [UIDNEXT ${state.messages.length+1}]\r\n${tag} OK Selected\r\n`);continue}
       const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
       if(search){const ids=state.messages.map((_,i)=>i+1).filter(n=>n>=Number(search[1])&&n<=Number(search[2]));emit(`* SEARCH ${ids.join(' ')}\r\n${tag} OK Searched\r\n`);continue}
       const fetch=command.match(/^UID FETCH (\d+) \(UID BODY.PEEK\[\]\)$/)
       if(fetch){const raw=state.messages[Number(fetch[1])-1];assert.notEqual(raw,undefined);emit(`* 1 FETCH (UID ${fetch[1]} BODY[] {${Buffer.byteLength(raw)}}\r\n${raw})\r\n${tag} OK Fetched\r\n`);continue}
       throw new Error('Unexpected IMAP command')
      }
      if(data){if(line!=='.'){body+=line.replace(/^\.\./,'.')+'\r\n';continue}data=false;sent.push(body);body='';if(state.lost){wire.destroy();return}emit(`${state.smtpCode} ${state.smtpCode===250?'Accepted':'Refused'}\r\n`);continue}
      commands.push(line.startsWith('AUTH ')?'AUTH':line)
      if(line.startsWith('EHLO '))emit('250-mail.parcel.example\r\n250 AUTH PLAIN\r\n')
      else if(line.startsWith('AUTH PLAIN '))emit('235 Authenticated\r\n')
      else if(line.startsWith('MAIL FROM:')||line.startsWith('RCPT TO:'))emit('250 OK\r\n')
      else if(line==='DATA'){data=true;emit('354 Send message\r\n')}
      else throw new Error('Unexpected SMTP command')
     }
    })
   })
   server.on('tlsClientError',()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);ports[kind]=server.address().port
  }
  return {state,sent,commands,handshakes,async outbound(request){
   const url=new URL(request.url);assert.equal(url.hostname,'mail-tls-fixture.invalid')
   if(url.pathname!=='/connect'){
    const wire=connections.get(url.searchParams.get('id'));if(!wire)return new Response(null,{status:404})
    if(url.pathname==='/read')return new Response(Readable.toWeb(wire))
    if(url.pathname==='/close'){wire.destroy();connections.delete(url.searchParams.get('id'));return new Response(null,{status:204})}
    if(url.pathname==='/write'){const bytes=Buffer.from(await request.arrayBuffer());try{await new Promise((resolve,reject)=>wire.write(bytes,error=>error?reject(error):resolve()));return new Response(null,{status:204})}catch{return new Response(null,{status:502})}}
    throw new Error('Unknown TLS bridge operation')
   }
   assert.equal(url.searchParams.get('host'),'mail.parcel.example');const port=Number(url.searchParams.get('port'));assert.ok(ports[port])
   const wire=tls.connect({host:'127.0.0.1',port:ports[port],servername:state.wrongName?'wrong.parcel.example':'mail.parcel.example',ca:state.untrusted?undefined:cert,rejectUnauthorized:true,minVersion:'TLSv1.2'})
   sockets.add(wire);wire.on('error',()=>{});wire.on('close',()=>sockets.delete(wire))
   try{await new Promise((resolve,reject)=>{wire.once('secureConnect',resolve);wire.once('error',reject)})}catch{wire.destroy();return new Response('TLS handshake rejected',{status:502})}
   assert.equal(wire.authorized,true);handshakes.push({port,version:wire.getProtocol(),authorized:wire.authorized})
   const id=randomUUID();connections.set(id,wire);return Response.json({id})
  },async close(){for(const socket of sockets)socket.destroy();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));await rm(directory,{recursive:true,force:true})}}
 }catch(error){for(const socket of sockets)socket.destroy();for(const server of servers)server.close();await rm(directory,{recursive:true,force:true});throw error}
}
