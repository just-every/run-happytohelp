import type {Env} from '../../platform/env'
import {emailAddress,inboundTarget} from './inbound-routing'

const enabledMailboxes=`SELECT e.project_id,lower(e.inbound_address) inbound_address,lower(e.from_address) from_address,NULL mailbox_id FROM email_settings e WHERE lower(e.inbound_address) IN (SELECT value FROM json_each(?1)) AND e.is_enabled=1 AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=e.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)
 UNION ALL SELECT a.project_id,lower(a.address),lower(m.sender_address),m.id FROM mailbox_addresses a JOIN mailbox_connections m ON m.id=a.mailbox_id AND m.project_id=a.project_id WHERE lower(a.address) IN (SELECT value FROM json_each(?1)) AND m.status='connected' AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=a.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)`
/** The first candidate, in order, that names an enabled mailbox. One lookup: D1
 * binds at most 100 parameters and the candidates are bounded below that. */
export async function receivingMailbox(env:Env,candidates:string[]){
 // An explicitly configured plus address is a mailbox in its own right. Only
 // interpret its suffix as a reply token when that exact address is unconfigured.
 const targets=candidates.flatMap(value=>{
  const exact=emailAddress(value),reply=inboundTarget(value)
  return [...(exact?[{mailbox:exact,conversationId:null}]:[]),...(reply?[reply]:[])]
 }),mailboxes=[...new Set(targets.map(target=>target.mailbox))].slice(0,90)
 if(!mailboxes.length)return null
 const rows=(await env.DB.prepare(enabledMailboxes).bind(JSON.stringify(mailboxes)).all<{project_id:string;inbound_address:string;from_address:string|null;mailbox_id:string|null}>()).results
 for(const target of targets){
  const row=rows.find(entry=>entry.inbound_address===target.mailbox)
  if(row)return {project:{project_id:row.project_id,from_address:row.from_address,mailbox_id:row.mailbox_id},target}
 }
 return null
}
