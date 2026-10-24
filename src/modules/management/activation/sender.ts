import {rerMail} from '../../integrations/rer-mail-contract'
import type {Env} from '../../../platform/env'
import {emailAddress} from '../../integrations/inbound-routing'
import type {Configuration} from './configuration'

/** The switch recorded in project settings (`sender_switch`) when the workspace's verified sender was adopted. */
export type SenderSwitch={from:string;to:string;at:number}
export function senderSwitch(settings:any):SenderSwitch|null {
 const value=settings?.sender_switch
 return typeof value?.from==='string'&&typeof value?.to==='string'&&typeof value?.at==='number'?value:null
}

/** The address whose domain sender_dns checks. While the saved sender is still the seeded installation sender it is the
 * workspace's proposed sender (verifying it switches mail to it); once the owner has chosen a different sender it is that
 * address, which is only checked, never switched to. */
export const senderDnsAddress=(config:{sender:string|null;proposedSender?:string|null;senderOverridden?:boolean}):string|null=>
 config.senderOverridden?config.sender:config.proposedSender||config.sender
export const senderDnsDomain=(config:Parameters<typeof senderDnsAddress>[0]):string|null=>senderDnsAddress(config)?.split('@')[1]||null

/**
 * Once the proposed sender's domain is observed verified, mail goes out from it: the workspace's sender switches from
 * the installation sender it was seeded with. Compare-and-set in one batch, only while the saved sender is still that
 * seeded installation sender and the proposal is unchanged, so an address the owner chose is never overwritten. The
 * mailbox version (`updated_at`) is untouched: receiving is not affected. No mail is sent.
 */
export async function adoptProposedSender(env:Env,config:Configuration):Promise<boolean> {
 if(rerMail(env))return false
 const proposed=config.proposedSender,saved=config.email?.from_address
 if(!proposed||config.senderOverridden||typeof saved!=='string'||emailAddress(saved)===proposed)return false
 const record=JSON.stringify({from:emailAddress(saved),to:proposed,at:Date.now()})
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE email_settings SET from_address=? WHERE project_id=? AND from_address=? AND EXISTS(SELECT 1 FROM project_settings WHERE project_id=? AND lower(json_extract(settings_json,'$.proposed_sender'))=? AND json_type(settings_json,'$.deleted_at') IS NULL)`)
   .bind(proposed,config.projectId,saved,config.projectId,proposed),
  env.DB.prepare(`UPDATE project_settings SET settings_json=json_set(settings_json,'$.sender_switch',json(?)),updated_at=? WHERE project_id=? AND EXISTS(SELECT 1 FROM email_settings WHERE project_id=? AND from_address=?)`)
   .bind(record,Date.now(),config.projectId,config.projectId,proposed),
 ])
 return results[0].meta.changes>0
}
