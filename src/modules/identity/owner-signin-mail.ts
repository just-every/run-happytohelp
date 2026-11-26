import type {Env} from '../../platform/env'
import {emailConfigured,sendEmail,type EmailInput} from '../integrations/email'
import {ownerRelayMail,relayConfigured,sendRelayMail} from '../integrations/rer-relay-mail'

/** MAIL_RECIPIENTS=owner: the installation sends one message, the owner's own sign-in link, and only to the
 * configured owner address (H2H_SETUP_OWNER_EMAIL, else OWNER_EMAIL). Every other mail stays off exactly as
 * with MAIL_PROVIDER=none (emailExplicitlyOff), so customers and teammates receive nothing. The transport is
 * the owner's own provider, or with MAIL_PROVIDER=rer the platform's owner-only relay. */
const transport=(env:Env):Env=>({...env,MAIL_RECIPIENTS:undefined})
const address=/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

/** The one address an owner-only installation may mail, or null when owner-only sign-in mail is unavailable. */
export function ownerSigninAddress(env:Env){
 if(env.MAIL_RECIPIENTS!=='owner')return null
 const value=env.H2H_SETUP_OWNER_EMAIL||env.OWNER_EMAIL,owner=typeof value==='string'?value.trim().toLowerCase():''
 return address.test(owner)&&(ownerRelayMail(env)?relayConfigured(env):emailConfigured(transport(env)))?owner:null
}

/** Sends only when the sole recipient is the configured owner, checked before any request leaves. */
export async function sendOwnerSignin(env:Env,input:Pick<EmailInput,'to'|'subject'|'text'|'idempotencyKey'>){
 const owner=ownerSigninAddress(env)
 if(!owner||input.to!==owner)throw new Error('recipient_not_owner')
 if(ownerRelayMail(env))return sendRelayMail(env,{to:owner,subject:input.subject,text:input.text})
 return sendEmail(transport(env),{to:owner,subject:input.subject,text:input.text,idempotencyKey:input.idempotencyKey})
}
