import worker from '../../journeys/kit/app-worker'
import {MailSocket} from '../../../src/modules/integrations/mailboxes/socket'

// Test-only IMAP/SMTP byte edge. All application routes, protocol parsers,
// credentials, cursors and admission remain real. No fixture enters src/.
let state={messages:[] as string[],uidValidity:'42',imapDenied:false,smtpCode:250,lost:false}
const sent:string[]=[],commands:string[]=[]
MailSocket.open=async(host,port)=>{
 if(host!=='mail.parcel.example'||![993,465].includes(port))throw new Error('Unexpected socket destination')
 let output:ReadableStreamDefaultController<Uint8Array>,pending='',data=false,body='',closed=false
 const emit=(text:string)=>{if(!closed){const bytes=new TextEncoder().encode(text);for(let offset=0;offset<bytes.length;offset+=17)output.enqueue(bytes.slice(offset,offset+17))}}
 let done!:()=>void
 const closedPromise=new Promise<void>(resolve=>{done=resolve})
 const close=async()=>{if(!closed){closed=true;output.close();done()}}
 const readable=new ReadableStream<Uint8Array>({start(controller){output=controller;emit(port===993?'* OK IMAP ready\r\n':'220 SMTP ready\r\n')}})
 const writable=new WritableStream<Uint8Array>({write(chunk){
  pending+=new TextDecoder().decode(chunk)
  for(;;){const end=pending.indexOf('\r\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+2)
   if(port===993){
    const split=line.indexOf(' '),tag=line.slice(0,split),command=line.slice(split+1)
    commands.push(command.startsWith('LOGIN ')?'LOGIN':command)
    if(command.startsWith('LOGIN ')){emit(`${tag} ${state.imapDenied?'NO [AUTHENTICATIONFAILED] Refused':'OK Logged in'}\r\n`);continue}
    if(command==='EXAMINE INBOX'){emit(`* OK [UIDVALIDITY ${state.uidValidity}]\r\n* OK [UIDNEXT ${state.messages.length+1}]\r\n${tag} OK Selected\r\n`);continue}
    const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
    if(search){const ids=state.messages.map((_,i)=>i+1).filter(n=>n>=Number(search[1])&&n<=Number(search[2]));emit(`* SEARCH ${ids.join(' ')}\r\n${tag} OK Searched\r\n`);continue}
    const fetch=command.match(/^UID FETCH (\d+) \(UID BODY.PEEK\[\]\)$/)
    if(fetch){const raw=state.messages[Number(fetch[1])-1];if(raw===undefined)throw new Error('Unknown UID');emit(`* 1 FETCH (UID ${fetch[1]} BODY[] {${new TextEncoder().encode(raw).length}}\r\n${raw})\r\n${tag} OK Fetched\r\n`);continue}
    throw new Error('Unexpected IMAP command')
   }
   if(data){if(line!=='.'){body+=line.replace(/^\.\./,'.')+'\r\n';continue}data=false;sent.push(body);body='';if(state.lost){void close();return}emit(`${state.smtpCode} ${state.smtpCode===250?'Accepted':'Refused'}\r\n`);continue}
   commands.push(line.startsWith('AUTH ')?'AUTH':line)
   if(line.startsWith('EHLO '))emit('250-mail.parcel.example\r\n250 AUTH PLAIN\r\n')
   else if(line.startsWith('AUTH PLAIN '))emit('235 Authenticated\r\n')
   else if(line.startsWith('MAIL FROM:')||line.startsWith('RCPT TO:'))emit('250 OK\r\n')
   else if(line==='DATA'){data=true;emit('354 Send message\r\n')}
   else throw new Error('Unexpected SMTP command')
  }
 }})
 return new MailSocket({readable,writable,closed:closedPromise,close} as any)
}
export {ConversationSocket} from '../../journeys/kit/app-worker'
export default {
 ...worker,
 async fetch(request:Request,env:any,context:ExecutionContext){
  if(new URL(request.url).pathname==='/_test/mail-socket'){
   if(request.method==='POST')state={...state,...await request.json<typeof state>()}
   return Response.json({sent,commands})
  }
  return worker.fetch(request,env,context)
 },
}
