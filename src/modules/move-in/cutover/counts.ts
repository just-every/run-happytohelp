import type {Env} from '../../../platform/env'
import {pullView} from '../zendesk-source/view'
import type {PullRow} from '../zendesk-source/pull-store'
import type {Step} from './steps'

const iso=(ms:number|null|undefined)=>ms==null?null:new Date(ms).toISOString()
const none={yours:false,canStop:false,canTakeOver:false}

/** Conversations Move in imported from Zendesk (uploads and pulls alike) that are still in this workspace, so an undone import drops out. */
async function zendeskImported(env:Env,projectId:string){
 const row=await env.DB.prepare("SELECT COUNT(*) n FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=? AND m.vendor='zendesk'").bind(projectId).first<{n:number}>()
 return row?.n??0
}

/** The newest applied pull: when it finished applying, with the tickets and replies it imported as Move in itself counts them. */
async function lastPull(env:Env,projectId:string){
 const pull=await env.DB.prepare("SELECT * FROM move_in_zendesk_pulls WHERE project_id=? AND state='applied' ORDER BY updated_at DESC LIMIT 1").bind(projectId).first<PullRow>()
 if(!pull)return null
 const view=await pullView(env,pull,none)
 return {at:new Date(pull.updated_at).toISOString(),ms:pull.updated_at,tickets:view.totals.tickets.imported,replies:view.totals.replies.imported}
}

/** Legacy conversations are journaled by source table and source id, and keep that id natively. A run's journal has no workspace
 * column, so the workspace's own conversations select the journal rows (CROSS JOIN keeps that order, a probe per conversation
 * into the covering index, never a pass over the whole journal), and those rows name the runs that touched the workspace.
 * A chunked package journals each chunk as its own run, and its tables after conversations (messages, events, media and the
 * rest) land after the conversations chunk; the package's own run `legacy-package:<digest>` completes only after every chunk.
 * So a chunk run sweeps when its package run completes, and a one-file import when its own run does; a sweep still running
 * counts for nothing. A chunk names its package in its source as `"package":"<digest>"`. The source is written by `stable()`,
 * which is not always valid JSON (an absent field is written as `undefined`), so the digest is read by position, not by
 * json_extract; a quote inside a value is escaped, so `"package":"` only ever starts that key. */
async function legacy(env:Env,projectId:string){
 const marker='"package":"'
 const row=await env.DB.prepare(`WITH journal AS (SELECT c.id conversation,r.run_id run FROM conversations c
   CROSS JOIN legacy_import_rows r ON r.source_table='conversations' AND r.source_id=c.id AND r.status='mapped'
   WHERE c.project_id=?1),
  runs AS (SELECT run.state,run.completed_at,CASE WHEN instr(run.source_json,?2)>0
    THEN 'legacy-package:'||substr(run.source_json,instr(run.source_json,?2)+length(?2),64) END package
   FROM legacy_import_runs run WHERE run.id IN (SELECT run FROM journal))
  SELECT (SELECT COUNT(DISTINCT conversation) FROM journal) imported,
   (SELECT MAX(CASE WHEN p.id IS NULL THEN CASE WHEN runs.state='complete' THEN runs.completed_at END
     WHEN p.state='complete' THEN p.completed_at END) FROM runs LEFT JOIN legacy_import_runs p ON p.id=runs.package) swept`)
  .bind(projectId,marker).first<{imported:number;swept:number|null}>()
 return {imported:row?.imported??0,swept:row?.swept??null}
}

/** Mail delivered into the workspace after `since`. */
async function emailArrivals(env:Env,projectId:string,since:number|null){
 const row=await env.DB.prepare(`SELECT COUNT(*) n FROM inbound_emails WHERE project_id=? AND state='delivered'${since===null?'':' AND created_at>?'}`).bind(projectId,...(since===null?[]:[since])).first<{n:number}>()
 return row?.n??0
}

/**
 * Conversations a visitor started through the widget after `since`, in which the visitor has written.
 * The widget leaves `channel` at its default, which every other intake that sets no channel shares, so the
 * count excludes each of them by its own record: email (a receipt for the conversation, or a mailbox), every
 * Move in and legacy import, and a follow-up the system opened. The creator is a contact (an agent, the API
 * and outbound tickets record another submitter), and the message that counts is the visitor's own, not a
 * customer's email reply.
 */
async function widgetArrivals(env:Env,projectId:string,since:number|null){
 const row=await env.DB.prepare(`SELECT COUNT(*) n FROM conversations c
  WHERE c.project_id=?${since===null?'':' AND c.created_at>?'}
   AND c.channel='widget' AND c.submitter_type='contact' AND c.mailbox_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=c.project_id AND e.conversation_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.conversation_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM legacy_import_rows l WHERE l.source_table='conversations' AND l.source_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM ticket_followups f WHERE f.conversation_id=c.id)
   AND EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id AND m.actor_role='contact'
    AND NOT EXISTS(SELECT 1 FROM inbound_emails r WHERE r.project_id=m.project_id AND r.message_id=m.id))`).bind(projectId,...(since===null?[]:[since])).first<{n:number}>()
 return row?.n??0
}

/** Each source's state, which is its newest step's, and its live counts. Reads only this workspace's rows and calls nothing outside the database. */
export async function cutoverSources(env:Env,projectId:string,steps:Step[]){
 const of=(source:string)=>steps.filter(step=>step.source===source),newest=(source:string)=>of(source)[0]
 const [imported,pull,sweep]=await Promise.all([zendeskImported(env,projectId),lastPull(env,projectId),legacy(env,projectId)])
 // Mail and widget arrivals count from the latest of the last pull, the last sweep and the source's own newest step.
 const since=(source:string)=>{const marks=[pull?.ms,sweep.swept,newest(source)&&Date.parse(newest(source).recordedAt)].filter((mark):mark is number=>typeof mark==='number');return marks.length?Math.max(...marks):null}
 const [emailSince,widgetSince]=[since('email'),since('widget')]
 const [emails,widgets]=await Promise.all([emailArrivals(env,projectId,emailSince),widgetArrivals(env,projectId,widgetSince)])
 const state=(source:string)=>newest(source)?.state??'incumbent'
 return [
  {id:'zendesk',state:state('zendesk'),counts:{imported,lastPull:pull?{at:pull.at,tickets:pull.tickets,replies:pull.replies}:null},steps:of('zendesk')},
  {id:'legacy',state:state('legacy'),counts:{imported:sweep.imported,lastSweep:sweep.swept===null?null:{at:iso(sweep.swept)}},steps:of('legacy')},
  {id:'email',state:state('email'),counts:{arrivals:emails,since:iso(emailSince)},steps:of('email')},
  {id:'widget',state:state('widget'),counts:{arrivals:widgets,since:iso(widgetSince)},steps:of('widget')},
 ]
}
