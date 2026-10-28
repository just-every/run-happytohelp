import {rerMail} from '../../integrations/rer-mail-contract'
import {rerMailboxStatus} from '../../integrations/rer-mailbox'
import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import type {Configuration} from './configuration'
import type {Probe} from './types'
import {receivingState} from '../../integrations/inbound-capability'
import {inboundIntent} from '../../integrations/inbound-intent'

/** Verify the immutable ingress intent as well as the settings snapshot. A mailbox
 * can change between ingress lookup and insertion; the trigger alone is not proof
 * of the recipient. A plain-text receipt can be reconstructed without opening R2. */
export async function checkInbound(env:Env,config:Configuration):Promise<Probe> {
 if(rerMail(env)){
  const bound=await rerMailboxStatus(env,config.projectId)
  return {state:bound?.observed?'done':bound?.state==='failed'?'failed':'pending',receiptRef:bound?.observed?`rer:inbound:${bound.lastInboundAt}`:null,detail:bound?.observed?`A signed email reached ${bound.address}.`:bound?.error||(!bound?.routeActive?'Run Edit Run is activating the receiving route. No customer mail setup is needed.':`Waiting for the first email to ${bound.address}. An active route alone does not prove receiving.`)}
 }
 const email=config.email
 const receiving=await receivingState(env,email?.inbound_address)
 if(receiving.reason==='workers_dev')return {state:'unavailable',detail:`${receiving.address} cannot receive email: workers.dev addresses have no mail server. Use an address on a domain you own; the Email page has the steps.`}
 // Without the installation's gateway token no mailbox can receive, whatever is saved.
 if(!env.INBOUND_EMAIL_TOKEN)return {state:'unavailable',detail:'CONFIGURATION_REQUIRED: INBOUND_EMAIL_TOKEN. Configure the authenticated inbound gateway in the installation.'}
 if(!email?.is_enabled||!email.inbound_address)return {state:'pending',detail:'Save and enable your receiving address in Email settings.'}
 const address=email.inbound_address.toLowerCase()
 const rows=await env.DB.prepare(`SELECT i.id,i.intent_hash,m.content,m.conversation_id,c.email sender
  FROM activation_inbound_receipts r JOIN inbound_emails i ON i.id=r.inbound_id AND i.project_id=r.project_id
  JOIN messages m ON m.id=i.message_id AND m.project_id=i.project_id AND m.local_id=i.local_id
  JOIN contacts c ON c.id=m.actor_id AND c.project_id=m.project_id
  WHERE r.project_id=? AND r.address=? AND r.settings_updated_at=? AND i.state='delivered'
  AND m.actor_role='contact' AND NOT EXISTS(SELECT 1 FROM media f WHERE f.message_id=m.id)
  ORDER BY i.created_at DESC LIMIT 20`).bind(config.projectId,address,email.updated_at).all<{id:string;intent_hash:string;content:string;conversation_id:string;sender:string}>()
 for(const row of rows.results) {
  // Initial mail omits a conversation ID; a reply includes the admitted conversation.
  const hashes=(await Promise.all([null,row.conversation_id].map(async conversationId=>{
   const intent={from:row.sender,content:row.content,conversationId,attachments:[]}
   return [await hashToken(JSON.stringify({to:address,...intent})),await inboundIntent(config.projectId,intent,address)]
  }))).flat()
  if(hashes.includes(row.intent_hash))return {state:'done',detail:`A message was received through the configured inbound gateway for ${address}.`,receiptRef:`inbound:${row.id}`}
 }
 if(receiving.reason==='no_mx')return {state:'pending',detail:`${address} cannot receive email yet: its domain has no mail server (MX record). The Email page has the routing steps.`}
 return {state:'pending',detail:`Waiting for a plain-text message without attachments through your inbound provider to ${address}. Saving the address alone does not prove receiving. The check sends no email.`}
}
