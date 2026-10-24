import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {mailService,mailJson,managedMailAddress,type ManagedMailbox} from './rer-mail-contract'

type ControlStatus={mailboxId:string;address:string;workspaceId:string|null;generation:number;state:'reserved'|'active'|'failed'|'revoked';configured:boolean;routeActive:boolean;observed:boolean;lastInboundAt:number|null}
export function mailboxControlStatus(value:any,row:ManagedMailbox,action:string):ControlStatus{
 if(!value||typeof value.mailboxId!=='string'||!value.mailboxId||typeof value.address!=='string'||!/^hth-[a-zA-Z0-9-]+@[^\s@]+\.[^\s@]+$/.test(value.address)||row.mailbox_id&&row.mailbox_id!==value.mailboxId||row.address&&managedMailAddress(row.address)!==managedMailAddress(value.address)||!Number.isSafeInteger(value.generation)||value.generation<Math.max(1,row.generation)||!['reserved','active','failed','revoked'].includes(value.state)||typeof value.configured!=='boolean'||typeof value.routeActive!=='boolean'||value.workspaceId!==null&&value.workspaceId!==row.project_id||action==='bind'&&(value.state!=='active'||value.workspaceId!==row.project_id)||action==='retire'&&value.state!=='revoked')throw new HTTPException(409,{message:'Managed mailbox assignment conflicts with this workspace'})
 return {...value,address:managedMailAddress(value.address)!}
}
export async function mailboxControl(env:Env,payload:Record<string,string>){
 const response=await fetch(mailService(env.RER_MAIL_CONTROL_URL),{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new HTTPException(response.status===409?409:503,{message:response.status===409?'Managed mailbox assignment conflicts with this workspace':`Managed mailbox service is unavailable (${response.status})`})
 return mailJson(response)
}

/** Keep address ownership case-insensitive, including older retained bindings. */
export async function retainMailboxAssignment(env:Env,row:ManagedMailbox,outcome:ControlStatus){
 const conflict=()=>new HTTPException(409,{message:'Managed mailbox assignment conflicts with this workspace'})
 try{
  const result=await env.DB.prepare(`UPDATE rer_mailboxes SET mailbox_id=?,address=? WHERE project_id=?
   AND (mailbox_id IS NULL OR mailbox_id=?)
   AND NOT EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id<>? AND lower(address)=?)
   AND NOT EXISTS(SELECT 1 FROM email_settings WHERE project_id<>? AND is_enabled=1 AND lower(inbound_address)=?)`)
   .bind(outcome.mailboxId,outcome.address,row.project_id,outcome.mailboxId,row.project_id,outcome.address,row.project_id,outcome.address).run()
  if(!result.meta.changes)throw conflict()
 }catch(error){
  if(/unique|constraint/i.test(String(error)))throw conflict()
  throw error
 }
}
