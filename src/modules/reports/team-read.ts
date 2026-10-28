import type {Env} from '../../platform/env'
import type {ReportRange} from './calendar'
import {statement,type TeamReportContext,type TeamReportFilters} from './team-scope'
import {teamBacklog,teamWorkload} from './team-workload'
import {teamReopens,teamSla} from './team-service'
import {teamBreakdowns} from './team-breakdowns'
import {teamHandleTime} from './team-handle-time'
import {containmentRule} from './team-containment'

async function reportOptions({env,projectId}:TeamReportContext){
 const [teams,brands,agents]=await Promise.all([
  env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(projectId).all<{id:string;name:string}>(),
  env.DB.prepare(`SELECT id,name FROM projects WHERE id=?1 UNION SELECT DISTINCT c.brand_id id,c.brand_id name FROM conversations c WHERE c.project_id=?1 AND c.brand_id IS NOT NULL AND c.brand_id<>?1 ORDER BY name,id`).bind(projectId).all<{id:string;name:string}>(),
  env.DB.prepare('SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.name,u.id').bind(projectId).all<{id:string;name:string}>()
 ])
 return {teams:teams.results,brands:brands.results,agents:agents.results}
}

export async function readTeamReport(env:Env,projectId:string,range:ReportRange,filters:TeamReportFilters,now=Date.now(),accessRole:string|null=null,userId:string|null=null){
 const context={env,projectId,range,filters,now,accessRole,userId}
 const [denominators,workload,backlog,sla,reopens,handleTime,options,breakdowns]=await Promise.all([
  statement(context,`SELECT COUNT(*) cohort,COALESCE(SUM(imported=0),0) native,COALESCE(SUM(imported=1),0) imported,
   (SELECT COUNT(*) FROM candidates WHERE created_at>=?2 AND imported=1 AND ?6=0) excludedImported FROM cohort`).first<{cohort:number;native:number;imported:number;excludedImported:number}>(),
  teamWorkload(context),teamBacklog(context),teamSla(context),teamReopens(context),teamHandleTime(context),reportOptions(context),teamBreakdowns(context)
 ])
 return {range,generatedAt:now,filters,denominators:denominators!,workload,backlog,sla:{...sla,tickets_without_snapshot:denominators!.cohort-(sla.tickets_with_snapshot??0)},reopens,handleTime,options,breakdowns,rules:[
  'The incoming cohort contains conversations created in the selected workspace calendar interval [start, end), with at least one message. Active merge sources are excluded.',
  filters.includeImported?'Imported and legacy conversations are included; native and imported cohort denominators are shown separately.':'Imported and legacy conversations are excluded by default; excludedImported is the number removed from this date cohort.',
  'Team, brand, account, tag, status and workload agent describe current ticket attributes. Account is the requester’s current explicitly linked company, never an email-domain inference; unlinked requesters have a No account bucket. A tagged ticket counts once in each tag; untagged and unassigned tickets have their own buckets.',
  'Resolved workload means currently solved or closed. Backlog is the current nonterminal set created before the selected end, including tickets older than the selected start. Age is wall time at generatedAt; historical backlog is not reconstructed.',
  'SLA uses persisted policy/calendar business-hour snapshots for the date cohort, including every recorded first response, next response and resolution cycle. Met is completed without breach; breached includes overdue active commitments. Rate is met / (met + breached); unexpired pending cycles and tickets without a snapshot are not successes.',
  'SLA snapshot timestamps disclose workflow processing freshness. Reports do not replay workflow events, apply today’s policy to old tickets, or change SLA state.',
  'Reopen rate uses distinct cohort tickets with an observed solved/closed boundary and a subsequent return to an active status in ticket history. Events are all such history transitions over each ticket’s lifetime. Imported history without native status events is reported as unknown.',
  'Handle time sums each recorded session clipped to the selected interval and generatedAt, including work on older matching tickets. Running sessions accrue to generatedAt. Manual duration adjustments are allocated proportionally to the interval overlap; a zero-length adjusted session belongs to its start date. Time is attributed to the session owner; concurrent agents each count their recorded work.',
  'Breakdowns use the incoming cohort and current dimensions. Response and first-resolution distributions publish sample counts, median and nearest-rank p90 in milliseconds; missing or invalid durations are excluded, never zero. CSAT uses the latest cycle response, including reopened cycles; thumbs up or 4–5 is positive. Unrated cycles are excluded from the rate.',
  'AI closed is recorded AI authorship at the current solved/closed boundary, not verified customer recovery or containment. AI handedOff counts tickets with a causal receipt committed with a successful model-requested transfer. Assignment handoffs count tickets with any observed native assignment handoff. Older assignments have no causal receipt and are not inferred to be AI transfers. Failed and uncertain are generation attempts (running is also uncertain), not tickets. Missing outcomes remain unknown. No procedure-version attribution or independently verified resolution is inferred.',
  containmentRule,
  'Customer recovery is the latest explicit customer answer for the latest resolution cycle. Reopened or erased cycles are unknown for current recovery. Recovered / (recovered + not recovered) excludes unknowns. This is customer confirmation, not independent technical verification or an AI closure claim.',
  'Form and intent use current ticket metadata. Intent is the native ticket field named Intent (first readable field id if duplicated), respecting the viewer’s current field role; missing or restricted intent and missing form are shown as unknown. Time before recording began is unknown, not estimated.'
 ]}
}
export type TeamReport=Awaited<ReturnType<typeof readTeamReport>>
