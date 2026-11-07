import type {Env} from '../../../platform/env'
import type {AttachmentRun} from './store'
const REFUSALS_SHOWN=500
/** A run with the workspace's totals and its current refusals by attachment id (with its
 * ticket) and by ticket id for tickets Zendesk no longer returns. Codes and ids only:
 * never a URL, token, file name or Location. */
export async function attachmentView(env:Env,run:AttachmentRun){
 const [states,refused,tickets,ticketTotal]=await env.DB.batch<any>([
  env.DB.prepare('SELECT state,COUNT(*) n FROM move_in_zendesk_attachments WHERE project_id=? GROUP BY state').bind(run.project_id),
  env.DB.prepare("SELECT attachment_id attachmentId,ticket_id ticketId,reason FROM move_in_zendesk_attachments WHERE project_id=? AND state='refused' ORDER BY CAST(ticket_id AS INTEGER),CAST(attachment_id AS INTEGER) LIMIT ?").bind(run.project_id,REFUSALS_SHOWN),
  env.DB.prepare("SELECT t.ticket_id ticketId,t.reason FROM move_in_zendesk_attachment_tickets t WHERE t.project_id=?1 AND EXISTS(SELECT 1 FROM move_in_conversations c WHERE c.project_id=?1 AND c.vendor='zendesk' AND c.source_id=t.ticket_id) ORDER BY CAST(t.ticket_id AS INTEGER) LIMIT ?2").bind(run.project_id,REFUSALS_SHOWN),
  env.DB.prepare("SELECT COUNT(*) n FROM move_in_zendesk_attachment_tickets t WHERE t.project_id=?1 AND EXISTS(SELECT 1 FROM move_in_conversations c WHERE c.project_id=?1 AND c.vendor='zendesk' AND c.source_id=t.ticket_id)").bind(run.project_id)])
 const of=(state:string)=>Number(states.results.find((row:any)=>row.state===state)?.n??0),stored=of('stored'),pending=of('pending'),refusedTotal=of('refused')
 return {
  id:run.id,state:run.state,error:run.error,nextAt:run.next_at||null,createdAt:run.created_at,
  totals:{attachments:stored+pending+refusedTotal,stored,pending,refused:refusedTotal},
  refusals:[...tickets.results.map((t:any)=>({attachmentId:null,ticketId:String(t.ticketId),reason:t.reason})),...refused.results.map((r:any)=>({attachmentId:String(r.attachmentId),ticketId:String(r.ticketId),reason:r.reason}))].slice(0,REFUSALS_SHOWN),
  refusalsTotal:refusedTotal+Number(ticketTotal.results[0]?.n??0)
 }
}
