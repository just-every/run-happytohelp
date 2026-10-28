import type {MobileCredential,PurgeReason} from './client-state'

export class MobileClientError extends Error {
 constructor(message:string,readonly status=0,readonly detail:Record<string,unknown>={}){super(message);this.name='MobileClientError'}
}
export type MobileFetch=(input:string,init:RequestInit)=>Promise<Response>

/** One attempt per explicit call. No cookie authority, redirects, HTTP cache,
 * retry middleware, durable storage, command queue or background sending. */
export class MobileTransport {
 #credential:MobileCredential|null
 #generation=0
 #requests=new Set<AbortController>()
 readonly origin:string
 constructor(origin:string,credential:MobileCredential,private fetcher:MobileFetch,private onPurge:(reason:PurgeReason)=>void,private onOffline:()=>void){
  const url=new URL(origin)
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use an HTTPS application origin')
  this.origin=url.origin;this.#credential={...credential,scopes:[...credential.scopes]}
 }
 get credential(){return this.#credential?{...this.#credential,scopes:[...this.#credential.scopes]}:null}
 cancel(){this.#generation++;for(const request of this.#requests)request.abort();this.#requests.clear()}
 purge(){this.cancel();if(this.#credential){this.#credential.token='';this.#credential.scopes=[];this.#credential=null}}
 async signOut(){
  const credential=this.#credential
  if(!credential)return {serverRevoked:false}
  // This explicit sign-out attempt survives local cancellation of data reads.
  try{const response=await this.fetcher(this.origin+'/api/mobile/v1/session',{method:'DELETE',headers:{Authorization:'Bearer '+credential.token},credentials:'omit',cache:'no-store',redirect:'error'});await response.body?.cancel();return {serverRevoked:response.ok}}catch{return {serverRevoked:false}}
 }
 async request<T>(path:string,init:RequestInit={},binary=false):Promise<T>{
  const credential=this.#credential
  if(!credential)throw new MobileClientError('Sign in again',401)
  if(credential.expiresAt<=Date.now()){this.onPurge('revocation');throw new MobileClientError('Device access expired',401)}
  const generation=this.#generation,controller=new AbortController()
  this.#requests.add(controller)
  try{
   const response=await this.fetcher(this.origin+'/api/mobile/v1'+path,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+credential.token},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal})
   if(generation!==this.#generation)throw new MobileClientError('This session changed',401)
   // Honour purge even when an intermediary replaces the JSON body.
   if(response.status===401||response.status===403||response.headers.get('Mobile-Cache-Action')==='purge'){
    await response.body?.cancel();this.onPurge(response.status===403?'authority-change':'revocation');throw new MobileClientError('Device access ended. Sign in again.',response.status===403?403:401)
   }
   if(binary&&response.ok){const bytes=new Uint8Array(await response.arrayBuffer());if(generation!==this.#generation){bytes.fill(0);throw new MobileClientError('This session changed',401)}return bytes as T}
   const data=await response.json() as Record<string,unknown>
   if(generation!==this.#generation){throw new MobileClientError('This session changed',401)}
   if(data.purge===true){this.onPurge('revocation');throw new MobileClientError('Device access ended. Sign in again.',401)}
   if(!response.ok)throw new MobileClientError(typeof data.error==='string'?data.error:'Request refused',response.status,data)
   return data as T
  }catch(error){
   if(error instanceof MobileClientError)throw error
   if(generation!==this.#generation)throw new MobileClientError('This session changed',401)
   this.onOffline();throw new MobileClientError('Connection lost. Reconnect and review before continuing.')
  }finally{this.#requests.delete(controller)}
 }
}
