import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {address,mailboxForDelivery,readCredential} from './store'
import {accessToken} from './oauth-provider'
import {base64,base64url,bearer,providerJson,providerBytes,MailboxProviderError} from './http'
import {buildMime,recipients} from './mime'
import {smtpSend} from './socket'
import type {ImapCredential,MailboxSendInput} from './types'
import {auditStatement} from '../../audit/record'

/** Shared sender identity/signatures for forwarding mail sent by the installation
 * adapter. The caller must still validate its verified sender-domain policy. */
export async function mailboxSender(env:Env,input:MailboxSendInput){
 const row=await mailboxForDelivery(env,input.projectId,input.mailboxId)
 if(!row)throw new HTTPException(409,{message:'Selected mailbox is unavailable'})
 const from=address(input.fromAddress||row.sender_address||row.address)
 const alias=await env.DB.prepare('SELECT can_send FROM mailbox_addresses WHERE mailbox_id=? AND project_id=? AND address=?').bind(row.id,row.project_id,from).first<{can_send:number}>()
 if(!alias||(row.provider!=='forwarding'&&!alias.can_send))throw new HTTPException(403,{message:'Mailbox is not authorized to send from this address'})
 if(input.agentId){
  const member=await env.DB.prepare('SELECT 1 FROM memberships WHERE user_id=? AND project_id=?').bind(input.agentId,input.projectId).first()
  if(!member)throw new HTTPException(403,{message:'Signature agent is not a workspace member'})
 }
 const signature=await env.DB.prepare(`SELECT text,html FROM mailbox_signatures WHERE mailbox_id=? AND agent_id IN (?,'default') ORDER BY CASE WHEN agent_id=? THEN 0 ELSE 1 END LIMIT 1`)
 .bind(row.id,input.agentId||'default',input.agentId||'default').first<{text:string;html:string|null}>()
 const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
 return {row,fromAddress:from,displayName:row.display_name,text:input.text+(signature?.text?'\n\n'+signature.text:''),
  html:input.html?input.html+(signature?.html?'<br><br>'+signature.html:signature?.text?'<br><br>'+escape(signature.text):''):undefined}
}
export async function sendViaMailbox(env:Env,input:MailboxSendInput):Promise<{id:string|null;state:'sent'}>{
 if(!input.idempotencyKey||input.idempotencyKey.length>200||!input.text||typeof input.subject!=='string')throw new HTTPException(400,{message:'Invalid mailbox message'})
 const sender=await mailboxSender(env,input),row=sender.row
 if(row.provider==='forwarding')throw new HTTPException(409,{message:'Forwarding mailbox uses the installation email sender'})
 const expanded={...input,text:sender.text,html:sender.html},intent=await hashToken(JSON.stringify({...expanded,fromAddress:sender.fromAddress,displayName:sender.displayName}))
 const prior=await env.DB.prepare('SELECT state,provider_id,intent_hash,mailbox_id,project_id FROM mailbox_sends WHERE id=?').bind(input.idempotencyKey).first<any>()
 if(prior){
  if(prior.intent_hash!==intent||prior.mailbox_id!==row.id||prior.project_id!==row.project_id)throw new HTTPException(409,{message:'Mailbox send identity conflict'})
  if(prior.state==='sent')return {id:prior.provider_id,state:'sent'}
  throw new HTTPException(409,{message:`Mailbox delivery ${prior.state}; reconcile before retrying`})
 }
 const raw=buildMime(expanded,sender.fromAddress,sender.displayName,row.provider!=='imap'),r=recipients(input),now=Date.now()
 const claimed=await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO mailbox_sends(id,project_id,mailbox_id,intent_hash,state,created_at,updated_at)
 SELECT ?,?,?,?,'sending',?,? WHERE EXISTS(SELECT 1 FROM mailbox_connections WHERE id=? AND project_id=? AND status='connected' AND credential_version=?)`)
 .bind(input.idempotencyKey,input.projectId,row.id,intent,now,now,row.id,input.projectId,row.credential_version),auditStatement(env.DB,{projectId:input.projectId,category:'integration',action:'mailbox.send_started',actor:input.agentId?{type:'user',id:input.agentId}:{type:'system'},source:input.agentId?'dashboard':'system',target:{type:'mailbox_delivery',id:input.idempotencyKey}})])
 const claim=claimed[0]
 if(!claim.meta.changes)throw new HTTPException(409,{message:'Mailbox send already claimed or connection changed'})
 try{
  let providerId:string|null=null
  if(row.provider==='imap')providerId=await smtpSend(env,await readCredential<ImapCredential>(env,row),sender.fromAddress,r.all,raw)
  else{
   const token=await accessToken(env,row)
   const live=await mailboxForDelivery(env,row.project_id,row.id)
   if(!live||live.credential_version!==row.credential_version)throw new HTTPException(409,{message:'Mailbox connection changed'})
   if(row.provider==='gmail'){
    const receipt=await providerJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify({raw:base64url(raw)})})
    if(typeof receipt.id!=='string')throw new Error('Mailbox provider omitted delivery identity')
    providerId=receipt.id
   }else {const receipt=await providerBytes('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{...bearer(token),'Content-Type':'text/plain'},body:base64(raw)},65536);if(receipt.status!==202)throw new Error('Microsoft did not confirm acceptance')}
  }
  await env.DB.batch([env.DB.prepare("UPDATE mailbox_sends SET state='sent',provider_id=?,updated_at=? WHERE id=? AND state='sending'").bind(providerId,Date.now(),input.idempotencyKey),auditStatement(env.DB,{projectId:input.projectId,category:'integration',action:'mailbox.send_accepted',actor:{type:'system'},source:'system',target:{type:'mailbox_delivery',id:input.idempotencyKey}})])
  return {id:providerId,state:'sent'}
 }catch(error){
  const definitive=error instanceof MailboxProviderError&&error.status>=400&&error.status<500&&error.status!==408
  await env.DB.batch([env.DB.prepare('UPDATE mailbox_sends SET state=?,error_code=?,updated_at=? WHERE id=? AND state=\'sending\'').bind(definitive?'failed':'uncertain',definitive?`provider_${error.status}`:'outcome_unknown',Date.now(),input.idempotencyKey),auditStatement(env.DB,{projectId:input.projectId,category:'integration',action:definitive?'mailbox.send_rejected':'mailbox.send_uncertain',outcome:'failed',actor:{type:'system'},source:'system',target:{type:'mailbox_delivery',id:input.idempotencyKey}})])
  throw new HTTPException(502,{message:definitive?'Mailbox provider rejected delivery':'Mailbox delivery outcome unknown; reconcile before retrying'})
 }
}
