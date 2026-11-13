import {createHash} from 'node:crypto'
import {refuse} from './errors'
/** Bounded allocation and incremental counting/hashing also cover chunked bodies. */
export async function readBody(request:Request,max:number,code:string,expected?:number){
 if(Number(request.headers.get('Content-Length'))>max)refuse(413,code,'File exceeds the package upload limit')
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 const hash=createHash('sha256')
 try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();refuse(413,code,'File exceeds the package upload limit')}if(expected!==undefined&&size>expected){await reader.cancel();refuse(422,'size_mismatch','File size differs from its manifest')}hash.update(value);chunks.push(value)}}finally{reader?.releaseLock()}
 if(expected!==undefined&&size!==expected)refuse(422,'size_mismatch','File size differs from its manifest')
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 return {bytes,sha256:hash.digest('hex')}
}
export function parseJson(bytes:Uint8Array,code='invalid_manifest'):unknown{
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{refuse(400,code,'Expected valid UTF-8 JSON')}
}
