import {ZendeskError} from './errors'
export const SCOPES=['read','hc:read'] as const
export const SUBDOMAIN=/^[a-z0-9][a-z0-9-]{0,62}$/
export const CLIENT_ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const zendeskOrigin=(subdomain:string)=>{if(!SUBDOMAIN.test(subdomain))throw new ZendeskError('zendesk_subdomain_invalid');return `https://${subdomain}.zendesk.com`}
export interface ZendeskResponse {status:number;data:any;retryAfter?:number}
/** Every Zendesk request goes to the connection's own subdomain and never follows a redirect. */
export async function zendeskFetch(subdomain:string,path:string,init:{method:'GET'|'POST'|'DELETE';token?:string;body?:unknown}):Promise<ZendeskResponse>{
 const origin=zendeskOrigin(subdomain),url=new URL(path,origin)
 if(url.origin!==origin||url.username||url.password)throw new ZendeskError('zendesk_request_origin_changed')
 let response:Response
 try{response=await fetch(url,{method:init.method,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Accept:'application/json',...(init.token?{Authorization:`Bearer ${init.token}`}:{}),...(init.body!==undefined?{'Content-Type':'application/json'}:{})},...(init.body!==undefined?{body:JSON.stringify(init.body)}:{})})}
 catch{throw new ZendeskError('zendesk_unreachable')}
 const retry=Number(response.headers.get('Retry-After')),text=await response.text()
 let data:any=null;if(text){try{data=JSON.parse(text)}catch{data=null}}
 return {status:response.status,data,...(Number.isFinite(retry)&&retry>=0?{retryAfter:retry}:{})}
}
