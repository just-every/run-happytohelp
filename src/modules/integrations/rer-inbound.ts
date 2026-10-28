import {privateRerMime,redactedMime,mimeHeaderFrom} from './rer-mail-raw'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {boundedMailBody,canonical} from './rer-mail-contract'
import {authenticateRerInbound} from './rer-inbound-signature'
import {parseInboundMime,holdRawEmail} from './unreadable-email'
import {headerFromAddress} from './inbound-sender'
import {emailAddress} from './inbound-routing'
import {plainEmail} from './email-reply'
import {emailEvidence} from './email-classification'
import {receiveEmail} from './inbound-service'
import {scheduleInboundEffects} from './inbound-effects'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'
const addresses=(list:any[]|undefined):string[]=>(list||[]).flatMap(value=>value.group?addresses(value.group):value.address?[value.address]:[])
type Receipt={body_sha256:string;metadata_json:string;sender_address:string|null;state:string;result_json:string|null;updated_at:number}
export const rerInbound=new Hono<AppEnv>()
rerInbound.post('/email/rer/v1/inbound',async c=>{
 c.header('Cache-Control','no-store')
 const raw=await boundedMailBody(c.req.raw.body),m=await authenticateRerInbound(c.env,c.req.raw,raw),now=Date.now()
 // An identity's immutable content is persisted before any admission or response.
 // Different bytes have a different object key, so they cannot replace its source.
 const known=await c.env.DB.prepare('SELECT project_id,mailbox_id,state,result_json FROM rer_mail_ingress WHERE delivery_id=?').bind(m.deliveryId).first<{project_id:string;mailbox_id:string;state:string;result_json:string|null}>()
 if(known&&(known.project_id!==m.workspaceId||known.mailbox_id!==m.mailboxId))throw new HTTPException(409,{message:'Inbound delivery identity belongs to another mailbox'})
 if(known?.state==='erased')return c.json({state:'erased',duplicate:true},200)
 const custody={deliveryId:m.deliveryId,headerFrom:mimeHeaderFrom(raw),envelopeFrom:emailAddress(m.envelopeFrom)}
 const objectKey=`rer-mail/${m.workspaceId}/${await hashToken(m.deliveryId)}/${m.bodySha256}.eml`
 await c.env.FILES.put(objectKey,await privateRerMime(c.env,raw,m),{httpMetadata:{contentType:'application/octet-stream'}})
 await c.env.DB.batch([c.env.DB.prepare(`INSERT OR IGNORE INTO rer_mail_ingress(delivery_id,project_id,mailbox_id,generation,body_sha256,raw_key,metadata_json,sender_address,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(m.deliveryId,m.workspaceId,m.mailboxId,m.generation,m.bodySha256,objectKey,canonical(m),custody.headerFrom||custody.envelopeFrom,now,now),c.env.DB.prepare('INSERT OR IGNORE INTO rer_mail_raw_objects VALUES(?,?,?,?)').bind(m.deliveryId,m.bodySha256,m.workspaceId,objectKey)])
 const prior=await c.env.DB.prepare('SELECT * FROM rer_mail_ingress WHERE delivery_id=? AND project_id=? AND mailbox_id=?').bind(m.deliveryId,m.workspaceId,m.mailboxId).first<Receipt>()
 if(!prior)throw new HTTPException(409,{message:'Inbound delivery identity belongs to another mailbox'})
 // A retry may refresh its timestamp, but never its authenticated sender/verdict,
 // workspace, generation or envelope, even when its MIME is unchanged.
 const identity=(metadata:any)=>canonical({...metadata,timestamp:0})
 const original=JSON.parse(prior.metadata_json)
 if(prior.body_sha256!==m.bodySha256||identity(original)!==identity(m)){
  // Custody follows the immutable receipt, even if this copy changes its sender.
  // This is an erasure link only: conflicting bytes still have no admission authority.
  await holdRawEmail(c.env,redactedMime(raw),{description:'This review copy has private reply recipients redacted. The exact original MIME is retained in encrypted storage.',projectId:m.workspaceId,recipients:[m.envelopeTo],identity:await hashToken(m.deliveryId+':'+m.bodySha256+':'+canonical(m)),reason:'message_identity_conflict',custody,senderAddress:prior.sender_address||emailAddress(original.envelopeFrom)||undefined,candidateId:prior.result_json?JSON.parse(prior.result_json).conversationId:null})
  await c.env.DB.prepare("UPDATE rer_mail_ingress SET error='Changed content held for review' WHERE delivery_id=?").bind(m.deliveryId).run()
  return c.json({state:'held',reason:'delivery_identity_conflict'},200)
 }
 if(prior.result_json)return c.json({...JSON.parse(prior.result_json),duplicate:true},200)
 const claim=await c.env.DB.prepare("UPDATE rer_mail_ingress SET state='processing',updated_at=? WHERE delivery_id=? AND (state IN ('stored','failed') OR state='processing' AND updated_at<?)").bind(now,m.deliveryId,now-120000).run()
 if(!claim.meta.changes)throw new HTTPException(503,{message:'Inbound mail is processing; retry later'})
 try{
  const parsed=await parseInboundMime(c.env,raw,{reviewRaw:redactedMime(raw),description:'This review copy has private reply recipients redacted. The exact original MIME is retained in encrypted storage.',projectId:m.workspaceId,recipients:[m.envelopeTo],identity:m.deliveryId,custody,senderAddress:custody.headerFrom||custody.envelopeFrom||undefined})
  let result:any={state:'held',reason:'message_unreadable'}
  if(parsed){
   const fromHeader=headerFromAddress(parsed.headers),from=fromHeader||emailAddress(m.envelopeFrom)
   const text=plainEmail(parsed.text||'',parsed.html||'').trim()||(parsed.attachments.length?'':String(parsed.subject||'').trim())
   if(!from||!text&&!parsed.attachments.length){
    await holdRawEmail(c.env,redactedMime(raw),{description:'This review copy has private reply recipients redacted. The exact original MIME is retained in encrypted storage.',projectId:m.workspaceId,recipients:[m.envelopeTo],identity:m.deliveryId,custody,senderAddress:custody.headerFrom||custody.envelopeFrom||undefined})
   }else{
    await c.env.DB.prepare('UPDATE rer_mail_ingress SET sender_address=? WHERE delivery_id=?').bind(from,m.deliveryId).run()
    const rawId=parsed.messageId||m.bodySha256,messageId=rawId.length>200?await hashToken(rawId):rawId
    result=await receiveEmail(c.env,{messageId,to:[m.envelopeTo],from,text,cc:addresses(parsed.cc),replyTo:addresses(parsed.replyTo)[0],senderAuthenticated:m.verdict==='verified',senderFailed:m.verdict==='failed',fromUnusable:!fromHeader,evidence:emailEvidence({envelopeFrom:m.envelopeFrom,headerFrom:parsed.from?.address,subject:parsed.subject,headers:parsed.headers}),attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))}).catch(async error=>{
     if(error instanceof ClosedTicketRefusal){await noticeMember(c.env,error);return {state:'refused',reason:'closed_ticket'}}
     if(error instanceof HTTPException&&error.status===409)return {state:'held',reason:'message_identity_conflict'}
     throw error
    })
   }
  }
  const receipt={state:result.state,conversationId:result.conversationId||null,duplicate:Boolean(result.duplicate)}
  await c.env.DB.batch([
   c.env.DB.prepare("UPDATE rer_mail_ingress SET state='complete',result_json=?,error=NULL,updated_at=? WHERE delivery_id=?").bind(JSON.stringify(receipt),Date.now(),m.deliveryId),
   c.env.DB.prepare('UPDATE rer_mailboxes SET last_inbound_at=?,updated_at=? WHERE project_id=? AND mailbox_id=? AND generation=?').bind(now,Date.now(),m.workspaceId,m.mailboxId,m.generation),
  ])
  scheduleInboundEffects(c.env,c.executionCtx,result)
  return c.json(receipt,200)
 }catch(error){
  await c.env.DB.prepare("UPDATE rer_mail_ingress SET state='failed',error='Inbound processing interrupted; awaiting retry',updated_at=? WHERE delivery_id=?").bind(Date.now(),m.deliveryId).run()
  throw error
 }
})
