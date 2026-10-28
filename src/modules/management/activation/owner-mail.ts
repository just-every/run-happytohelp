import {rerMail} from '../../integrations/rer-mail-contract'
import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {emailAddress} from '../../integrations/inbound-routing'
import type {Configuration} from './configuration'
import type {Probe} from './types'
import {providerJson,bearer} from './provider-http'
import {senderSwitch} from './sender'

/** The first-run welcome email is sent once, through the durable send path, under an idempotency key with this prefix. */
export const welcomeMailPrefix='welcome:'

// Repeated clicks and lost HTTP responses retain one command per sender/account/owner identity.
export async function testMailIdentity(config:Configuration,ownerId:string) {
 const owner=config.owners.find(row=>row.id===ownerId)
 if(!owner)return null
 return {owner,id:`activation:${await hashToken(JSON.stringify([config.projectId,config.fingerprints.owner_mail,owner.id,owner.email]))}`}
}

type SignIn={user_id:string;consumed_at:number}
/**
 * A sign-in link emailed to a person who is now an owner of this workspace, at their current address (its delivery
 * recorded `sent`), and then used to sign in. The link proves that person's mailbox whichever workspace it was issued
 * for: links are issued for the person's first workspace, so one link confirms every workspace they own. Password
 * sign-in, an unused link, a link used by someone who is not an owner here and a link to an address the owner no
 * longer has do not count. Reading it does no provider work.
 */
export async function usedSignInLink(env:Env,config:Configuration):Promise<SignIn|null> {
 return env.DB.prepare(`SELECT t.user_id,t.consumed_at FROM magic_signins t
  JOIN memberships m ON m.user_id=t.user_id AND m.project_id=? AND m.role='owner'
  JOIN users u ON u.id=t.user_id AND lower(u.email)=lower(t.email)
  JOIN email_deliveries d ON d.id='magic-signin:'||t.token_hash AND d.state='sent' AND lower(d.recipient)=lower(t.email)
  WHERE t.consumed_at IS NOT NULL
  ORDER BY t.consumed_at DESC LIMIT 1`).bind(config.projectId).first<SignIn>()
}

type Delivery={id:string;recipient:string;state:string;provider_id:string|null;created_at:number}
/** The latest owner-directed mail an owner asked for: the activation test mail or the first-run welcome email. */
async function latestOwnerDelivery(env:Env,config:Configuration,ownerId?:string):Promise<{delivery:Delivery;kind:'test'|'welcome'}|null> {
 const owners=config.owners.filter(owner=>!ownerId||owner.id===ownerId)
 let latest:{delivery:Delivery;kind:'test'|'welcome'}|null=null
 const consider=(delivery:Delivery|null,kind:'test'|'welcome')=>{if(delivery&&(!latest||delivery.created_at>latest.delivery.created_at))latest={delivery,kind}}
 for(const owner of owners) {
  const identity=await testMailIdentity(config,owner.id)
  consider(identity&&await env.DB.prepare('SELECT * FROM email_deliveries WHERE id=? AND project_id=? AND recipient=?').bind(identity.id,config.projectId,owner.email).first<Delivery>(),'test')
  consider(await env.DB.prepare('SELECT * FROM email_deliveries WHERE project_id=? AND substr(id,1,?)=? AND lower(recipient)=lower(?) ORDER BY created_at DESC LIMIT 1').bind(config.projectId,welcomeMailPrefix.length,welcomeMailPrefix,owner.email).first<Delivery>(),'welcome')
 }
 return latest
}

// Read by a person: a UTC date and minute, never a raw ISO timestamp.
const at=(time:number)=>new Date(time).toISOString().replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/,'$1 $2 UTC')
/**
 * "Email to you". A used emailed sign-in link confirms it without any provider request. Otherwise the latest test or
 * welcome mail is reported as its provider reports it: Resend status is read for the exact message, sender and owner;
 * other providers report acceptance only. Nothing here sends or resends.
 * https://resend.com/docs/api-reference/emails/retrieve-email
 */
export async function checkOwnerMail(env:Env,config:Configuration,ownerId?:string):Promise<Probe> {
 if(config.mailMode==='local')return {state:'pending',detail:'Email is suppressed during local development. No email is sent. Configure a provider on your hosted installation to confirm delivery.'}
 const signIn=await usedSignInLink(env,config)
 if(signIn)return {state:'done',detail:`You signed in with a link emailed to you at ${at(signIn.consumed_at)}, so mail from this installation reaches your mailbox.`,receiptRef:`signin:${signIn.user_id}:${signIn.consumed_at}`}
 const found=await latestOwnerDelivery(env,config,ownerId)
 if(!found) {
  if(config.mailMode==='unavailable'&&rerMail(env))return {state:'unavailable',detail:'Run Edit Run is activating managed email. No customer email setup is needed.'}
  if(config.mailMode==='unavailable')return {state:'unavailable',detail:'CONFIGURATION_REQUIRED: EMAIL_API_KEY and EMAIL_FROM. Add the email provider settings to the installation; mail to you cannot be sent or confirmed until then.'}
  return {state:'pending',detail:'Not confirmed yet. Sign in once with an emailed link, or send yourself a test from Email settings.'}
 }
 const {delivery,kind}=found,name=kind==='welcome'?'welcome email':'test message'
 if(delivery.state==='failed')return {state:'failed',detail:`The provider rejected the ${name}. Review the provider log; it will not be sent again automatically.`,receiptRef:delivery.id}
 if(delivery.state==='uncertain'||delivery.state==='sending')return {state:'unknown',detail:`The ${name} send outcome is unknown. Reconcile it with the provider; it is never resent.`,receiptRef:delivery.id}
 if(config.providerName!=='resend')return {state:'pending',detail:`${config.providerName==='rer'?'Run Edit Run':config.providerName||'The provider'} accepted the ${name} (sent). This provider reports no delivery status here; sign in once with an emailed link to confirm you received it.`,receiptRef:delivery.id}
 if(!env.EMAIL_API_KEY)return {state:'unavailable',detail:'CONFIGURATION_REQUIRED: EMAIL_API_KEY. Install the selected email provider key to read delivery status.',receiptRef:delivery.id}
 if(!delivery.provider_id)return {state:'unknown',detail:'The provider did not retain a message ID for delivery lookup.',receiptRef:delivery.id}
 const body=await providerJson(`https://api.resend.com/emails/${encodeURIComponent(delivery.provider_id)}`,bearer(env.EMAIL_API_KEY))
 if(body.id!==delivery.provider_id||!Array.isArray(body.to)||body.to.length!==1||emailAddress(body.to[0])!==delivery.recipient.toLowerCase())return {state:'unknown',detail:`Provider status did not match the ${name} and owner recipient.`,receiptRef:delivery.id}
 // Mail from the installation sender that this workspace's verified sender replaced still reached the owner.
 const switched=senderSwitch(config.settings),from=emailAddress(body.from)
 if(from!==config.sender&&!(switched&&switched.to===config.sender&&from===switched.from))return {state:'pending',detail:`The ${name} was sent from an earlier sender address. Sign in once with an emailed link, or send yourself a new test from Email settings.`,receiptRef:delivery.id}
 const event=body.last_event
 if(event==='delivered')return {state:'done',detail:`The provider reported the ${name} delivered to your mailbox server.`,receiptRef:`resend:${delivery.provider_id}:delivered`}
 if(['bounced','failed','suppressed'].includes(event))return {state:'failed',detail:`The provider reported ${event} for the ${name}.`,receiptRef:`resend:${delivery.provider_id}:${event}`}
 return {state:['sent','queued','scheduled','delivery_delayed'].includes(event)?'pending':'unknown',detail:`The ${name} was sent; the provider has not reported delivery yet. Sending or queue acceptance does not confirm it.`,receiptRef:delivery.id}
}
