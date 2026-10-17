import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'

interface Intent {from:string;content:string;conversationId:string|null;attachments:unknown[];cc?:string[]}
/** The delivery belongs to the workspace, not whichever connected inbox observed
 * it first. Resolved candidates can change after admission, so only an explicit
 * native address/grant belongs in the immutable intent. */
export async function inboundIntent(projectId:string,intent:Intent){
 return `v2:${await hashToken(JSON.stringify({projectId,...intent}))}`
}
/** Read existing receipts without rewriting their replay fences. Their hash used
 * the selected mailbox and inferred conversation; try only configured addresses
 * of this workspace and the original unaddressed form when no direct target exists. */
export async function legacyInboundIntentMatches(env:Env,projectId:string,stored:string,intent:Intent,mailbox:string,addressed?:string){
 if(stored.startsWith('v2:'))return false
 const rows=(await env.DB.prepare(`SELECT lower(inbound_address) address FROM email_settings WHERE project_id=?1 UNION SELECT lower(address) FROM mailbox_addresses WHERE project_id=?1`).bind(projectId).all<{address:string}>()).results
 const targets=[...new Set([intent.conversationId,addressed||null])]
 for(const to of new Set([mailbox,...rows.map(row=>row.address)]))for(const conversationId of targets){
  if(intent.conversationId&&conversationId!==intent.conversationId)continue
  if(await hashToken(JSON.stringify({to,from:intent.from,content:intent.content,conversationId,attachments:intent.attachments,...(intent.cc?.length?{cc:intent.cc}:{})}))===stored)return true
 }
 return false
}
