import {rerMail} from '../../integrations/rer-mail-contract'
import type {Env} from '../../../platform/env'
import {sendEmail,emailConfigured} from '../../integrations/email'
import {checkSenderDomain} from '../../integrations/sender-domain'
import type {Configuration} from './configuration'
import {senderDnsAddress} from './sender'
import type {Probe,SenderRecord} from './types'
import {providerJson,bearer} from './provider-http'
import {checkOwnerMail,testMailIdentity} from './owner-mail'

/** The explicit owner action: one test message to the authenticated owner, under a durable identity that is never replayed.
 * Local development validates and suppresses it without sending mail. */
export async function sendOwnerTestMail(env:Env,config:Configuration,ownerId:string):Promise<Probe> {
 const identity=await testMailIdentity(config,ownerId)
 if(!identity)return {state:'unavailable',detail:'Only a workspace owner can send a test to their own mailbox.'}
 const existing=await env.DB.prepare('SELECT state FROM email_deliveries WHERE id=? AND project_id=?').bind(identity.id,config.projectId).first()
 if(existing)return checkOwnerMail(env,config,ownerId)
 if(!emailConfigured(env)&&rerMail(env))return {state:'unavailable',detail:'Run Edit Run is activating managed email. No customer email setup is needed.'}
 if(!emailConfigured(env))return {state:'unavailable',detail:'CONFIGURATION_REQUIRED: EMAIL_API_KEY and EMAIL_FROM. Add email secrets to the installation.'}
 if(!config.sender)return {state:'pending',detail:'Save a sender email address in Email settings.'}
 try {
  await sendEmail(env,{projectId:config.projectId,to:identity.owner.email,idempotencyKey:identity.id,subject:'HappyToHelp activation test',text:'This is your HappyToHelp activation test. Delivery is confirmed separately using provider status.',headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}})
 } catch { /* The durable delivery record distinguishes rejection from uncertainty. Never replay. */ }
 return checkOwnerMail(env,config,ownerId)
}

const text=(value:unknown)=>typeof value==='string'?value:typeof value==='number'?String(value):''
/** The provider's DNS records for the sending domain: public DNS names and values only. */
function senderRecords(records:any[]):SenderRecord[] {
 return records.filter(record=>record&&typeof record==='object').map(record=>({type:text(record.type)||text(record.record),name:text(record.name),value:text(record.value),status:text(record.status)}))
  .filter(record=>record.type&&record.name&&record.value)
}
/** https://resend.com/docs/api-reference/domains/list-domains
 * https://resend.com/docs/api-reference/domains/get-domain
 * Reads only: a domain the owner has not added at the provider is reported, never created. The workspace's proposed
 * sender is checked while mail still goes out from the installation sender; once the owner has chosen another address,
 * that address's domain is checked instead. */
export async function checkSenderDns(env:Env,config:Pick<Configuration,'sender'|'providerName'>&{proposedSender?:string|null;senderOverridden?:boolean}):Promise<Probe> {
 if(rerMail(env)){
  const bound=await env.DB.prepare("SELECT configured,state,address,error FROM rer_mailboxes WHERE address=?").bind(config.sender).first<{configured:number;state:string;address:string;error:string|null}>()
  return {state:bound?.state==='active'&&bound.configured?'done':bound?.state==='failed'?'failed':'pending',receiptRef:bound?.state==='active'?`rer:configured:${bound.address}`:null,detail:bound?.state==='active'&&bound.configured?`Run Edit Run configured ${bound.address} for this workspace. This confirms configuration, not email delivery.`:bound?.error||'Run Edit Run is activating your assigned email address.'}
 }
 const address=senderDnsAddress(config)
 if(!address)return {state:'pending',detail:'Save a sender email address in Email settings.'}
 if(!config.providerName)return {state:'unavailable',detail:'Select an email provider in installation settings.'}
 if(!env.EMAIL_API_KEY)return {state:'unavailable',detail:'CONFIGURATION_REQUIRED: EMAIL_API_KEY. Install a provider key with domain read permission.'}
 if(config.providerName!=='resend')return {state:'unavailable',detail:`${config.providerName} domain verification is not available through this adapter. A supported authoritative domain-status API is required.`}
 const domain=address.split('@')[1]
 const list=await providerJson('https://api.resend.com/domains',bearer(env.EMAIL_API_KEY))
 if(!Array.isArray(list.data))return {state:'unknown',detail:'Provider omitted its domain list.'}
 const found=list.data.find((row:any)=>typeof row?.name==='string'&&row.name.toLowerCase()===domain)
 if(!found?.id)return {state:list.has_more?'unavailable':'pending',detail:list.has_more?'The sending domain is not in the returned page. Domain status access for this domain is required.':`Add and verify ${domain} in your email provider. Its DNS records appear here once the domain exists there.`,observation:{senderRecords:[]}}
 const body=await providerJson(`https://api.resend.com/domains/${encodeURIComponent(found.id)}`,bearer(env.EMAIL_API_KEY))
 if(body.id!==found.id||body.name?.toLowerCase()!==domain||!Array.isArray(body.records))return {state:'unknown',detail:'Provider omitted the expected domain or DNS records.'}
 const observation={senderRecords:senderRecords(body.records)}
 const records=body.records.filter((record:any)=>['SPF','DKIM'].includes(record.record))
 const valid=body.status==='verified'&&records.some((r:any)=>r.record==='SPF')&&records.some((r:any)=>r.record==='DKIM')&&records.every((r:any)=>r.status==='verified')
 if(valid){
  const dns=await checkSenderDomain(domain)
  if(!dns.ok)return {state:dns.records.some(record=>record.status==='unknown')?'unknown':'pending',detail:dns.records.filter(record=>record.status!=='present').map(record=>record.message).join('. '),observation}
 }
 return {state:valid?'done':body.status==='failed'?'failed':'pending',detail:valid?`Provider verified ${domain} and its required SPF/DKIM DNS records.`:`${domain} DNS is not fully verified. Add the listed records at your DNS host and allow propagation; we keep watching.`,receiptRef:`resend:domain:${body.id}`,observation}
}
