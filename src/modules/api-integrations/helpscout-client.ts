/** Fixed-origin Help Scout reads. Provider text and credentials never become errors. */
export class ScoutError extends Error {constructor(public code:string){super(code)}}
export function scoutClient(credentials:{app_id:string;app_secret:string}){
 let calls=0,bytes=0
 const deadline=Date.now()+30000
 async function request(path:string,options:RequestInit={}){
  const url=new URL(path,'https://api.helpscout.net')
  if(url.origin!=='https://api.helpscout.net'||url.username||url.password||!url.pathname.startsWith('/v2/')||++calls>128||Date.now()>=deadline)throw new ScoutError('pull_limit')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(10000,deadline-Date.now()))
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  try{
   const response=await fetch(url,{...options,redirect:'manual',signal:controller.signal})
   if(!response.ok){await response.body?.cancel();throw new ScoutError(response.status===429?'rate_limited':response.status===401||response.status===403?'credentials_refused':response.status>=300&&response.status<400?'redirect_refused':'provider_unavailable')}
   if(Number(response.headers.get('content-length'))>65536){await response.body?.cancel();throw new ScoutError('response_size')}
   reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0
   if(reader)for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;bytes+=next.value.length;if(size>65536||bytes>2097152)throw new ScoutError('response_size');chunks.push(next.value)}
   const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length}
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(data)
   return {raw,data:JSON.parse(raw)}
  }catch(error){if(error instanceof ScoutError)throw error;throw new ScoutError(controller.signal.aborted?'timeout':'provider_unavailable')}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});reader?.releaseLock()}
 }
 return {
  async access(){const result=await request('/v2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:credentials.app_id,client_secret:credentials.app_secret})});if(typeof result.data.access_token!=='string'||!result.data.access_token||result.data.access_token.length>4096)throw new ScoutError('credentials_refused');return result.data.access_token as string},
  async get(path:string,token:string){return request(path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'}})}
 }
}
