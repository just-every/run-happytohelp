import {rerMail} from './rer-mail-contract'
import type {Env} from '../../platform/env'
import {localMailOrigin} from '../../edition/local-mail/configuration'
import {inboundNeedsCustomDomain} from '../management/activation/inbound-domain'
import {mailbox} from './inbound-routing'

export type MxResolver=(domain:string)=>Promise<string[]>
/** Mail exchangers for a domain; a null MX (`.`, RFC 7505) means the domain accepts no mail. */
export const resolveMx:MxResolver=async domain=>{
 const response=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(5000)})
 if(!response.ok)throw new Error('DNS resolver unavailable')
 const result=await response.json() as {Status:number;Answer?:Array<{type:number;data:string}>}
 if(result.Status===3)return []
 if(result.Status!==0)throw new Error('DNS lookup failed')
 return (result.Answer||[]).filter(a=>a.type===15).map(a=>a.data.trim().split(/\s+/).pop()!.replace(/\.$/,'')).filter(Boolean)
}

export type Receiving={address:string|null;ready:boolean;reason:'ready'|'no_address'|'local'|'no_token'|'workers_dev'|'no_mx'|'dns_unknown'|'managed_pending'|'managed_failed'}
const cache=new Map<string,{exchangers:string[]|null;at:number}>()
const CACHE_MS=5*60*1000

/** Whether mail sent to the workspace's receiving address can reach this installation.
 * Cloudflare Email Routing and SendGrid Inbound Parse both receive through the domain's MX
 * records, so a domain without one (a workers.dev host, an unrouted `in.` subdomain) cannot. */
export async function receivingState(env:Env,address:unknown,resolver:MxResolver=resolveMx):Promise<Receiving>{
 const base=mailbox(address)
 if(!base)return {address:null,ready:false,reason:'no_address'}
 const result=(reason:Receiving['reason'])=>({address:base,ready:reason==='ready',reason})
 if(rerMail(env)){
  const bound=await env.DB.prepare("SELECT state,route_active FROM rer_mailboxes WHERE address=? AND state<>'revoked' AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=rer_mailboxes.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(base).first<{state:string;route_active:number}>()
  return result(bound?.state==='active'&&bound.route_active?'ready':bound?.state==='failed'?'managed_failed':'managed_pending')
 }
 if(localMailOrigin(env))return result('local')
 const connected=await env.DB.prepare("SELECT 1 FROM mailbox_addresses address JOIN mailbox_connections mailbox ON mailbox.id=address.mailbox_id AND mailbox.project_id=address.project_id WHERE address.address=? AND mailbox.status='connected' AND mailbox.provider<>'forwarding'").bind(base).first()
 if(connected)return result('ready')
 if(typeof env.INBOUND_EMAIL_TOKEN!=='string'||!env.INBOUND_EMAIL_TOKEN)return result('no_token')
 if(inboundNeedsCustomDomain(base))return result('workers_dev')
 const domain=base.slice(base.indexOf('@')+1)
 if(domain==='localhost.test')return result('local')
 const known=resolver===resolveMx?cache.get(domain):undefined
 let exchangers=known&&Date.now()-known.at<CACHE_MS?known.exchangers:undefined
 if(exchangers===undefined){
  try{exchangers=await resolver(domain)}catch{exchangers=null}
  if(resolver===resolveMx&&exchangers)cache.set(domain,{exchangers,at:Date.now()})
 }
 if(exchangers===null)return result('dns_unknown')
 return result(exchangers.some(host=>host&&host!=='.')?'ready':'no_mx')
}
