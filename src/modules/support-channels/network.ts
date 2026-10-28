import {HTTPException} from 'hono/http-exception'
/** Every caller selects a fixed provider origin before passing credentials. No implicit redirects. */
export async function boundedFetch(url:string,init:RequestInit={},limit=65536){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
 try{
  const response=await fetch(url,{...init,redirect:'manual',signal:controller.signal})
  if(Number(response.headers.get('content-length'))>limit)throw new HTTPException(413,{message:'Provider response is too large'})
  reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>limit)throw new HTTPException(413,{message:'Provider response is too large'});chunks.push(value)}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength}
  return {status:response.status,headers:response.headers,data}
 }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{})}
}
export async function providerJson(url:string,init:RequestInit={}){
 const response=await boundedFetch(url,init)
 if(response.status<200||response.status>=300)throw new HTTPException(502,{message:'Provider request refused. Check the connected account and its permissions.'})
 try{return JSON.parse(new TextDecoder().decode(response.data))}catch{throw new HTTPException(502,{message:'Invalid provider response'})}
}
export function safeUrl(value:string,allowed:(url:URL)=>boolean){
 let url:URL;try{url=new URL(value)}catch{throw new HTTPException(422,{message:'Invalid provider attachment URL'})}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed(url))throw new HTTPException(422,{message:'Attachment is outside the connected provider. Retain the event for review.'})
 return url.href
}
