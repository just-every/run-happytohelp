// Durable command identities survive restore; no pending external action does.
// A claimed send may already have reached its provider, so keep it uncertain.
export function workflowArchiveRow(table,row){
 if(table==='workflow_events'&&row.state==='pending')return {...row,state:'cancelled',error:'Cancelled by archive restore',lease_token:null,lease_until:null,next_attempt_at:null};
 if(table==='workflow_runs')return {...row,lease_token:null,lease_until:null,state:row.state==='running'?'uncertain':row.state==='pending'?'cancelled':row.state};
 if(table==='workflow_notifications'&&['pending','sending'].includes(row.state))return {...row,state:row.state==='sending'?'uncertain':'cancelled',detail:'Archived action is never replayed'};
 if(table==='sla_alerts'&&['pending','sending'].includes(row.notification_state))return {...row,notification_state:row.notification_state==='sending'?'uncertain':'failed',notification_error:'Archived alert notification is never replayed'};
 if(table==='workflow_schedules'&&['pending','sending'].includes(row.state))return {...row,state:row.state==='sending'?'uncertain':'cancelled'};
 return row;
}
// Also fence older/unmodified archives at import. This runs before rer import
// completes and before an application can process restored work.
export const workflowRestoreSql=`
DELETE FROM workflow_clock;
UPDATE workflow_events SET state='cancelled',error='Cancelled by archive restore',lease_token=NULL,lease_until=NULL,next_attempt_at=NULL WHERE state='pending';
UPDATE workflow_runs SET lease_token=NULL,lease_until=NULL,state=CASE WHEN state='running' THEN 'uncertain' WHEN state='pending' THEN 'cancelled' ELSE state END;
UPDATE workflow_notifications SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'cancelled' END,detail='Archived action is never replayed' WHERE state IN ('pending','sending');
UPDATE sla_alerts SET notification_state=CASE WHEN notification_state='sending' THEN 'uncertain' ELSE 'failed' END,notification_error='Archived alert notification is never replayed' WHERE notification_state IN ('pending','sending');
UPDATE workflow_schedules SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'cancelled' END WHERE state IN ('pending','sending');`;

/** Base has verified the archive digest before calling this hook. Fence staged
 * copies before its atomic commit, so an interrupted importer cannot expose a
 * restored queued action to a running worker. Copies have no business triggers. */
export async function workflowArchiveStagedSafety({db,tables}){
 const statements=workflowRestoreSql.split(';').map(sql=>sql.trim()).filter(sql=>sql.startsWith('UPDATE ')).flatMap(sql=>{
  const table=sql.match(/^UPDATE (\w+) /)[1],copy=tables[table];
  return copy?[db.prepare(sql.replace(/^UPDATE \w+ /,`UPDATE "${copy.replaceAll('"','""')}" `))]:[];
 });
 if(statements.length)await db.batch(statements);
 return true;
}
