import {requireActiveProject} from '../../platform/project-status';
import type {Env} from '../../platform/env';
import {cronRoom} from '../../platform/cron-budget';
export async function recoverInterruptedTraining(env:Env,runId:string){
 const expired=await env.DB.prepare("UPDATE training_cases SET status='uncertain',error='Attempt lease expired; outcome and cost require inspection. Never replay automatically.',completed_at=? WHERE run_id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<?) RETURNING id").bind(Date.now(),runId,Date.now()).all();
 if(expired.results.length)await env.DB.prepare("UPDATE training_runs SET status='uncertain',completed_at=? WHERE id=? AND status IN ('queued','running')").bind(Date.now(),runId).run();
 return expired.results.length;
}
export async function finishTrainingPlanning(env:Env,run:any):Promise<boolean>{
 if(!cronRoom(env,1))return false
 const current=await env.DB.prepare('SELECT project_id FROM training_runs WHERE id=?').bind(run.id).first<{project_id:string}>()
 if(!current)throw new Error('Training run not found')
 for(;;){
  // Each page reserves its authority check, missing-case read and completion
  // write. Smaller remaining shares still advance a large persisted plan.
  let size=50
  while(size>0&&!cronRoom(env,3+size))size--
  if(!size)return false
  await requireActiveProject(env,current.project_id)
  const missing=await env.DB.prepare(`SELECT json_extract(p.value,'$.id') id,json_extract(p.value,'$.model') model,
   json_extract(p.value,'$.variant') variant,json_extract(p.value,'$.definition') definition
   FROM training_runs r,json_each(r.config,'$.plan') p WHERE r.id=? AND r.status='planning'
   AND NOT EXISTS(SELECT 1 FROM training_cases c WHERE c.id=json_extract(p.value,'$.id') AND c.run_id=r.id)
   ORDER BY CAST(p.key AS INTEGER) LIMIT ?`).bind(run.id,size).all<{id:string;model:string;variant:string;definition:string}>()
  const inserted=missing.results.length?await env.DB.batch(missing.results.map(row=>{
   const definition=JSON.parse(row.definition)
   return env.DB.prepare('INSERT OR IGNORE INTO training_cases(id,run_id,case_id,model,variant,definition) VALUES(?,?,?,?,?,?)')
    .bind(row.id,run.id,definition.id,row.model,row.variant,row.definition)
  })):[]
  const completed=await env.DB.prepare("UPDATE training_runs SET status='queued' WHERE id=? AND status='planning' AND case_count=(SELECT COUNT(*) FROM training_cases WHERE run_id=?)").bind(run.id,run.id).run()
  if(completed.meta.changes)return true
  if(!missing.results.length)return false
  // An invalid/conflicting retained plan must not spin forever outside cron.
  if(!inserted.some(result=>result.meta.changes))return false
 }
}
/** Preserve unresolved provider attempts when their project is deleted. */
async function stopDeletedTraining(env:Env){
 await env.DB.batch([
  env.DB.prepare("UPDATE training_cases SET status='uncertain',error='Project deleted; started attempt requires inspection',completed_at=? WHERE status='running' AND EXISTS(SELECT 1 FROM training_runs r JOIN project_settings ps ON ps.project_id=r.project_id WHERE r.id=training_cases.run_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(Date.now()),
  env.DB.prepare("UPDATE training_runs SET status='uncertain',completed_at=? WHERE status='running' AND EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=training_runs.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(Date.now()),
 ]);
}
/** Scheduled recovery repairs interrupted planning and queue dispatch; paid calls never replay. */
export async function recoverTrainingRuns(env:Env){
 if(!cronRoom(env,3))return
 await stopDeletedTraining(env)
 const rows=await env.DB.prepare("SELECT * FROM training_runs WHERE status IN ('planning','queued','running') AND EXISTS(SELECT 1 FROM projects p WHERE p.id=training_runs.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=training_runs.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY created_at LIMIT 100").all()
 for(const run of rows.results as any[]){
  if(run.status==='planning'){
   if(await finishTrainingPlanning(env,run))await env.JOBS.send({type:'training',id:run.id,projectId:run.project_id})
  }else if(run.status==='queued'){
   // The active-project scan and queue consumer fence this redispatch.
   await env.JOBS.send({type:'training',id:run.id,projectId:run.project_id})
  }else{
   if(!cronRoom(env,2))continue
   const expired=await recoverInterruptedTraining(env,run.id)
   if(!expired&&await env.DB.prepare("SELECT id FROM training_cases WHERE run_id=? AND status='queued' LIMIT 1").bind(run.id).first())await env.JOBS.send({type:'training',id:run.id,projectId:run.project_id})
  }
 }
}
