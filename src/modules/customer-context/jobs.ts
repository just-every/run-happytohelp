import {requireActiveProject,isProjectActive} from '../../platform/project-status'
import type {Env,Job} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
import {analysisInterval} from './collector'
import {admitContextRun} from './run-ceiling'
import {readContextSource,profilePacket,monitoringPacket} from './packets'
// @ts-ignore Retained count/cooldown semantics.
import * as profileCooldown from './profiles/cooldown.js'
// @ts-ignore Preserved evidence-version eligibility.
import * as version from './profiles/version.js'
export const PROFILE_TASKS=['project','agent','contact','optimize','optimizeContact'] as const
export async function enqueueContextJob(env:Env,projectId:string,subjectId:string,kind:string,model:string,visitorMonitoring=false){
 await requireActiveProject(env,projectId)
 if(![...PROFILE_TASKS,'monitoring'].includes(kind as any))throw new Error('Unknown context task')
 if(typeof model!=='string'||!model.trim()||model.length>120)throw new Error('Explicit context model required')
 const source=await readContextSource(env,projectId,subjectId),now=Date.now(),id=crypto.randomUUID()
 if(['monitoring','contact','optimizeContact'].includes(kind)&&(!source.subject.consent||!source.subject.bot_enabled))return {reason:'consent_or_bot_disabled'}
 const packet=kind==='monitoring'?monitoringPacket(source):profilePacket(kind,source)
 if(kind!=='monitoring'&&version.isCurrentProfile(source.saved[kind],packet))return {reason:'unchanged_evidence'}
 if(kind==='optimizeContact'&&!packet.approved_broad_personalization.length)return {reason:'no_public_signals'}
 if(kind!=='monitoring'&&kind!=='optimizeContact'&&!packet.evidence.length&&!packet.trusted_evidence.length)return {reason:'no_eligible_evidence'}
 const payload=JSON.stringify({visitorMonitoring,packet,summaryPacket:source.summaryPacket,context:{project:source.context.project,contact:source.context.contact,agent:source.context.agent,projectOptimize:source.context.projectOptimize},existing:source.saved[kind]||{}})
 const insert=env.DB.prepare(`INSERT INTO context_jobs(id,project_id,subject_id,kind,state,source_revision,packet_json,model,created_at) SELECT ?,?,?,?,'queued',?,?,?,? WHERE EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)) AND EXISTS(SELECT 1 FROM context_subjects WHERE project_id=? AND subject_id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM context_jobs WHERE project_id=? AND subject_id=? AND kind=? AND state IN ('queued','running','uncertain'))`).bind(id,projectId,subjectId,kind,source.subject.revision,payload,model,now,projectId,projectId,subjectId,source.subject.revision,projectId,subjectId,kind)
 let admitted=false
 if(kind==='monitoring'){
  await env.DB.prepare('INSERT INTO context_collectors(project_id,subject_id) VALUES(?,?) ON CONFLICT DO NOTHING').bind(projectId,subjectId).run()
  const collector=await env.DB.prepare('SELECT * FROM context_collectors WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).first<any>()
  // Not yet due waits for more activity; due but blocked by a current or just-finished run is retried by the widget.
  if(collector.actions_count-collector.analysis_actions<analysisInterval(collector.analysis_since_insight))return {reason:'awaiting_activity'}
  if(collector.job_id||collector.last_run_at>now-4000)return {reason:'schedule_gate'}
  // Visitor activity starts monitoring runs on installation keys; the project's daily ceiling bounds them.
  const reservation=await admitContextRun(env,projectId)
  if(!reservation)return {reason:'daily_ceiling'}
  // Conditional job insert and collector ownership are atomic; later consumers never infer a lease from a timestamp alone.
  const statements=[insert,env.DB.prepare(`UPDATE context_collectors SET job_id=?,analysis_actions=actions_count,analysis_count=analysis_count+1,analysis_since_insight=analysis_since_insight+1 WHERE project_id=? AND subject_id=? AND job_id IS NULL AND actions_count-analysis_actions>=? AND (last_run_at IS NULL OR last_run_at<=?) AND EXISTS(SELECT 1 FROM context_jobs WHERE id=?)`).bind(id,projectId,subjectId,analysisInterval(collector.analysis_since_insight),now-4000,id),env.DB.prepare(`DELETE FROM context_jobs WHERE id=? AND NOT EXISTS(SELECT 1 FROM context_collectors WHERE job_id=?)`).bind(id,id)]
  await env.DB.batch(statements);admitted=!!await env.DB.prepare('SELECT id FROM context_jobs WHERE id=?').bind(id).first()
  if(!admitted)await reservation.refund()
 }else{
  await env.DB.prepare('INSERT INTO context_profiles(project_id,subject_id,type) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(projectId,subjectId,kind).run()
  const prior=await env.DB.prepare('SELECT generated_count,started_at FROM context_profiles WHERE project_id=? AND subject_id=? AND type=?').bind(projectId,subjectId,kind).first<any>()
  if(profileCooldown.withinProfileCooldown(prior.started_at,kind,prior.generated_count,now))return {reason:'profile_cooldown'}
  await env.DB.batch([insert,env.DB.prepare(`UPDATE context_profiles SET started_at=?,generated_count=generated_count+1 WHERE project_id=? AND subject_id=? AND type=? AND generated_count=? AND EXISTS(SELECT 1 FROM context_jobs WHERE id=?)`).bind(now,projectId,subjectId,kind,prior.generated_count,id)])
  admitted=!!await env.DB.prepare('SELECT id FROM context_jobs WHERE id=?').bind(id).first()
 }
 if(!admitted)return {reason:'already_running_or_source_changed'}
 // If queue delivery fails, the durable queued record remains recoverable without repeating provider work.
 if(await isProjectActive(env,projectId))await env.JOBS.send({type:'context.run',id,projectId})
 return {id,reason:'queued'}
}
export async function recoverContextJobs(env:Env){
 if(!cronRoom(env,2))return
 const queued=await env.DB.prepare("SELECT id,project_id FROM context_jobs WHERE state='queued' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=context_jobs.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=context_jobs.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY created_at LIMIT 100").all<any>()
 // The scan selects active projects; the queue consumer rechecks before work.
 for(const row of queued.results)await env.JOBS.send({type:'context.run',id:row.id,projectId:row.project_id} satisfies Job)
 // An expired running attempt is uncertain. Never automatically replay it.
 await env.DB.prepare("UPDATE context_jobs SET state='uncertain',error='Interrupted provider attempt; explicit review required',finished_at=? WHERE state='running' AND started_at<?").bind(Date.now(),Date.now()-360000).run()
}
