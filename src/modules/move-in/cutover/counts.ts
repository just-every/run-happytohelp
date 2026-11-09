import type {Env} from '../../../platform/env'
import {pullView} from '../zendesk-source/view'
import type {PullRow} from '../zendesk-source/pull-store'
import type {Step} from './steps'

const iso=(ms:number|null|undefined)=>ms==null?null:new Date(ms).toISOString()
const none={yours:false,canStop:false,canTakeOver:false}

/** The workspace's tallies (migration 317): the Zendesk-imported conversations still present, the legacy-journaled
 * conversations and the widget arrivals of all time, one row kept current by triggers. A workspace with none has no row. */
async function tallies(env:Env,projectId:string){
 const row=await env.DB.prepare('SELECT zendesk,legacy,widget FROM cutover_tallies WHERE project_id=?').bind(projectId).first<{zendesk:number;legacy:number;widget:number}>()
 return {zendesk:row?.zendesk??0,legacy:row?.legacy??0,widget:row?.widget??0}
}

/** The newest applied pull: when it finished applying, with the tickets and replies it imported as Move in itself counts them. */
async function lastPull(env:Env,projectId:string){
 const pull=await env.DB.prepare("SELECT * FROM move_in_zendesk_pulls WHERE project_id=? AND state='applied' ORDER BY updated_at DESC LIMIT 1").bind(projectId).first<PullRow>()
 if(!pull)return null
 const view=await pullView(env,pull,none)
 return {at:new Date(pull.updated_at).toISOString(),ms:pull.updated_at,tickets:view.totals.tickets.imported,replies:view.totals.replies.imported}
}

/** The last sweep. Legacy conversations are journaled by source table and source id, and keep that id natively; a run's
 * journal has no workspace column, so migration 317 keeps the runs whose journal maps a conversation of the workspace
 * (cutover_legacy_runs), and their state is read here, live. A chunked package journals each chunk as its own run, and
 * its tables after conversations (messages, events, media and the rest) land after the conversations chunk; the
 * package's own run `legacy-package:<digest>` completes only after every chunk. So a chunk run sweeps when its package
 * run completes, and a one-file import when its own run does; a sweep still running counts for nothing. A chunk names
 * its package in its source as `"package":"<digest>"`. The source is written by `stable()`, which is not always valid
 * JSON (an absent field is written as `undefined`), so the digest is read by position, not by json_extract; a quote
 * inside a value is escaped, so `"package":"` only ever starts that key. */
async function lastSweep(env:Env,projectId:string){
 const row=await env.DB.prepare(`WITH runs AS (SELECT run.state,run.completed_at,CASE WHEN instr(run.source_json,?2)>0
    THEN 'legacy-package:'||substr(run.source_json,instr(run.source_json,?2)+length(?2),64) END package
   FROM cutover_legacy_runs touched JOIN legacy_import_runs run ON run.id=touched.run_id WHERE touched.project_id=?1)
  SELECT MAX(CASE WHEN p.id IS NULL THEN CASE WHEN runs.state='complete' THEN runs.completed_at END
     WHEN p.state='complete' THEN p.completed_at END) swept FROM runs LEFT JOIN legacy_import_runs p ON p.id=runs.package`)
  .bind(projectId,'"package":"').first<{swept:number|null}>()
 return row?.swept??null
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
 * customer's email reply. Migration 317 keeps exactly those conversations with their creation time, so the count is
 * one index range after `since` (one row per arrival counted), or the workspace's tally when nothing has moved yet.
 */
async function widgetArrivals(env:Env,projectId:string,since:number|null,total:number){
 if(since===null)return total
 const row=await env.DB.prepare('SELECT COUNT(*) n FROM cutover_widget_arrivals WHERE project_id=? AND created_at>?').bind(projectId,since).first<{n:number}>()
 return row?.n??0
}

/** Each source's state, which is its newest step's, and its live counts. Reads only this workspace's rows and calls nothing outside the database. */
export async function cutoverSources(env:Env,projectId:string,steps:Step[]){
 const of=(source:string)=>steps.filter(step=>step.source===source),newest=(source:string)=>of(source)[0]
 const [tally,pull,swept]=await Promise.all([tallies(env,projectId),lastPull(env,projectId),lastSweep(env,projectId)])
 const imported=tally.zendesk,sweep={imported:tally.legacy,swept}
 // Mail and widget arrivals count from the latest of the last pull, the last sweep and the source's own newest step.
 const since=(source:string)=>{const marks=[pull?.ms,sweep.swept,newest(source)&&Date.parse(newest(source).recordedAt)].filter((mark):mark is number=>typeof mark==='number');return marks.length?Math.max(...marks):null}
 const [emailSince,widgetSince]=[since('email'),since('widget')]
 const [emails,widgets]=await Promise.all([emailArrivals(env,projectId,emailSince),widgetArrivals(env,projectId,widgetSince,tally.widget)])
 const state=(source:string)=>newest(source)?.state??'incumbent'
 return [
  {id:'zendesk',state:state('zendesk'),counts:{imported,lastPull:pull?{at:pull.at,tickets:pull.tickets,replies:pull.replies}:null},steps:of('zendesk')},
  {id:'legacy',state:state('legacy'),counts:{imported:sweep.imported,lastSweep:sweep.swept===null?null:{at:iso(sweep.swept)}},steps:of('legacy')},
  {id:'email',state:state('email'),counts:{arrivals:emails,since:iso(emailSince)},steps:of('email')},
  {id:'widget',state:state('widget'),counts:{arrivals:widgets,since:iso(widgetSince)},steps:of('widget')},
 ]
}
