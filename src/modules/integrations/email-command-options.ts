import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {emailAddress} from './inbound-routing'
import {requiredString} from '../../platform/db'

export function operatorRecipients(value:unknown):string[]{
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>50)throw new HTTPException(400,{message:'Use at most 50 CC or BCC recipients'})
 return [...new Set(value.map(raw=>{const address=emailAddress(raw);if(!address)throw new HTTPException(400,{message:'Invalid CC or BCC address'});return address}))]
}
/** Freeze recipients before the first message can enter its outbox. A changed
 * retry cannot silently redirect already acknowledged mail. BCC never creates
 * participants and is never returned to the customer transcript. */
export async function stageEmailMessageOptions(env:Env,actor:Actor,conversation:any,body:any){
 if(actor.role==='contact'){
  if(body.cc!==undefined||body.bcc!==undefined||body.mailboxId!==undefined||body.fromAddress!==undefined)throw new HTTPException(403)
  return
 }
 const ccAddresses=operatorRecipients(body.cc),bccAddresses=operatorRecipients(body.bcc)
 if(ccAddresses.length+bccAddresses.length>50||ccAddresses.some(address=>bccAddresses.includes(address)))throw new HTTPException(400,{message:'Use at most 50 distinct CC and BCC recipients'})
 const localId=requiredString(body.localId,'localId',200),cc=JSON.stringify(ccAddresses),bcc=JSON.stringify(bccAddresses),mailboxId=body.mailboxId||conversation.mailbox_id||null,fromAddress=body.fromAddress?emailAddress(body.fromAddress):null
 if(body.fromAddress&&!fromAddress)throw new HTTPException(400,{message:'Choose a valid sender address'})
 if(mailboxId&&!await env.DB.prepare("SELECT 1 FROM mailbox_connections WHERE id=? AND project_id=? AND status='connected'").bind(mailboxId,actor.projectId).first())throw new HTTPException(409,{message:'Mailbox is not connected'})
 const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO email_message_options(project_id,conversation_id,local_id,mailbox_id,agent_id,cc_json,bcc_json,from_address,created_at)
  SELECT c.project_id,c.id,?,?,?,?,?,?,? FROM conversations c JOIN memberships member ON member.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND member.user_id=? AND member.role=? RETURNING mailbox_id,agent_id,cc_json,bcc_json,from_address`).bind(localId,mailboxId,actor.id,cc,bcc,fromAddress,Date.now(),conversation.id,actor.projectId,actor.id,actor.role).first<any>()
 const prior=inserted??await env.DB.prepare('SELECT mailbox_id,agent_id,cc_json,bcc_json,from_address FROM email_message_options WHERE project_id=? AND conversation_id=? AND local_id=?').bind(actor.projectId,conversation.id,localId).first<any>()
 if(!prior||prior.mailbox_id!==mailboxId||prior.agent_id!==actor.id||prior.cc_json!==cc||prior.bcc_json!==bcc||prior.from_address!==fromAddress)throw new HTTPException(409,{message:'Email recipients conflict with the original command'})
}
