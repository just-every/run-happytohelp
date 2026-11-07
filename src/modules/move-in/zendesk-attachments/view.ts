import type {Env} from '../../../platform/env'
import {commentHeld} from './ledger'
import type {AttachmentRun} from './store'
const REFUSALS_SHOWN=500
/** A run with the workspace's totals and its current refusals by attachment id (with its
 * ticket) and by ticket id for tickets Zendesk no longer returns. Only attachments on
 * comments the workspace still holds count, and only tickets it still holds are listed.
 * Codes and ids only: never a URL, token, file name or Location. */
export async function attachmentView(env:Env,run:AttachmentRun){
 const [states,refused,tickets,ticketTotal]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT l.state,COUNT(*) n FROM move_in_zendesk_attachments l WHERE l.project_id=? AND ${commentHeld('l')} GROUP BY l.state`).bind(run.project_id),
  env.DB.prepare(`SELECT l.attachment_id attachmentId,l.ticket_id ticketId,l.reason FROM move_in_zendesk_attachments l WHERE l.project_id=? AND l.state='refused' AND ${commentHeld('l')} ORDER BY CAST(l.ticket_id AS INTEGER),CAST(l.attachment_id AS INTEGER) LIMIT ?`).bind(run.project_id,REFUSALS_SHOWN),
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
