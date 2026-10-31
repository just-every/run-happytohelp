import {isProjectActive,requireActiveProject} from '../../platform/project-status';
import {recoverInterruptedTraining} from './recovery';
import type { Env } from '../../platform/env';
import type { TrainingExecutor } from './contracts';
import {evaluateTrainingCase} from './evaluate';
import {referenceResult} from '../knowledge/result-fields';
import {canonicaliseFields} from '../knowledge/canonicaliser';
/** One durable case attempt. A queue redelivery never replays a started provider call. */
export async function executeTrainingRun(env:Env,runId:string,execute:TrainingExecutor){
 if(await recoverInterruptedTraining(env,runId))return;
 const run:any=await env.DB.prepare("SELECT * FROM training_runs WHERE id=? AND status IN ('queued','running')").bind(runId).first();if(!run)return;
 if(!await isProjectActive(env,run.project_id)){await env.DB.batch([env.DB.prepare("UPDATE training_cases SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'cancelled' END,error='Project deleted; started attempts require inspection' WHERE run_id=? AND status IN ('queued','running')").bind(runId),env.DB.prepare("UPDATE training_runs SET status=CASE WHEN reserved_cost>0 THEN 'uncertain' ELSE 'cancelled' END,completed_at=? WHERE id=?").bind(Date.now(),runId)]);return;}
 await env.DB.prepare("UPDATE training_runs SET status='running' WHERE id=? AND status='queued'").bind(runId).run();
 const perCase=run.max_cost/run.case_count;
 const cases=await env.DB.prepare("SELECT * FROM training_cases WHERE run_id=? AND status='queued' ORDER BY id LIMIT 10").bind(runId).all();
 for(const row of cases.results as any[]){
  if(!await isProjectActive(env,run.project_id))break;
  const attempt=crypto.randomUUID();
  await env.DB.batch([env.DB.prepare("UPDATE training_cases SET status='running',attempt_id=?,started_at=?,lease_expires_at=? WHERE id=? AND status='queued' AND EXISTS(SELECT 1 FROM training_runs WHERE id=? AND status='running' AND spent_cost+reserved_cost+?<=max_cost AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=training_runs.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))").bind(attempt,Date.now(),Date.now()+900000,row.id,runId,perCase),env.DB.prepare('UPDATE training_runs SET reserved_cost=reserved_cost+? WHERE id=? AND EXISTS(SELECT 1 FROM training_cases WHERE id=? AND attempt_id=?)').bind(perCase,runId,row.id,attempt)]);
  const admitted=await env.DB.prepare('SELECT id FROM training_cases WHERE id=? AND attempt_id=?').bind(row.id,attempt).first();if(!admitted)continue;
  try{
   await requireActiveProject(env,run.project_id);
   const selected=JSON.parse(run.config).models,secondary=JSON.parse(row.definition).insightModel;
   if(!Array.isArray(selected)||!selected.includes(row.model)||(secondary&&!selected.includes(secondary)))throw new Error('Training model is outside the run selection');
   const result=await execute(env,{projectId:run.project_id,model:row.model,variant:row.variant,caseDefinition:JSON.parse(row.definition),maxTokens:run.max_tokens,maxCost:perCase,attemptId:attempt});
   const stillActive=await isProjectActive(env,run.project_id);const cost=result.usage?.cost,known=typeof cost==='number'&&Number.isFinite(cost)&&cost>=0;
   // Checks consume typed model results before narrative storage changes shape.
   const checks=await referenceResult(env,run.project_id,'training:'+attempt,evaluateTrainingCase(JSON.parse(row.definition),result,row.variant),'training',JSON.parse(row.definition).type);
   const artifact=await referenceResult(env,run.project_id,'training:'+attempt,{attemptId:attempt,definition:JSON.parse(row.definition),...result},'training',JSON.parse(row.definition).type);
   const key='training/'+run.project_id+'/'+runId+'/'+row.id+'/'+attempt+'.json';await env.FILES.put(key,JSON.stringify(await canonicaliseFields(env,run.project_id,artifact)),{httpMetadata:{contentType:'application/json'}});
   await env.DB.batch([env.DB.prepare("UPDATE training_cases SET status=?,output_key=?,checks=?,usage=?,error=?,completed_at=? WHERE id=? AND attempt_id=?").bind(known&&stillActive?'completed':'uncertain',key,JSON.stringify(checks),JSON.stringify(result.usage),!stillActive?'Project deleted; started attempt requires inspection':!known?'Provider cost was not reported. Outcome and cost require inspection; this attempt will not be replayed automatically.':null,Date.now(),row.id,attempt),env.DB.prepare('UPDATE training_runs SET spent_cost=spent_cost+?,reserved_cost=reserved_cost-?,status=CASE WHEN ? THEN status ELSE \'uncertain\' END WHERE id=?').bind(known?cost:0,known?perCase:0,known&&stillActive?1:0,runId)]);
   if(!known||!stillActive)break;
  }catch(error){const failure=await referenceResult(env,run.project_id,'training:'+attempt,error instanceof Error?error.message:String(error),'trace');await env.DB.batch([env.DB.prepare("UPDATE training_cases SET status='uncertain',error=?,completed_at=? WHERE id=? AND attempt_id=?").bind(failure,Date.now(),row.id,attempt),env.DB.prepare("UPDATE training_runs SET status='uncertain' WHERE id=?").bind(runId)]);break;}
 }
 const remaining:any=await env.DB.prepare("SELECT COUNT(*) n FROM training_cases WHERE run_id=? AND status!='completed'").bind(runId).first();if(!remaining.n)await env.DB.prepare("UPDATE training_runs SET status='completed',completed_at=? WHERE id=? AND status='running'").bind(Date.now(),runId).run();else{const state:any=await env.DB.prepare('SELECT status FROM training_runs WHERE id=?').bind(runId).first();const pending:any=await env.DB.prepare("SELECT COUNT(*) n FROM training_cases WHERE run_id=? AND status='queued'").bind(runId).first();if(state.status==='running'&&pending.n){const budget:any=await env.DB.prepare('SELECT spent_cost,reserved_cost,max_cost FROM training_runs WHERE id=?').bind(runId).first();if(budget.spent_cost+budget.reserved_cost+perCase>budget.max_cost){await env.DB.prepare("UPDATE training_runs SET status='budget_exhausted' WHERE id=? AND status='running'").bind(runId).run();return;}}if(state.status==='running'&&pending.n&&await isProjectActive(env,run.project_id))await env.JOBS.send({type:'training',id:runId,projectId:run.project_id});}
}
