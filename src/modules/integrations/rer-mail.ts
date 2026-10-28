import {notificationFetch} from './email-send-window'
import type {Env} from '../../platform/env'
import type {EmailInput} from './email'
import {hashToken} from '../../platform/auth'
import {mailService,mailJson,managedMailbox,maxMailBytes,managedMailAddress} from './rer-mail-contract'
import {emailThreadingStatements,messageIds} from './email-threading'
import {auditStatement} from '../audit/record'
import {rerMailHeld,authorityUnavailable,rerMailCredentialRefused} from './rer-mail-hold'

export class RerMailFailure extends Error {
 readonly state:'failed'|'uncertain'|'held'
 constructor(state:'failed'|'uncertain'|'held',message:string){super(message);this.state=state}
}
export function rerConfigured(env:Env){return env.H2H_RER_MAIL_VERSION==='1'&&Boolean(env.MAIL_API_KEY&&env.MAIL_RELAY_URL&&env.RER_MAILBOX_ID&&env.RER_MAIL_ADDRESS&&env.RER_MAIL_INGRESS_KEY&&env.RER_MAIL_CONTROL_URL&&env.INBOUND_EMAIL_TOKEN&&env.INTEGRATION_ENCRYPTION_KEY)&&managedMailAddress(env.MAIL_FROM)===managedMailAddress(env.RER_MAIL_ADDRESS)}
const header=(input:EmailInput,name:string)=>Object.entries(input.headers||{}).find(([key])=>key.toLowerCase()===name)?.[1]
function replyAllowed(base:string,reply:string){const [local,domain]=base.split('@'),suffix=reply.slice(local.length);return reply===base||reply.startsWith(local)&&new RegExp('^\\+r\\.[a-f0-9]{32}@'+domain.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').test(suffix)}
function attachments(input:EmailInput){
 let encoded=0
 return input.attachments?.map(file=>{
  encoded+=file.content.length
  const size=file.content.length/4*3-(file.content.endsWith('==')?2:file.content.endsWith('=')?1:0)
  if((!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)||file.content.length%4!==0)||size>8*1024*1024||encoded>20*1024*1024)throw new RerMailFailure('failed','Email attachment exceeds the sending limit')
  return {filename:file.filename,content:file.content,type:file.contentType,disposition:file.contentId?'inline':'attachment',...(file.contentId?{contentId:file.contentId}:{})}
 })
}
/** The native delivery claim is already durable. A request is issued at most once;
 * timeouts and malformed/lost responses remain uncertain. Polling never sends. A
 * `holdable` command refused at authenticate is held for the outbox to resend. */
export async function sendRerMail(env:Env,input:EmailInput,holdable=false){
 const mailbox=await managedMailbox(env,input.projectId)
 if(!mailbox?.mailbox_id||!mailbox.address||mailbox.state!=='active')throw new RerMailFailure('failed','Managed mailbox is not active')
 if(input.replyTo&&(!mailbox.route_active||!replyAllowed(mailbox.address,input.replyTo)))throw new RerMailFailure('failed','Managed reply routing is not active for this address')
 if(/^(?:message:|transcript:)/.test(input.idempotencyKey)&&(!input.replyTo||!mailbox.route_active))throw new RerMailFailure('failed','Customer email requires active reply routing')
 if(input.text.length>1024*1024||(input.html?.length||0)>1024*1024)throw new RerMailFailure('failed','Email content exceeds the managed service limit')
 const payload={mailboxId:mailbox.mailbox_id,messageKey:await hashToken(input.idempotencyKey),to:[input.to],...(input.cc?.length?{cc:input.cc}:{}),...(input.bcc?.length?{bcc:input.bcc}:{}),subject:input.subject.slice(0,200),text:input.text,...(input.html?{html:input.html}:{}),...(input.replyTo?{replyTo:input.replyTo}:{}),...(header(input,'in-reply-to')?{inReplyTo:header(input,'in-reply-to')}:{}),...(header(input,'references')?{references:header(input,'references')}:{}),...(input.attachments?.length?{attachments:attachments(input)}:{}),...(header(input,'auto-submitted')||header(input,'x-auto-response-suppress')?{autoResponseSuppress:true}:{})}
 const body=JSON.stringify(payload)
 if(new TextEncoder().encode(body).length>maxMailBytes)throw new RerMailFailure('failed','Email content exceeds the total size limit')
 const match=/^message:([^:]+):notification(?::|$)/.exec(input.idempotencyKey),replyToken=input.replyTo?.match(/\+r\.([a-f0-9]{32})@/)?.[1]
 const thread=match?await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=? AND project_id=?').bind(match[1],mailbox.project_id).first<{conversation_id:string}>():replyToken?await env.DB.prepare('SELECT conversation_id FROM email_reply_grants WHERE project_id=? AND token_hash=?').bind(mailbox.project_id,await hashToken(replyToken)).first<{conversation_id:string}>():null
 await env.DB.batch([
  auditStatement(env.DB,{projectId:mailbox.project_id,category:'integration',action:'managed_mail.send_started',actor:{type:'system'},source:'system',target:{type:'email_delivery',id:input.idempotencyKey}},Date.now(),{sql:'NOT EXISTS(SELECT 1 FROM rer_mail_commands WHERE command_id=?)',params:[input.idempotencyKey]}),
  env.DB.prepare('INSERT OR IGNORE INTO rer_mail_commands(command_id,project_id,mailbox_id,generation,message_key,conversation_id) VALUES(?,?,?,?,?,?)').bind(input.idempotencyKey,mailbox.project_id,mailbox.mailbox_id,mailbox.generation,payload.messageKey,thread?.conversation_id||null),
 ])
 try{
 const response=await notificationFetch(mailService(env.MAIL_RELAY_URL),{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(20000)})
 if(!response.ok){
  if(holdable&&response.status===401&&rerMailCredentialRefused.includes((await mailJson(response).catch(()=>null))?.code))throw new RerMailFailure('held',rerMailHeld)
  throw new RerMailFailure(response.status>=500||response.status>=300&&response.status<400?'uncertain':'failed',response.status>=500?'The mail service did not return a confirmed acceptance':response.status===401||response.status===403?authorityUnavailable:response.status===409?'This send conflicts with a retained mail command':'The mail service refused this message before acceptance')
 }
 const receipt=await mailJson(response)
 if(response.status!==202||receipt.state!=='accepted'||receipt.accepted!==true||messageIds(receipt.messageId).length!==1||messageIds(receipt.messageId)[0]!==receipt.messageId)throw new RerMailFailure(receipt.state==='failed'?'failed':'uncertain',receipt.state==='failed'?'Managed email was refused before acceptance':'Managed email acceptance is unknown')
 await recordRerAcceptance(env,input,receipt.messageId)
 return receipt.messageId as string
 }catch(error){
  const state=error instanceof RerMailFailure?error.state:'uncertain'
  await auditStatement(env.DB,{projectId:mailbox.project_id,category:'integration',action:state==='failed'?'managed_mail.send_rejected':state==='held'?'managed_mail.send_held':'managed_mail.send_uncertain',outcome:state==='held'?'refused':'failed',actor:{type:'system'},source:'system',target:{type:'email_delivery',id:input.idempotencyKey}}).run()
  throw error
 }
}
export async function recordRerAcceptance(env:Env,input:Pick<EmailInput,'projectId'|'idempotencyKey'>,messageId:string){
 const match=/^message:([^:]+):notification(?::|$)/.exec(input.idempotencyKey)
 const row=await env.DB.prepare('SELECT conversation_id,project_id FROM rer_mail_commands WHERE command_id=?').bind(input.idempotencyKey).first<{conversation_id:string|null;project_id:string}>()
 await env.DB.batch([
  ...(row?[auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'managed_mail.send_accepted',actor:{type:'system'},source:'system',target:{type:'email_delivery',id:input.idempotencyKey}},Date.now(),{sql:'EXISTS(SELECT 1 FROM rer_mail_commands WHERE command_id=? AND accepted_at IS NULL)',params:[input.idempotencyKey]})]:[]),
  env.DB.prepare('UPDATE rer_mailboxes SET last_outbound_at=?,updated_at=? WHERE project_id=?').bind(Date.now(),Date.now(),input.projectId??(await managedMailbox(env))?.project_id??null),
  env.DB.prepare('UPDATE rer_mail_commands SET message_id=?,accepted_at=? WHERE command_id=?').bind(messageId,Date.now(),input.idempotencyKey),
  ...(row?.conversation_id?emailThreadingStatements(env,{projectId:row.project_id,conversationId:row.conversation_id,keys:[{kind:'message_id',value:messageId,source:'native',sourceRef:match?.[1]||input.idempotencyKey}],createdAt:Date.now()}):[]),
 ])
}
