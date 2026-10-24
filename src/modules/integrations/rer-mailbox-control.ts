import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {mailService,mailJson,type ManagedMailbox} from './rer-mail-contract'

type ControlStatus={mailboxId:string;address:string;workspaceId:string|null;generation:number;state:'reserved'|'active'|'failed'|'revoked';configured:boolean;routeActive:boolean;observed:boolean;lastInboundAt:number|null}
export function mailboxControlStatus(value:any,row:ManagedMailbox,action:string):ControlStatus{
 if(!value||typeof value.mailboxId!=='string'||!value.mailboxId||typeof value.address!=='string'||!/^hth-[a-zA-Z0-9-]+@[^\s@]+\.[^\s@]+$/.test(value.address)||row.mailbox_id&&row.mailbox_id!==value.mailboxId||row.address&&row.address!==value.address||!Number.isSafeInteger(value.generation)||value.generation<Math.max(1,row.generation)||!['reserved','active','failed','revoked'].includes(value.state)||typeof value.configured!=='boolean'||typeof value.routeActive!=='boolean'||value.workspaceId!==null&&value.workspaceId!==row.project_id||action==='bind'&&(value.state!=='active'||value.workspaceId!==row.project_id)||action==='retire'&&value.state!=='revoked')throw new HTTPException(409,{message:'Managed mailbox assignment conflicts with this workspace'})
 return value
}
export async function mailboxControl(env:Env,payload:Record<string,string>){
 const response=await fetch(mailService(env.RER_MAIL_CONTROL_URL),{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new HTTPException(response.status===409?409:503,{message:response.status===409?'Managed mailbox assignment conflicts with this workspace':`Managed mailbox service is unavailable (${response.status})`})
 return mailJson(response)
}
