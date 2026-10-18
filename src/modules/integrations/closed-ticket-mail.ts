import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {emailConfigured,sendEmail} from './email'

/** A Closed ticket is final. A workspace member's mail to one is refused: nothing is
 * stored as a message and no contact is made from the member's address. */
export const CLOSED_TICKET_FINAL='Not delivered: this ticket is Closed, and a Closed ticket is final. Nothing was added to it or sent to the customer. Reply from the HappyToHelp dashboard.'
/** `notice` names who is told and about which ticket. It is set only for a sender whose
 * From was authenticated or who used their own reply address, so forged mail never
 * makes the desk write to a member. */
export interface ClosedTicketNotice {projectId:string;conversationId:string;member:string;subject:string;receiptId:string}
/** 422, never 409: the doors treat 409 as mail already received and swallow it. The
 * Worker turns it into a bounce; SendGrid, the gateway and connected inboxes send
 * `noticeMember` and answer with it. */
export class ClosedTicketRefusal extends HTTPException {
 constructor(readonly notice:ClosedTicketNotice|null){super(422,{message:CLOSED_TICKET_FINAL})}
}
export async function isMemberAddress(env:Env,projectId:string,email:string){
 return Boolean(await env.DB.prepare('SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=?').bind(projectId,email).first())
}
/** One notice per refused message (its receipt is the idempotency key). */
export async function noticeMember(env:Env,refusal:ClosedTicketRefusal,receivingMailboxId?:string){
 const notice=refusal.notice
 if(!notice)return
 const mailboxId=!emailConfigured(env)?receivingMailboxId:undefined
 if(!mailboxId&&!emailConfigured(env))return
 const link=typeof env.APP_ORIGIN==='string'&&env.APP_ORIGIN?new URL(`/projects/${encodeURIComponent(notice.projectId)}/conversations/${encodeURIComponent(notice.conversationId)}`,env.APP_ORIGIN).href:null
 const ticket=notice.subject.trim()?`"${notice.subject.trim().slice(0,200)}"`:'this ticket'
 await sendEmail(env,{projectId:notice.projectId,mailboxId,to:notice.member,subject:`Not delivered: ${notice.subject.trim()?notice.subject.trim().slice(0,150):'ticket'} is Closed`,
  text:[`Your email reply to ${ticket} was not added. That ticket is Closed, and a Closed ticket is final: it takes no more replies.`,'Nothing was stored or sent to the customer. To answer them, reply from the HappyToHelp dashboard.',...(link?[link]:[])].join('\n\n'),
  idempotencyKey:`closed-ticket-refusal:${notice.receiptId}`,headers:{'Auto-Submitted':'auto-replied','X-Auto-Response-Suppress':'All'}})
}
