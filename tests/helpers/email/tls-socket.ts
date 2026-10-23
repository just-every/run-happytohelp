// Test-only platform transport to a certificate-validating Node TLS client.
// Product MailSocket.open, framing and mailbox routes run unchanged in workerd.
export function connect(address:{hostname:string;port:number},options:{secureTransport:string;allowHalfOpen:boolean}){
 if(options.secureTransport!=='on'||options.allowHalfOpen!==false)throw new Error('Mailbox must request immediate TLS')
 const base='https://mail-tls-fixture.invalid'
 let id='',output:ReadableStreamDefaultController<Uint8Array>,ended=false,resolve!:()=>void
 const closed=new Promise<void>(done=>{resolve=done})
 const finish=(error?:unknown)=>{if(!ended){ended=true;error?output.error(error):output.close()}resolve()}
 const readable=new ReadableStream<Uint8Array>({start(controller){output=controller}})
 const opened=(async()=>{
  const response=await fetch(base+'/connect?'+new URLSearchParams({host:address.hostname,port:String(address.port)}))
  if(!response.ok)throw new Error('TLS handshake refused')
  id=(await response.json() as {id:string}).id
  void (async()=>{const stream=await fetch(base+'/read?id='+id);if(!stream.ok||!stream.body)throw new Error('TLS read failed');const reader=stream.body.getReader();while(!ended){const next=await reader.read();if(next.done)break;output.enqueue(next.value)}finish()})().catch(finish)
 })().catch(error=>{finish(error);throw error})
 void opened.catch(()=>{})
 const writable=new WritableStream<Uint8Array>({async write(bytes){await opened;if(ended)throw new Error('TLS connection closed');const response=await fetch(base+'/write?id='+id,{method:'POST',body:bytes});if(!response.ok)throw new Error('TLS write failed')}})
 return {readable,writable,opened,closed,async close(){finish();if(id)await fetch(base+'/close?id='+id,{method:'POST'})}}
}
