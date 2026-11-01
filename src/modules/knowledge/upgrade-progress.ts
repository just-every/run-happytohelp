import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'

export interface UpgradeProgress {project_id:string;table_name:string;row_key:string;schema_json:string;schema_cursor:number;canonicalised_rows:number;changed_rows:number;lease_token:string;lease_expires_at:number;queued_at:number|null}

export async function claimUpgrade(env:Env,projectId:string){
 const stamp=Date.now(),token=crypto.randomUUID()
 await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_upgrade_progress(project_id,updated_at) SELECT project_id,? FROM knowledge_upgrade_reports WHERE project_id=? AND completed_at IS NULL`).bind(stamp,projectId).run()
 return env.DB.prepare(`UPDATE knowledge_upgrade_progress SET lease_token=?,lease_expires_at=?,queued_at=NULL,updated_at=? WHERE project_id=? AND (lease_token IS NULL OR lease_expires_at<=?) AND EXISTS(SELECT 1 FROM knowledge_upgrade_reports r WHERE r.project_id=knowledge_upgrade_progress.project_id AND r.completed_at IS NULL) RETURNING *`).bind(token,stamp+120000,stamp,projectId,stamp).first<UpgradeProgress>()
}

export async function queueKnowledgeUpgrade(env:Env,projectId:string){
 const stamp=Date.now()
 await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_upgrade_progress(project_id,updated_at) SELECT project_id,? FROM knowledge_upgrade_reports WHERE project_id=? AND completed_at IS NULL`).bind(stamp,projectId).run()
 const admitted=await env.DB.prepare(`UPDATE knowledge_upgrade_progress SET queued_at=? WHERE project_id=? AND (queued_at IS NULL OR queued_at<=?) AND (lease_token IS NULL OR lease_expires_at<=?) AND EXISTS(SELECT 1 FROM knowledge_upgrade_reports r WHERE r.project_id=knowledge_upgrade_progress.project_id AND r.completed_at IS NULL) RETURNING project_id`).bind(stamp,projectId,stamp-120000,stamp).first()
 if(!admitted)return false
 try{await env.JOBS.send({type:'knowledge.upgrade',id:projectId,projectId});return true}
 catch(error){await env.DB.prepare('UPDATE knowledge_upgrade_progress SET queued_at=NULL WHERE project_id=? AND queued_at=?').bind(projectId,stamp).run();throw error}
}

export async function dispatchKnowledgeUpgrades(env:Env,limit=4){
 if(!cronRoom(env,3))return
 const pending=await env.DB.prepare('SELECT project_id FROM knowledge_upgrade_reports WHERE completed_at IS NULL ORDER BY project_id LIMIT ?').bind(limit).all<{project_id:string}>()
 for(const row of pending.results){if(!cronRoom(env,2))break;await queueKnowledgeUpgrade(env,row.project_id)}
}

export async function releaseUpgrade(env:Env,progress:UpgradeProgress,status:string){
 await env.DB.batch([
  env.DB.prepare(`UPDATE knowledge_upgrade_reports SET report_json=json_set(report_json,'$.status',?,'$.cursor',json_object('table',p.table_name,'row',p.row_key),'$.schemaCursor',p.schema_cursor,'$.canonicalisedRows',p.canonicalised_rows,'$.changedRows',p.changed_rows) FROM knowledge_upgrade_progress p WHERE knowledge_upgrade_reports.project_id=p.project_id AND p.project_id=? AND p.lease_token=? AND completed_at IS NULL`).bind(status,progress.project_id,progress.lease_token),
  env.DB.prepare('UPDATE knowledge_upgrade_progress SET lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE project_id=? AND lease_token=?').bind(Date.now(),progress.project_id,progress.lease_token),
 ])
 await queueKnowledgeUpgrade(env,progress.project_id)
}

export async function completeUpgrade(env:Env,progress:UpgradeProgress){
 const stamp=Date.now()
 await env.DB.batch([
  env.DB.prepare(`UPDATE knowledge_upgrade_reports SET completed_at=?,report_json=json_set(report_json,'$.status','completed','$.canonicalisedRows',p.canonicalised_rows,'$.changedRows',p.changed_rows,'$.schemaCursor',p.schema_cursor,'$.cursor',json_object('table',p.table_name,'row',p.row_key)) FROM knowledge_upgrade_progress p WHERE knowledge_upgrade_reports.project_id=p.project_id AND p.project_id=? AND p.lease_token=? AND completed_at IS NULL`).bind(stamp,progress.project_id,progress.lease_token),
  env.DB.prepare('UPDATE knowledge_upgrade_progress SET lease_token=NULL,lease_expires_at=NULL,queued_at=NULL,updated_at=? WHERE project_id=? AND lease_token=?').bind(stamp,progress.project_id,progress.lease_token),
 ])
}
