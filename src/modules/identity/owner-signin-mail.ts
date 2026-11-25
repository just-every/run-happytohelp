import type {Env} from '../../platform/env'
import {emailConfigured,sendEmail,type EmailInput} from '../integrations/email'

/** MAIL_RECIPIENTS=owner: the installation sends one message, the owner's own sign-in link, and only to the
 * configured owner address (H2H_SETUP_OWNER_EMAIL, else OWNER_EMAIL). Every other mail stays off exactly as
 * with MAIL_PROVIDER=none (emailExplicitlyOff), so customers and teammates receive nothing. */
const transport=(env:Env):Env=>({...env,MAIL_RECIPIENTS:undefined})
const address=/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

/** The one address an owner-only installation may mail, or null when owner-only sign-in mail is unavailable. */
export function ownerSigninAddress(env:Env){
 if(env.MAIL_RECIPIENTS!=='owner')return null
 const value=env.H2H_SETUP_OWNER_EMAIL||env.OWNER_EMAIL,owner=typeof value==='string'?value.trim().toLowerCase():''
 return address.test(owner)&&emailConfigured(transport(env))?owner:null
}

/** Sends through the configured provider only when the sole recipient is the configured owner. */
export async function sendOwnerSignin(env:Env,input:Pick<EmailInput,'to'|'subject'|'text'|'idempotencyKey'>){
 const owner=ownerSigninAddress(env)
 if(!owner||input.to!==owner)throw new Error('recipient_not_owner')
 return sendEmail(transport(env),{to:owner,subject:input.subject,text:input.text,idempotencyKey:input.idempotencyKey})
}
