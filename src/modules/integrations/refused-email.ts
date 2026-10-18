import type {Env} from '../../platform/env'
import type {IncomingEmail} from './inbound-service'
import {hashToken} from '../../platform/auth'
import {suspendEmail} from './suspended-store'

/** Retain a refused copy separately: its original receipt and admitted message
 * remain immutable. Review can retain it as a private note, never impersonate its
 * sender or release conflicting content under the original Message-ID. */
export async function suspendRefusedEmail(env:Env,input:IncomingEmail,context:{projectId:string;identity:string;reason:string}){
 const receiptId=`refused-${await hashToken(`${context.projectId}:${input.messageId}:${context.identity}`)}`,claimToken=crypto.randomUUID()
 await env.DB.prepare("INSERT OR IGNORE INTO inbound_emails(id,project_id,intent_hash,state,created_at,claim_token) VALUES(?,?,?,'processing',?,?)").bind(receiptId,context.projectId,context.identity,Date.now(),claimToken).run()
 const prior=await env.DB.prepare('SELECT state,claim_token FROM inbound_emails WHERE id=? AND project_id=?').bind(receiptId,context.projectId).first<{state:string;claim_token:string}>()
 if(prior?.state!=='processing')return
 await suspendEmail(env,{...input,messageId:receiptId,senderAuthenticated:false},
  {projectId:context.projectId,receiptId,claimToken:prior.claim_token,reason:context.reason})
}
