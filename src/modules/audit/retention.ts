import {RETENTION_LIMITS,DAY,retentionDays,held,auditDueSql} from './retention-due'
export {RETENTION_LIMITS} from './retention-due'
import type {Env} from '../../platform/env'
import {cronConsumer,cronRoom} from '../../platform/cron-budget'
import {scheduledReservations} from '../../platform/scheduled-budget'
import {auditStatement} from './record'

/**
 * Removes security-log rows older than each workspace's retention, never one a legal
 * hold covers. The purge window opens for one workspace and cutoff inside the same
 * batch as the delete, so no other delete can pass the append-only trigger. Each
 * purge records how many rows it removed and how many holds kept.
 */
export async function purgeExpiredAudit(env:Env,now=Date.now(),statementLimit:number=scheduledReservations.audit){
 // The floor is discovery plus one complete purge; settled credit admits more.
 env=cronConsumer(env,statementLimit)
 // The existing purge audit is also a durable turn: a workspace with freshly
 // expiring rows yields to those still waiting. Row order breaks initial ties.
 const projects=(await env.DB.prepare(`SELECT project_id,${retentionDays} days ${auditDueSql('?2','?1')}
 ORDER BY coalesce((SELECT max(turn.at) FROM audit_events turn WHERE turn.project_id=project_settings.project_id AND turn.action='audit.purged'),0),project_settings.rowid LIMIT 50`).bind(RETENTION_LIMITS.min,now).all<{project_id:string;days:number}>()).results
 for(const {project_id:projectId,days} of projects){
  if(!Number.isInteger(days)||days<RETENTION_LIMITS.min)continue
  if(!cronRoom(env,5))break
  const before=now-days*DAY
  const results=await env.DB.batch([
   env.DB.prepare(`SELECT count(*) kept FROM audit_events WHERE project_id=? AND at<? AND ${held}`).bind(projectId,before),
   env.DB.prepare('INSERT INTO audit_purges(project_id,before_at) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET before_at=excluded.before_at').bind(projectId,before),
   env.DB.prepare(`DELETE FROM audit_events WHERE project_id=? AND at<? AND NOT ${held}`).bind(projectId,before),
   env.DB.prepare('DELETE FROM audit_purges WHERE project_id=?').bind(projectId),
  ])
  const removed=results[2].meta.changes,kept=(results[0].results[0] as {kept:number}).kept
  if(removed)await auditStatement(env.DB,{projectId,category:'audit',action:'audit.purged',actor:{type:'system'},source:'system',detail:{removed,keptUnderHold:kept,olderThanDays:days}},now).run()
 }
}
