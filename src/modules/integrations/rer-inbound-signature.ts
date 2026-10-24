import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {canonical,rawDigest,rerMail} from './rer-mail-contract'
import {inboundTarget} from './inbound-routing'

export const rerInboundPath='/api/integrations/email/rer/v1/inbound'
export interface RerInboundMetadata {version:1;deliveryId:string;mailboxId:string;workspaceId:string;generation:number;envelopeFrom:string;envelopeTo:string;verdict:'verified'|'failed'|'unproven';timestamp:number;bodySha256:string}
const refuse=()=>new HTTPException(403,{message:'Inbound mail authentication refused'})
function decode(value:string|null,limit:number){
 if(!value||value.length>limit||!/^[A-Za-z0-9_-]+$/.test(value))throw refuse()
 try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))}catch{throw refuse()}
}
/** The trusted edge signs its verdict. MIME Authentication-Results never supply
 * authority here. WebCrypto verifies HMAC in constant time. */
export async function authenticateRerInbound(env:Env,request:Request,raw:Uint8Array):Promise<RerInboundMetadata>{
 const url=new URL(request.url)
 if(!rerMail(env)||env.H2H_RER_MAIL_VERSION!=='1'||typeof env.RER_MAIL_INGRESS_KEY!=='string'||!env.RER_MAIL_INGRESS_KEY||request.method!=='POST'||url.pathname!==rerInboundPath||url.search)throw refuse()
 let m:any
 try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(request.headers.get('X-RER-Mail-Metadata'),8192)))}catch{throw refuse()}
 const names=['version','deliveryId','mailboxId','workspaceId','generation','envelopeFrom','envelopeTo','verdict','timestamp','bodySha256']
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==names.length||Object.keys(m).some(key=>!names.includes(key))||m.version!==1||!['verified','failed','unproven'].includes(m.verdict)||!Number.isSafeInteger(m.generation)||m.generation<1||!Number.isSafeInteger(m.timestamp)||Math.abs(Date.now()-m.timestamp)>5*60*1000||typeof m.bodySha256!=='string'||!/^[a-f0-9]{64}$/.test(m.bodySha256)||['deliveryId','mailboxId','workspaceId'].some(name=>typeof m[name]!=='string'||!m[name]||m[name].length>200||/[\x00-\x1f\x7f]/.test(m[name]))||typeof m.envelopeFrom!=='string'||m.envelopeFrom.length>320||/[\r\n\0]/.test(m.envelopeFrom)||typeof m.envelopeTo!=='string'||m.envelopeTo.length>320||/[\r\n\0]/.test(m.envelopeTo)||await rawDigest(raw)!==m.bodySha256)throw refuse()
 const prefix=new TextEncoder().encode(`POST\n${rerInboundPath}\n${canonical(m)}\n`),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.RER_MAIL_INGRESS_KEY),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 const signature=decode(request.headers.get('X-RER-Mail-Signature'),100)
 if(signature.byteLength!==32||!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature).buffer,signed.buffer))throw refuse()
 const bound=await env.DB.prepare(`SELECT b.address FROM rer_mailboxes b JOIN email_settings e ON e.project_id=b.project_id WHERE b.project_id=? AND b.mailbox_id=? AND b.generation=? AND b.state='active' AND b.route_active=1 AND e.is_enabled=1 AND e.inbound_address=b.address AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=b.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(m.workspaceId,m.mailboxId,m.generation).first<{address:string}>()
 if(!bound||inboundTarget(m.envelopeTo)?.mailbox!==bound.address)throw refuse()
 return m
}
