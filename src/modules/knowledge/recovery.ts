import {isProjectActive} from '../../platform/project-status'
import type {Env,Job} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
const staleAfter=20*60*1000

/** Queue acknowledgement is not the durable stage. A failed send leaves that stage recoverable. */
export async function dispatchKnowledgeJob(env:Env,job:Job,delaySeconds?:number){
 if(!cronRoom(env,2))return false
 if(!await isProjectActive(env,job.projectId))return false;
 try{await env.JOBS.send(job,delaySeconds===undefined?undefined:{delaySeconds});return true}
 catch(error){
  const message=`Queue dispatch pending: ${String(error).slice(0,800)}`
  if(job.type==='knowledge.import')await env.DB.prepare("UPDATE knowledge_imports SET error=? WHERE id=? AND project_id=? AND cursor=? AND status='queued'").bind(message,job.id,job.projectId,job.cursor).run()
  else await env.DB.prepare("UPDATE knowledge_datasets SET error=? WHERE id=? AND project_id=? AND claim_token=? AND status IN ('ingesting','crawling')").bind(message,job.datasetId,job.projectId,job.id).run()
  return false
 }
}

/** Redispatch only stages whose provider work has not started, or a persisted crawl's read-only poll. */
export async function recoverKnowledgeJobs(env:Env){
 if(!cronRoom(env,4))return
 const cutoff=Date.now()-staleAfter
 await env.DB.prepare("UPDATE knowledge_datasets SET status='failed',error='Interrupted ingestion; provider outcome may be uncertain. Inspect before explicit refresh; never automatically replay.',claim_token=NULL,next_refresh_at=NULL WHERE status='processing' AND (ingest_started_at IS NULL OR ingest_started_at<?)").bind(cutoff).run()
 await env.DB.prepare("UPDATE knowledge_imports SET status='failed',error='Interrupted import page; retained cursor requires explicit inspection',processing_started_at=NULL WHERE status='processing' AND (processing_started_at IS NULL OR processing_started_at<?)").bind(cutoff).run()
 const datasets=await env.DB.prepare("SELECT id,project_id,claim_token,status,ingest_cursor FROM knowledge_datasets WHERE claim_token IS NOT NULL AND status IN ('ingesting','crawling') AND EXISTS(SELECT 1 FROM projects p WHERE p.id=knowledge_datasets.project_id AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)) LIMIT 100").all<any>()
 for(const row of datasets.results){
  if(!cronRoom(env,4))break
  if(!await isProjectActive(env,row.project_id))continue;
  const job:Job={type:'knowledge.ingest',id:row.claim_token,projectId:row.project_id,datasetId:row.id}
  let retained
  if(row.status==='crawling'){
   retained=await env.FILES.get(`knowledge/crawl/${job.id}.json`)
   if(retained){const receipt=await retained.json<{runId:string}>();if(receipt.runId){job.type='knowledge.crawl-poll';job.runId=receipt.runId}else retained=null}
  }else if(row.ingest_cursor>=0){job.type='knowledge.page';job.cursor=row.ingest_cursor;retained=await env.FILES.get(`knowledge/pages/${job.id}/manifest.json`)}
  else retained=await env.FILES.get(`knowledge/jobs/${job.id}.json`)
  if(!retained){await env.DB.prepare("UPDATE knowledge_datasets SET status='failed',error='Persisted stage input missing; inspect before explicit refresh',claim_token=NULL,next_refresh_at=NULL WHERE id=? AND claim_token=? AND status=? AND ingest_cursor=?").bind(row.id,job.id,row.status,row.ingest_cursor).run();continue}
  await dispatchKnowledgeJob(env,job,row.status==='crawling'?60:undefined)
 }
 const imports=await env.DB.prepare("SELECT id,project_id,cursor FROM knowledge_imports WHERE status='queued' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=knowledge_imports.project_id AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)) LIMIT 100").all<any>()
 for(const row of imports.results){
  if(!cronRoom(env,3))break
  if(!await isProjectActive(env,row.project_id))continue;
  if(!await env.FILES.get(`knowledge/imports/${row.id}/${row.cursor}.json`)){await env.DB.prepare("UPDATE knowledge_imports SET status='failed',error='Persisted import cursor missing' WHERE id=? AND cursor=? AND status='queued'").bind(row.id,row.cursor).run();continue}
  await dispatchKnowledgeJob(env,{type:'knowledge.import',id:row.id,projectId:row.project_id,cursor:row.cursor})
 }
}
