import type {Env} from '../../../platform/env'
import {mailbox} from '../inbound-routing'
import {legacyMailS3Config} from './config'

/** What the Email settings read shows about the Amazon SES S3 reader: the mailbox, the last successful list and the
 * count of every receipt. Null when the reader is off, and for every workspace that does not receive on its mailbox,
 * so only the workspace the mail goes to ever sees the reader's state. */
export async function legacyMailS3Status(env:Env,inboundAddress:unknown){
 const config=legacyMailS3Config(env)
 if(!config||mailbox(inboundAddress)!==config.mailbox)return null
 const state=await env.DB.prepare('SELECT last_listed_at,last_list_error FROM legacy_mail_s3_state WHERE id=1').first<{last_listed_at:number|null;last_list_error:string|null}>()
 const rows=(await env.DB.prepare('SELECT state,reason,source,count(*) n FROM legacy_mail_s3_receipts GROUP BY state,reason,source').all<{state:string;reason:string|null;source:string;n:number}>()).results
 const counts={pending:0,pendingMailbox:0,complete:0,held:{} as Record<string,number>,failed:0,setupNotice:0,duplicate:0,replay:0}
 for(const row of rows){
  if(row.source==='replay')counts.replay+=row.n
  if(['pending','processing','retry'].includes(row.state))counts.pending+=row.n
  else if(row.state==='pending_mailbox')counts.pendingMailbox+=row.n
  else if(row.state==='complete')counts.complete+=row.n
  else if(row.state==='held')counts.held[row.reason||'unspecified']=(counts.held[row.reason||'unspecified']||0)+row.n
  else if(row.state==='failed')counts.failed+=row.n
  else if(row.state==='setup_notice')counts.setupNotice+=row.n
  else if(row.state==='duplicate')counts.duplicate+=row.n
 }
 return {mailbox:config.mailbox,lastListedAt:state?.last_listed_at?new Date(state.last_listed_at).toISOString():null,lastListError:state?.last_list_error??null,counts}
}
