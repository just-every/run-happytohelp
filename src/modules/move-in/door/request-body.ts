import {DoorError} from '../../import-kit/src/door/index'
const maximum=100000
/** Match Base's JSON envelope bound before reading HH-specific resume fields. */
export async function doorBody(request:Request):Promise<Record<string,unknown>>{
 const reader=request.clone().body?.getReader();if(!reader)throw new DoorError('invalid_input',400)
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw new DoorError('request_too_large',413);chunks.push(part.value)}}finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new DoorError('invalid_json',400)}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DoorError('invalid_input',400)
 return value
}
/** Finish a bounded JSON request even when admission closes before Base reads
 * it. Leaving its body unread can reset an HTTP proxy's response connection. */
export async function discardUnreadRequest(request:Request){
 if(!request.body||request.bodyUsed)return
 const reader=request.body.getReader();let bytes=0
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum)break}}finally{
  // A cloned branch may still be held by Base: cancellation must not await it.
  void reader.cancel().catch(()=>{});reader.releaseLock()
 }
}
