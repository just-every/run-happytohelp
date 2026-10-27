import {trackingStatement} from '../outcomes/state'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {id,requiredString} from '../../platform/db'
import {hashToken} from '../../platform/auth'
import {admitMessage} from '../conversations/admission'
import {emailAddress,inboundTarget} from './inbound-routing'
import {receivingMailbox} from './inbound-receiving'
import {routingAddresses} from './inbound-sender'
import {inboundLocalId,legacyInboundLocalId,scopedInboundId} from './inbound-identity'
import {visibleEmailReply} from './email-reply'
import {replyGrant} from './email-reply-address'
import {inboundAuthority,emailContact,emailActor,preferredAddressActor,openEmailConversation,ccContacts} from './inbound-authority'
import {mailboxAddress} from '../../platform/mailbox'
import {classifyInboundEmail,evidenceJson,type EmailEvidence} from './email-classification'
import {CLOSED_TICKET_FINAL,ClosedTicketRefusal,isMemberAddress} from './closed-ticket-mail'
import {suspendEmail,senderRule} from './suspended-store'
import {resolveEmailThreadCandidates,emailThreadingStatements} from './email-threading'
import {inboundIntent,sameInboundIntent,legacyInboundIntentMatches} from './inbound-intent'
import {markPreMigrationReply} from './email-migration-reply'
import {suspendRefusedEmail} from './refused-email'
/** `to` lists the recipient addresses in routing order (envelope, forwarding headers,
 * To); the first configured mailbox selects the project. `from` is the header From and
 * `senderAuthenticated` whether the ingress verified it; `senderFailed` that the
 * provider reported an explicit DKIM, SPF or DMARC fail (or an ambiguous verdict).
 * `fromUnusable`: the header From named no usable address, so `from` is only the
 * envelope sender, which nobody authenticated as an author.
 * `replyTo` is a reply target only. `evidence` is what the ingress retained for automatic-mail classification. It
 * is not part of the delivery identity, so a redelivery keeps its first classification. */
export interface IncomingEmail {messageId:string;to:string|readonly string[];from:string;text:string;conversationId?:string;cc?:string[];replyTo?:string;senderAuthenticated?:boolean;senderFailed?:boolean;fromUnusable?:boolean;evidence?:EmailEvidence;attachments?:{filename:string;contentType:string;content:ArrayBuffer}[]}
// A receipt still `processing` this long after it was written belongs to an attempt
// that ended without admitting (a crashed or killed Worker). The retry reclaims it;
// the claim token fences admission, so even a live slow attempt cannot admit twice.
const STALE_CLAIM_MS=2*60*1000
const alreadyProcessing=()=>new HTTPException(503,{message:'Inbound email is already processing; retry later'})
export async function receiveEmail(env:Env,input:IncomingEmail,recovery?:{recoveryId:string;actorId:string}){
 // Routing candidates are deduplicated and bounded; only a message with no valid
 // recipient at all is refused.
 const to=routingAddresses(Array.isArray(input.to)?input.to:[input.to])
 const messageId=requiredString(input.messageId,'messageId',200),from=emailAddress(requiredString(input.from,'from',320)),raw=typeof input.text==='string'?input.text.slice(0,100000):undefined;if(raw===undefined)throw new HTTPException(400,{message:'Invalid text'})
 if(!from||!to.length)throw new HTTPException(400,{message:'Inbound email address is invalid'})
 if(!Array.isArray(input.cc||[]))throw new HTTPException(400,{message:'Invalid CC recipients'})
 // Malformed or excess CC entries are skipped, never a reason to refuse the message.
 let content=visibleEmailReply(raw);const cc=[...new Set((input.cc||[]).map(value=>emailAddress(value)).filter((value):value is string=>Boolean(value)))].sort().slice(0,20)
 const received=await receivingMailbox(env,[...to,...cc]);if(!received)throw new HTTPException(404,{message:'Inbound mailbox is not configured'})
 const {project,target}=received,unusable=input.fromUnusable===true,authenticated=!unusable&&input.senderFailed!==true&&input.senderAuthenticated!==false
 if(input.conversationId&&target.conversationId&&input.conversationId!==target.conversationId)throw new HTTPException(400,{message:'Conflicting conversation address'})
 const grant=target.replyToken?await replyGrant(env,project.project_id,target.replyToken):null
 if(input.conversationId&&grant&&input.conversationId!==grant.conversation_id)throw new HTTPException(400,{message:'Conflicting conversation address'})
 const thread=await resolveEmailThreadCandidates(env,{projectId:project.project_id,messageId,inReplyTo:input.evidence?.headers['in-reply-to'],references:input.evidence?.headers.references,subject:input.evidence?.subject||undefined,to,headers:input.evidence?.headers})
 // An imported vendor reply address can use the same +suffix syntax as our old
 // conversation addresses. Its explicit imported mapping is the candidate; the
 // vendor suffix is not a native conversation id. Sender authority is still
 // established below, exactly as for every header-based proposal.
 const mappedVendorAddress=thread.candidates.some(candidate=>candidate.kind==='reply_address'&&candidate.source!=='native'&&to.some(address=>address===candidate.value&&inboundTarget(address)?.mailbox===target.mailbox))
 const direct=grant?.conversation_id||input.conversationId||(!mappedVendorAddress&&target.conversationId)||undefined
 const addressed=direct||thread.conversationIds[0]
 const threadConflict=thread.conflict||Boolean(direct&&thread.conversationIds.some(value=>value!==direct))
 const recovering=recovery?await env.DB.prepare("SELECT 1 FROM suspended_emails s JOIN memberships m ON m.project_id=s.project_id WHERE s.id=? AND json_extract(s.input_json,'$.messageId')=? AND s.project_id=? AND m.user_id=? AND m.role IN ('owner','admin','operator') AND s.expires_at>?").bind(recovery.recoveryId,messageId,project.project_id,recovery.actorId,Date.now()).first():null
 // Files past the per-message limits are named in the message instead of refusing it.
 const offered=input.attachments||[],attachments=offered.filter(f=>f.content.byteLength<=20000000).slice(0,20),omitted=offered.filter(f=>!attachments.includes(f)).map(f=>f.filename)
 if(omitted.length)content=[content,`(Not kept, over the 20 MB or 20-file email limit: ${omitted.join(', ')})`].filter(Boolean).join('\n\n')
 if(!content.trim()&&!attachments.length)throw new HTTPException(400,{message:'Invalid message content'})
 const hashes=await Promise.all(attachments.map(async f=>({filename:f.filename,type:f.contentType,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',f.content))).map(x=>x.toString(16).padStart(2,'0')).join('')})))
 const intent={from,content:raw,conversationId:direct||null,attachments:hashes,...(cc.length?{cc}:{})}
 const intentHash=await inboundIntent(project.project_id,intent,target.mailbox),localId=await inboundLocalId(project.project_id,messageId),legacyLocalId=await legacyInboundLocalId(messageId),scopedId=await scopedInboundId(project.project_id,messageId)
 const rawPrior=await env.DB.prepare('SELECT id,project_id FROM inbound_emails WHERE id=?').bind(messageId).first<{id:string;project_id:string}>()
 const prior=rawPrior?.project_id===project.project_id
  ?await env.DB.prepare('SELECT * FROM inbound_emails WHERE id=? AND project_id=?').bind(messageId,project.project_id).first<any>()
  :await env.DB.prepare('SELECT * FROM inbound_emails WHERE id=? AND project_id=?').bind(scopedId,project.project_id).first<any>()
 const recordId=prior?.id||(rawPrior&&rawPrior.project_id!==project.project_id?scopedId:messageId)
 const possessed=Boolean(grant&&grant.recipient===from),trusted=possessed||authenticated
 const consumedGrant=possessed?{recipient:from,token_hash:await hashToken(target.replyToken!)}:undefined
 const refusal=(closed:{id:string;subject:string|null}|null)=>new ClosedTicketRefusal(trusted&&closed?{projectId:project.project_id,conversationId:closed.id,member:from,subject:closed.subject||'',receiptId:recordId}:null)
 if(prior){
  if(prior.project_id!==project.project_id||!sameInboundIntent(prior.intent_hash,intentHash)&&!recovering&&!await legacyInboundIntentMatches(env,project.project_id,prior.intent_hash,intent,target.mailbox,addressed)){
   await suspendRefusedEmail(env,input,{projectId:project.project_id,identity:intentHash,reason:'message_identity_conflict'})
   throw new HTTPException(409,{message:'Inbound email identity conflict'})
  }
  // Admission and its outbox are atomic. Reconcile a lost completion write without
  // re-entering customer-message automation or replaying uncertain provider work.
  const admitted=await env.DB.prepare('SELECT id,conversation_id FROM messages WHERE project_id=? AND local_id IN (?,?) AND (? IS NULL OR conversation_id=?)').bind(project.project_id,localId,legacyLocalId,prior.conversation_id,prior.conversation_id).first<{id:string;conversation_id:string}>()
  if(admitted){
   await env.DB.prepare("UPDATE inbound_emails SET state='delivered',conversation_id=?,message_id=?,error=NULL WHERE id=?").bind(admitted.conversation_id,admitted.id,recordId).run()
   return {id:messageId,state:'delivered',conversationId:admitted.conversation_id,duplicate:true,automatic:Boolean(prior.automatic)}
  }
  // A retry of mail whose earlier attempt never admitted it is never accepted
  // silently: a stale claim is reclaimed and processed here; a fresh one may still
  // be live, so the sender is told to retry (a temporary failure, never a bounce).
  if(prior.state==='processing'){if(Date.now()-Number(prior.created_at)<STALE_CLAIM_MS)throw alreadyProcessing()}
  // A refused member reply stays refused, so a door that retries tells the member again (idempotently).
  else if(prior.state==='ignored'&&prior.error===CLOSED_TICKET_FINAL)throw refusal(await env.DB.prepare('SELECT id,subject FROM conversations WHERE id=? AND project_id=?').bind(prior.conversation_id,project.project_id).first<any>())
  else if(prior.state!=='failed')return {id:messageId,state:prior.state,conversationId:prior.conversation_id,duplicate:true,automatic:Boolean(prior.automatic)}
 }
 // Classified once, before admission, so the committed message and its outbox can
 // never exist without the classification that suppresses its effects. A receipt
 // written before classification existed (no local_id) is classified on this claim.
 const classified=prior?.local_id!=null?null:input.evidence?classifyInboundEmail(input.evidence):{automatic:false,reasons:[]}
 const automatic=classified?classified.automatic:Boolean(prior.automatic),evidence=classified&&input.evidence?evidenceJson({...input.evidence,sender_verified:authenticated,...(consumedGrant?{grant:consumedGrant}:{})},classified):null
 const claimToken=id(),claimed=prior
  ?await env.DB.prepare("UPDATE inbound_emails SET state='processing',error=NULL,claim_token=?,automatic=CASE WHEN local_id IS NULL THEN ? ELSE automatic END,evidence_json=CASE WHEN local_id IS NULL THEN ? ELSE evidence_json END,local_id=coalesce(local_id,?) WHERE id=? AND (state='failed' OR state='processing' AND claim_token IS ? AND NOT EXISTS(SELECT 1 FROM messages WHERE project_id=? AND local_id IN (?,?)))").bind(claimToken,automatic?1:0,evidence,localId,recordId,prior.claim_token,project.project_id,localId,legacyLocalId).run()
  :await env.DB.prepare("INSERT OR IGNORE INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,error,created_at,claim_token,automatic,evidence_json,local_id) VALUES(?,?,NULL,?,'processing',NULL,?,?,?,?,?)").bind(recordId,project.project_id,intentHash,Date.now(),claimToken,automatic?1:0,evidence,localId).run()
 if(!claimed.meta.changes)throw alreadyProcessing()
 try{
  // Workspace addresses the mail was routed through never become participants.
  const workspace=new Set<string>([from,target.mailbox,...to,...(project.from_address?[project.from_address]:[]),...cc.filter(address=>inboundTarget(address)?.mailbox===target.mailbox)])
  // An addressed thread admits its current participants and members. A reply address
  // issued to this sender is possession proof; otherwise member authority, and any
  // authority through somebody else's reply address, needs an authenticated From.
  let conversation:any=null,actor:Actor|null=null
  // An unauthenticated From naming a widget-verified customer, or one the provider
  // reported as failing, may be forged: it never writes as that customer or into
  // their threads. Such mail stays in Suspended until an operator reviews it.
  // Mail with no usable From has no author to authenticate: only the reply address
  // issued to its envelope sender admits it to that thread; otherwise it is kept
  // in Suspended, and no reply is sent to anybody until an operator chooses.
  const rule=await senderRule(env,project.project_id,from)
  const blocked=await env.DB.prepare("SELECT 1 FROM contacts WHERE project_id=? AND lower(email)=? AND (coalesce(json_extract(metadata_json,'$.is_blocked'),0)=1 OR coalesce(json_extract(metadata_json,'$.is_erased'),0)=1 OR coalesce(json_extract(metadata_json,'$.is_deleted'),0)=1)").bind(project.project_id,from).first()
  const spam=input.evidence?.headers['x-spam-flag']==='YES'||Number(input.evidence?.headers['x-spam-score']||0)>=5
  const isolated=!trusted
  const selfLoop=from===target.mailbox||from===project.from_address
  const addressedConversation=addressed?await env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(addressed,project.project_id).first<any>():null
  // A Closed ticket is final. A workspace member's mail to it is refused, with a bounce or
  // a notice; it is never stored, and never filed under a contact made from their address.
  if(addressedConversation?.status_category==='closed'&&await isMemberAddress(env,project.project_id,from)){
   await env.DB.prepare("UPDATE inbound_emails SET state='ignored',error=?,conversation_id=? WHERE id=? AND claim_token=?").bind(CLOSED_TICKET_FINAL,addressedConversation.id,recordId,claimToken).run()
   throw refusal(addressedConversation)
  }
  const suspensionReason=rule?.action==='block'||blocked?'blocked_sender':selfLoop?'mail_loop':threadConflict&&!recovering?'conflicting_thread_keys':isolated?(unusable?'unusable_from':input.senderFailed?'authentication_failed':'sender_unproven'):spam&&!recovering&&rule?.action!=='allow'?'spam':null
  if(suspensionReason)return suspendEmail(env,input,{projectId:project.project_id,receiptId:recordId,claimToken,reason:suspensionReason,candidateId:addressed})
  if(addressedConversation&&!isolated&&(trusted||!grant)){
   actor=await emailActor(env,project.project_id,addressedConversation,from,trusted,possessed)||(possessed?await preferredAddressActor(env,project.project_id,addressedConversation,from):null)
   if(actor)conversation=addressedConversation
  }
  if(addressed&&!actor)return suspendEmail(env,input,{projectId:project.project_id,receiptId:recordId,claimToken,reason:'thread_identity_mismatch',candidateId:addressed})
  // That contact's reply to a Closed ticket is admitted into the ticket's linked follow-up
  // (workflows/followups.ts; a retry returns to it), never another open ticket of theirs.
  // Everything else is the sender's own mail to the support mailbox: it continues
  // their most recently active open thread or starts one, and is never refused.
  if(!actor){
   const contact=await emailContact(env,project.project_id,from)
   if(!contact)return suspendEmail(env,input,{projectId:project.project_id,receiptId:recordId,claimToken,reason:'contact_unavailable'})
   actor={id:contact.id,contactId:contact.id,projectId:project.project_id,role:'contact'}
   conversation=(prior?.conversation_id?await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND project_id=? AND contact_id=? AND status_category<>'closed'").bind(prior.conversation_id,project.project_id,contact.id).first<any>():null)||(thread.possiblePreMigrationReply?await newConversation(env,project.project_id,contact.id,recordId,claimToken):await openEmailConversation(env,project.project_id,contact.id,project.mailbox_id))
   if(!conversation){
    const key=id(),now=Date.now()
    await env.DB.batch([
     env.DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,mailbox_id) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND contact_id=? AND resolved_at IS NULL AND status_category<>'closed' AND (? IS NULL OR mailbox_id=?) AND NOT EXISTS(SELECT 1 FROM request_form_submissions form WHERE form.conversation_id=conversations.id AND form.project_id=conversations.project_id))").bind(key,project.project_id,contact.id,now,now,project.mailbox_id,project.project_id,contact.id,project.mailbox_id,project.mailbox_id),
     env.DB.prepare('UPDATE inbound_emails SET conversation_id=? WHERE id=? AND claim_token=? AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND project_id=?)').bind(key,recordId,claimToken,key,project.project_id),
     trackingStatement(env,key,true),
    ])
    conversation=await openEmailConversation(env,project.project_id,contact.id,project.mailbox_id)
   }
  }
  await env.DB.prepare('UPDATE inbound_emails SET conversation_id=? WHERE id=? AND claim_token=?').bind(conversation.id,recordId,claimToken).run()
  if(project.mailbox_id)await env.DB.prepare('UPDATE conversations SET mailbox_id=? WHERE id=? AND project_id=? AND mailbox_id IS NULL').bind(project.mailbox_id,conversation.id,project.project_id).run()
  if(thread.possiblePreMigrationReply)await markPreMigrationReply(env,project.project_id,conversation.id)
  // CC recipients become participants atomically with message admission, only for a
  // sender whose identity or reply address is proven; otherwise they are skipped.
  const participants=automatic||!trusted?[]:await ccContacts(env,project.project_id,conversation,cc,workspace)
  const mediaIds:string[]=[]
  for(const [index,file] of attachments.entries()){
   // Stable identities make interrupted local R2/D1 staging repeatable.
   const key=await hashToken(`${project.project_id}:${messageId}:${index}`),objectKey=`${project.project_id}/${conversation.id}/${key}`
   await env.FILES.put(objectKey,file.content,{httpMetadata:{contentType:file.contentType}})
   // A retry that lands in another conversation (its first one was closed meanwhile) moves the unattached staging with it.
   await env.DB.prepare('INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,uploaded_by=excluded.uploaded_by,object_key=excluded.object_key WHERE media.message_id IS NULL AND media.project_id=excluded.project_id').bind(key,project.project_id,conversation.id,actor.id,objectKey,file.filename,file.contentType,file.content.byteLength,Date.now()).run()
   mediaIds.push(key)
  }
  const result=await admitMessage(env,{projectId:project.project_id,conversationId:conversation.id,actor,localId,content,expectedRevision:conversation.revision,expectedLastMessageId:conversation.last_message_id,mediaIds,[inboundAuthority]:{sender:from,receiptId:recordId,claimToken,raw,cc:participants,authenticated,...(project.mailbox_id?{mailboxId:project.mailbox_id,mailboxAddress:target.mailbox}:{}),...(possessed?{grant:await hashToken(target.replyToken!)}:{})}})
  // Closed between routing and admission: a temporary failure, so the retry opens the new ticket.
  if(result.reason==='ticket_closed_followup_required')throw new HTTPException(503,{message:'The addressed ticket was closed; retry later'})
  if(result.reason==='knowledge_access_changed')throw new HTTPException(409,{message:'Knowledge access changed; review the current recipients and grants before replying'})
  if(!result.accepted)throw new Error(result.reason)
  await env.DB.prepare("UPDATE inbound_emails SET state='delivered',message_id=?,error=NULL WHERE id=?").bind(String(result.message!.id),recordId).run()
  await env.DB.batch(emailThreadingStatements(env,{projectId:project.project_id,conversationId:result.followupConversationId??conversation.id,keys:[{kind:'message_id',value:messageId,source:'native',sourceRef:String(result.message!.id)}],createdAt:Date.now()}))
  await keepReplyTarget(env,project.project_id,actor,input.replyTo,{authenticated,automatic,workspace})
  return {id:messageId,state:'delivered',conversationId:result.followupConversationId??conversation.id,duplicate:false,automatic,message:result.message,actor}
 }catch(error){await env.DB.prepare("UPDATE inbound_emails SET state='failed',error=? WHERE id=? AND state='processing' AND claim_token=?").bind(String(error).slice(0,1000),recordId,claimToken).run();throw error}
}
/** A fresh conversation for an unmatched migration reply, checkpointed for retries. */
async function newConversation(env:Env,projectId:string,contactId:string,recordId:string,claimToken:string){
 const key=id(),now=Date.now()
 await env.DB.batch([
  env.DB.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(key,projectId,contactId,now,now),
  env.DB.prepare('UPDATE inbound_emails SET conversation_id=? WHERE id=? AND claim_token=? AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND project_id=?)').bind(key,recordId,claimToken,key,projectId),
  trackingStatement(env,key,true),
 ])
 return env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(key,projectId).first<any>()
}
/** An authenticated contact's Reply-To becomes where operator replies are sent.
 * Its source never proves the reply target for automatic notices. It never changes who they are, and never the
 * preference of a widget-verified customer, which only they or an operator set. */
async function keepReplyTarget(env:Env,projectId:string,actor:Actor,value:unknown,context:{authenticated:boolean;automatic:boolean;workspace:ReadonlySet<string>}){
 const replyTo=mailboxAddress(emailAddress(value))
 if(!replyTo||actor.role!=='contact'||!context.authenticated||context.automatic||context.workspace.has(replyTo)||inboundTarget(replyTo)&&await env.DB.prepare('SELECT 1 FROM email_settings WHERE lower(inbound_address)=?').bind(inboundTarget(replyTo)!.mailbox).first())return
 await env.DB.prepare(`UPDATE contacts SET metadata_json=json_set(json_remove(coalesce(metadata_json,'{}'),'$.provided_email_set_by','$.provided_email_set_at'),'$.provided_email',?,'$.provided_email_source','reply_to') WHERE id=? AND project_id=? AND coalesce(is_verified,0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1
  AND NOT EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=?)`).bind(replyTo,actor.contactId,projectId,projectId,replyTo).run()
}
