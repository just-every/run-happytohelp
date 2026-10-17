import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {requiredString} from '../../platform/db'
import {recipientAddress} from '../management/conversation-transcript'
import {availableTicketSql} from '../tickets/model'
import {visibleEmailReply} from '../integrations/email-reply'
import {publishConversationAction} from './activity'

export type PartnerReplyInput={projectId:string;conversationId:string;replyToken:string;sender:string;localId:string;content:string;senderFailed?:boolean;attachments?:{filename:string;contentType:string;content:ArrayBuffer}[]}
export async function partnerGrant(env:Env,token:string){return env.DB.prepare('SELECT * FROM partner_forwards WHERE grant_hash=?').bind(await hashToken(token)).first<any>()}
/** Possession and the currently invited address authorize a private reply only.
 * No contact profile, customer participant, public message or outbox is created. */
export async function receivePartnerReply(env:Env,input:PartnerReplyInput){
 const grant=await partnerGrant(env,input.replyToken)
 if(!grant)return null
 if(typeof input.content!=='string'||input.content.length>100000)throw new HTTPException(400,{message:'Invalid partner reply content'})
 const sender=recipientAddress(input.sender),localId=requiredString(input.localId,'messageId',200),content=visibleEmailReply(input.content),files=input.attachments??[]
 if(!content.trim()&&!files.length)throw new HTTPException(400,{message:'A partner reply needs text or an attachment'})
 if(grant.project_id!==input.projectId||grant.conversation_id!==input.conversationId||grant.recipient!==sender||grant.revoked_at||input.senderFailed)throw new HTTPException(403,{message:'This sender does not hold a current partner reply grant'})
 if(files.length>20||files.some(file=>file.content.byteLength>20000000)||files.reduce((n,file)=>n+file.content.byteLength,0)>25000000)throw new HTTPException(413,{message:'Partner attachments exceed the email limit'})
 const hashes=await Promise.all(files.map(async file=>({filename:file.filename,type:file.contentType,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.content))).map(b=>b.toString(16).padStart(2,'0')).join('')})))
 const intent=await hashToken(JSON.stringify({forward:grant.id,sender,content,files:hashes})),receipt=await hashToken(JSON.stringify(['partner',input.projectId,localId]))
 const old=await env.DB.prepare('SELECT * FROM partner_replies WHERE receipt_id=?').bind(receipt).first<any>()
 if(old){if(old.intent_hash!==intent)throw new HTTPException(409,{message:'Partner reply identity conflict'});return {id:old.id,state:'delivered' as const,conversationId:old.conversation_id,private:true as const,duplicate:true}}
 const id=crypto.randomUUID(),now=Date.now(),stored=[] as {id:string;key:string;file:typeof files[number]}[]
 try{
  for(const file of files){const fileId=crypto.randomUUID(),key=`partner-replies/${input.projectId}/${id}/${fileId}`;stored.push({id:fileId,key,file});await env.FILES.put(key,file.content)}
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT OR IGNORE INTO partner_replies(id,project_id,conversation_id,forward_id,receipt_id,local_id,intent_hash,content,created_at)
    SELECT ?,c.project_id,c.id,f.id,?,?,?,?,? FROM partner_forwards f JOIN conversations c ON c.id=f.conversation_id AND c.project_id=f.project_id
    WHERE f.id=? AND f.project_id=? AND f.conversation_id=? AND f.grant_hash=? AND f.recipient=? AND f.revoked_at IS NULL AND ${availableTicketSql()} AND EXISTS(SELECT 1 FROM email_settings e WHERE e.project_id=c.project_id AND e.is_enabled=1) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
    .bind(id,receipt,localId,intent,content,now,grant.id,input.projectId,input.conversationId,await hashToken(input.replyToken),sender),
   ...stored.map(({id:fileId,key,file})=>env.DB.prepare('INSERT INTO partner_reply_files SELECT ?,?,?,id,?,?,?,?,? FROM partner_replies WHERE id=?').bind(fileId,input.projectId,input.conversationId,key,file.filename.slice(0,200),file.contentType.slice(0,200),file.content.byteLength,now,id)),
  ])
  if(!results[0].meta.changes){
   const concurrent=await env.DB.prepare('SELECT id,intent_hash,conversation_id FROM partner_replies WHERE receipt_id=?').bind(receipt).first<any>()
   if(concurrent?.intent_hash===intent){await Promise.all(stored.map(file=>env.FILES.delete(file.key)));return {id:concurrent.id,state:'delivered' as const,conversationId:concurrent.conversation_id,private:true as const,duplicate:true}}
   throw new HTTPException(409,{message:'Partner reply grant, ticket or message identity changed'})
  }
  await publishConversationAction(env,input.projectId,[input.conversationId],'partner_reply')
  return {id,state:'delivered' as const,conversationId:input.conversationId,private:true as const,duplicate:false}
 }catch(error){
  // A lost D1 response may follow a committed reply+file transaction. Never
  // delete its bytes. If D1 is unavailable the outcome remains unknown and the
  // private object keys are retained for reconciliation, never replayed.
  let committed:any
  try{committed=await env.DB.prepare('SELECT id,intent_hash,conversation_id FROM partner_replies WHERE id=?').bind(id).first<any>()}catch{throw error}
  if(committed?.intent_hash===intent)return {id:committed.id,state:'delivered' as const,conversationId:committed.conversation_id,private:true as const,duplicate:false}
  await Promise.all(stored.map(file=>env.FILES.delete(file.key)));throw error
 }
}
