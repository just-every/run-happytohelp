import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {requiredString} from '../../platform/db'
import {attachInboundOrigins} from '../integrations/inbound-origin'
import {recipientReplyAddress} from '../integrations/email-reply-address'
import {renderConversationEmail} from '../integrations/email-content'
import {withChatReplyNotice} from '../integrations/reply-notice'
import {sendEmail} from '../integrations/email'

export function recipientAddress(value:unknown){
 const address=requiredString(value,'email',320).trim().toLowerCase()
 if(/[\x00-\x1f\x7f]/.test(address)||!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(address))throw new HTTPException(400,{message:'Enter one valid email address'})
 return address
}

/** A transcript is the latest customer-bearing segment, never the whole archive. */
export async function transcriptMessages(env:Env,conversation:any,revision:number){
 const rows=await attachInboundOrigins(env,conversation.project_id,(await env.DB.prepare('SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND revision<=? ORDER BY revision').bind(conversation.project_id,conversation.id,revision).all<any>()).results)
 const visible=rows.filter((row:any)=>['contact','operator','owner','admin','ai'].includes(row.actor_role)&&row.actor_id!=='legacy-system'&&!row.origin?.automatic)
 const buckets=(await env.DB.prepare('SELECT id,created_at FROM conversation_buckets WHERE conversation_id=?').bind(conversation.id).all()).results
 const starts=new Map(buckets.map(row=>[row.id,Number(row.created_at)]))
 // Native messages without a bucket belong to the conversation's root segment.
 for(const row of rows){const bucket=row.bucket_id||conversation.id;if(!starts.has(bucket))starts.set(bucket,Number(row.created_at))}
 const latest=visible.filter(row=>row.actor_role==='contact').sort((a,b)=>Number(starts.get(b.bucket_id||conversation.id))-Number(starts.get(a.bucket_id||conversation.id))||Number(b.revision)-Number(a.revision))[0]
 if(!latest)throw new HTTPException(400,{message:'There is no customer conversation to email'})
 return visible.filter(row=>(row.bucket_id||conversation.id)===(latest.bucket_id||conversation.id))
}

export async function emailConversationTranscript(env:Env,conversation:any,actorId:string,body:any,recheckAuthority:()=>Promise<unknown>){
 const to=recipientAddress(body.send_transcript_to),key=requiredString(body.idempotencyKey,'idempotencyKey',200)
 const revision=body.transcript_revision??Number(conversation.revision)
 if(!Number.isSafeInteger(revision)||revision<0||revision>Number(conversation.revision))throw new HTTPException(400,{message:'Invalid transcript revision'})
 const messages=await transcriptMessages(env,conversation,revision)
 // Rendering carries source identity into the common final mail admission.
 const {omitted,...content}=await renderConversationEmail(env,{projectId:conversation.project_id,conversationId:conversation.id,messages})
 const settings=await env.DB.prepare('SELECT inbound_address FROM email_settings WHERE project_id=? AND is_enabled=1').bind(conversation.project_id).first<{inbound_address:string|null}>()
 const replyTo=await recipientReplyAddress(env,settings?.inbound_address,conversation.project_id,conversation.id,to,true)
 const idempotencyKey=`transcript:${await hashToken(JSON.stringify([conversation.project_id,conversation.id,actorId,key]))}`
 // Rendering may read media; recheck the live session and membership before sending.
 await recheckAuthority()
 try{return await sendEmail(env,{...(replyTo?content:await withChatReplyNotice(env,conversation.project_id,content)),to,subject:'Conversation transcript',projectId:conversation.project_id,replyTo,idempotencyKey})}
 catch(error){
  const delivery=await env.DB.prepare('SELECT state,recipient FROM email_deliveries WHERE id=? AND project_id=?').bind(idempotencyKey,conversation.project_id).first<{state:string;recipient:string}>()
  // Identity conflicts are refusals, not a status for a different intent.
  if(error instanceof HTTPException&&error.status===409&&error.message==='Email command identity conflict')throw error
  if(delivery&&delivery.recipient===to)return {state:delivery.state}
  throw error
 }
}
