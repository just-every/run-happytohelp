import type {Env} from '../../../platform/env'
import type {Condition} from './condition'
import {rerMail} from '../../integrations/rer-mail-contract'

/** The reserved default is claimed by exactly the first workspace transaction.
 * Additional workspaces keep their own stable allocation key until control binds.
 * No name or guessed website domain can claim a managed address. */
export function rerMailboxSeed(env:Env,seed:{projectId:string;name:string},now:number,when:Condition){
 if(!rerMail(env))return []
 const first='NOT EXISTS(SELECT 1 FROM rer_mailboxes)'
 return [
  env.DB.prepare(`INSERT OR IGNORE INTO rer_mailboxes(project_id,allocation_key,mailbox_id,address,state,updated_at)
   SELECT ?,CASE WHEN ${first} THEN 'default' ELSE ? END,CASE WHEN ${first} THEN ? ELSE NULL END,CASE WHEN ${first} THEN ? ELSE NULL END,'pending',? WHERE ${when.sql}`)
   .bind(seed.projectId,`workspace:${seed.projectId}`,env.RER_MAILBOX_ID||null,env.RER_MAIL_ADDRESS||null,now,...when.params),
  env.DB.prepare(`INSERT OR IGNORE INTO email_settings(project_id,from_name,from_address,inbound_address,is_enabled,updated_at)
   SELECT project_id,?,coalesce(address,''),address,0,? FROM rer_mailboxes WHERE project_id=? AND ${when.sql}`)
   .bind(seed.name.slice(0,200),now,seed.projectId,...when.params),
  env.DB.prepare(`INSERT OR IGNORE INTO rer_mailbox_outbox(project_id) SELECT ? WHERE ${when.sql}`).bind(seed.projectId,...when.params),
 ]
}
