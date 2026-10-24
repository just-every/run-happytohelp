// Restored commands retain their identity, data and observed usage. Execution
// permission does not travel: even a newly configured provider cannot replay
// the source installation's queued or interrupted work.
const error='Archived work is never replayed';
export function asyncWorkArchiveRow(table,row){
 if(table==='widget_campaigns')return {...row,config_json:JSON.stringify({...JSON.parse(row.config_json),enabled:false})};
 if(table==='ai_generations'&&['queued','running'].includes(row.state))return {...row,state:row.state==='running'?'uncertain':'cancelled',error};
 if(table==='ai_attempts'&&row.state==='running')return {...row,state:'uncertain',error};
 if(table==='context_jobs'&&['queued','running'].includes(row.state))return {...row,state:row.state==='running'?'uncertain':'superseded',error};
 if(['brand_generations','lead_jobs'].includes(table)&&['queued','running'].includes(row.state))return {...row,state:row.state==='running'?'uncertain':'failed',error};
 if(table==='ticket_batch_jobs')return {...row,authority_json:'{}',state:row.state==='pending'?'failed':row.state};
 if(table==='knowledge_imports'&&['queued','processing'].includes(row.status))return {...row,status:'failed',processing_started_at:null,error};
 if(table==='billing_accounts')return {...row,auto_top_up:0};
 if(table==='billing_operations'&&['pending','running','sending'].includes(row.state))return {...row,state:'uncertain',error};
 if(table==='leads'&&row.status==='processing')return {...row,status:'failed',error};
 if(table==='knowledge_datasets')return {...row,refresh_mode:'manual',next_refresh_at:null,claim_token:null,...(['ingesting','crawling','processing'].includes(row.status)?{status:row.published_version?'ready':'failed',error}:{})};
 if(table==='project_settings'){
  const settings=JSON.parse(row.settings_json||'{}'),read=settings.site_read;
  if(['queued','running'].includes(read?.state))return {...row,settings_json:JSON.stringify({...settings,site_read:{...read,state:read.state==='running'?'uncertain':'failed',reason:'archive_restore'}})};
 }
 return row;
}
export const asyncWorkRestoreSql=`
UPDATE widget_campaigns SET config_json=json_set(config_json,'$.enabled',json('false'));
UPDATE ai_generations SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'cancelled' END,error='Archived work is never replayed' WHERE state IN ('queued','running');
UPDATE ai_attempts SET state='uncertain',error='Archived work is never replayed' WHERE state='running';
UPDATE context_jobs SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'superseded' END,error='Archived work is never replayed' WHERE state IN ('queued','running');
UPDATE brand_generations SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'failed' END,error='Archived work is never replayed' WHERE state IN ('queued','running');
UPDATE lead_jobs SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'failed' END,error='Archived work is never replayed' WHERE state IN ('queued','running');
UPDATE ticket_batch_jobs SET authority_json='{}',state=CASE WHEN state='pending' THEN 'failed' ELSE state END;
UPDATE knowledge_imports SET status='failed',processing_started_at=NULL,error='Archived work is never replayed' WHERE status IN ('queued','processing');
UPDATE billing_accounts SET auto_top_up=0;
UPDATE billing_operations SET state='uncertain',error='Archived work is never replayed' WHERE state IN ('pending','running','sending');
UPDATE leads SET status='failed',error='Archived work is never replayed' WHERE status='processing';
UPDATE knowledge_datasets SET refresh_mode='manual',next_refresh_at=NULL,claim_token=NULL,status=CASE WHEN status IN ('ingesting','crawling','processing') THEN CASE WHEN published_version IS NOT NULL THEN 'ready' ELSE 'failed' END ELSE status END,error=CASE WHEN status IN ('ingesting','crawling','processing') THEN 'Archived work is never replayed' ELSE error END;
UPDATE project_settings SET settings_json=json_set(settings_json,'$.site_read.state',CASE WHEN json_extract(settings_json,'$.site_read.state')='running' THEN 'uncertain' ELSE 'failed' END,'$.site_read.reason','archive_restore') WHERE json_extract(settings_json,'$.site_read.state') IN ('queued','running');`;

export async function asyncWorkArchiveStagedSafety({db,tables}){
 const statements=asyncWorkRestoreSql.split(';').map(sql=>sql.trim()).filter(Boolean).flatMap(sql=>{
  const table=sql.match(/^UPDATE (\w+) /)[1],copy=tables[table];
  return copy?[db.prepare(sql.replace(/^UPDATE \w+ /,`UPDATE "${copy.replaceAll('"','""')}" `))]:[];
 });
 if(statements.length)await db.batch(statements);
 return true;
}
