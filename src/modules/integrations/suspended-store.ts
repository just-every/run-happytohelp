import {cronRoom} from '../../platform/cron-budget'
import type {Env} from '../../platform/env'
import {auditStatement} from '../audit/record'
import type {IncomingEmail} from './inbound-service'
import {hashToken} from '../../platform/auth'
import {classifyInboundEmail} from './email-classification'

export const SUSPENDED_RETENTION_MS=14*24*60*60*1000
export async function senderRule(env:Env,projectId:string,address:string){
 return env.DB.prepare("SELECT action FROM email_sender_rules WHERE project_id=? AND address IN (?,?) ORDER BY CASE WHEN action='block' THEN 0 ELSE 1 END,CASE WHEN address=? THEN 0 ELSE 1 END LIMIT 1").bind(projectId,address,'@'+address.split('@')[1],address).first<{action:'allow'|'block'}>()
}
/** No contact, conversation, outbox or provider work exists for held mail. MIME
 * HTML is never stored as executable markup. Attachments remain encoded data. */
export async function suspendEmail(env:Env,input:IncomingEmail,context:{projectId:string;receiptId:string;claimToken:string;reason:string;candidateId?:string|null}){
 const {attachments,...safe}=input,now=Date.now(),key=crypto.randomUUID()
 const files=[]
 for(const [index,file] of (attachments||[]).entries()){
  const objectKey=`suspended-email/${context.projectId}/${await hashToken(context.receiptId)}/${index}`
  await env.FILES.put(objectKey,file.content,{httpMetadata:{contentType:'application/octet-stream'}})
  files.push({filename:file.filename,contentType:file.contentType,objectKey,size:file.content.byteLength})
 }
 const auth={verified:input.senderAuthenticated===true&&input.senderFailed!==true&&input.fromUnusable!==true,failed:input.senderFailed===true,from_unusable:input.fromUnusable===true}
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO suspended_emails(id,project_id,receipt_id,from_address,to_json,subject,text,reason,auth_json,headers_json,candidate_conversation_id,input_json,created_at,expires_at)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inbound_emails WHERE id=? AND claim_token=? AND state='processing') ON CONFLICT(project_id,receipt_id) DO NOTHING`).bind(key,context.projectId,context.receiptId,input.from,JSON.stringify(input.to),input.evidence?.subject||'',input.text.slice(0,100000),context.reason,JSON.stringify(auth),JSON.stringify(input.evidence?.headers||{}),context.candidateId??null,JSON.stringify({...safe,attachments:files}),now,now+SUSPENDED_RETENTION_MS,context.receiptId,context.claimToken),
  env.DB.prepare("UPDATE inbound_emails SET state='suspended',error=?,conversation_id=NULL WHERE id=? AND claim_token=? AND state='processing'").bind(context.reason,context.receiptId,context.claimToken),
  auditStatement(env.DB,{projectId:context.projectId,category:'integration',action:'email.suspended',actor:{type:'system'},source:'email',target:{type:'suspended_email',id:key},detail:{reason:context.reason,candidateId:context.candidateId??null}}),
 ])
 return {id:input.messageId,state:'suspended',conversationId:null,duplicate:false,automatic:input.evidence?classifyInboundEmail(input.evidence).automatic:false,suspendedId:key}
}
/** Called by the email scheduled integration and before reads. Deletion and its
 * count-only audit row commit together; no customer text enters the audit. */
export async function expireSuspendedEmails(env:Env,now=Date.now()){
 const projects=(await env.DB.prepare('SELECT project_id,COUNT(*) count FROM suspended_emails WHERE expires_at<=? GROUP BY project_id').bind(now).all<{project_id:string;count:number}>()).results
 for(const project of projects){
  if(!cronRoom(env,4))break
  const rows=(await env.DB.prepare('SELECT input_json FROM suspended_emails WHERE project_id=? AND expires_at<=?').bind(project.project_id,now).all<{input_json:string}>()).results
  for(const row of rows)await deleteSuspendedObjects(env,row)
  await env.DB.batch([
  env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source,target_type,detail_json)
   SELECT ?,?,?, 'integration','email.suspended_expired','succeeded','system','system','suspended_email',json_object('count',COUNT(*)) FROM suspended_emails WHERE project_id=? AND expires_at<=? HAVING COUNT(*)>0`).bind(crypto.randomUUID(),project.project_id,now,project.project_id,now),
  env.DB.prepare("UPDATE inbound_emails SET evidence_json=json_object('reasons',json(coalesce(json_extract(evidence_json,'$.reasons'),'[]'))),state='expired' WHERE project_id=? AND id IN (SELECT receipt_id FROM suspended_emails WHERE project_id=? AND expires_at<=?)").bind(project.project_id,project.project_id,now),
  env.DB.prepare('DELETE FROM suspended_emails WHERE project_id=? AND expires_at<=?').bind(project.project_id,now),
 ])}
}
export async function deleteSuspendedObjects(env:Env,row:{input_json:string}){
 const files=JSON.parse(row.input_json).attachments||[]
 for(const file of files)if(typeof file.objectKey==='string')await env.FILES.delete(file.objectKey)
}
