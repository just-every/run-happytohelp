import {outboundArchiveUpgradeRow} from './outbound-archive.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {policy,schemaIdentity} from '@runeditrun/rer/modules/portability/catalogue';

export const reportTables=['ticket_handle_sessions','report_schedules','report_schedule_recipients','report_schedule_deliveries','ticket_problems','ticket_problem_incidents','ticket_problem_previews','ticket_problem_attempts'];
export function reportArchiveRow(table,row){
 if(table==='report_schedules')return {...row,paused:1};
 if(table==='ticket_handle_sessions'&&row.ended_at===null)return {...row,ended_at:Math.max(row.started_at,Date.now())};
 if(table==='report_schedule_deliveries'&&row.state==='claimed')return {...row,state:'unknown'};
 if(table==='ticket_problem_previews')return {...row,state:row.state==='erased'?'erased':'complete'};
 if(table==='ticket_problem_attempts'&&['claimed','ready','sending'].includes(row.state))return {...row,state:'uncertain',reason:'Archived reply is never replayed'};
 return row;
}
export const reportRestoreSql=`UPDATE report_schedules SET paused=1;
UPDATE ticket_handle_sessions SET ended_at=max(started_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) WHERE ended_at IS NULL;
UPDATE report_schedule_deliveries SET state='unknown' WHERE state='claimed';
UPDATE ticket_problem_previews SET state=CASE WHEN state='erased' THEN state ELSE 'complete' END;
UPDATE ticket_problem_attempts SET state='uncertain',reason='Archived reply is never replayed' WHERE state IN ('claimed','ready','sending');`;
export async function reportArchiveStagedSafety({db,tables}){
 const statements=reportRestoreSql.split(';').map(s=>s.trim()).filter(Boolean).flatMap(sql=>{
  const table=sql.match(/^UPDATE (\w+) /)[1],copy=tables[table];
  return copy?[db.prepare(sql.replace(/^UPDATE \w+ /,`UPDATE "${copy.replaceAll('"','""')}" `))]:[];
 });
 if(statements.length)await db.batch(statements);
 return true;
}
/** R10 only adds stores. Pre-R10 archives retain their complete original
 * schema and rows; the new stores are empty on restore. */
export async function beforeReportPolicy(root,input){
 const result={...input,excludeTables:[...input.excludeTables,...reportTables]},scratch=new DatabaseSync(':memory:');
 const db={prepare(sql){return {bind(...args){this.args=args;return this},async all(){return {results:scratch.prepare(sql).all(...(this.args??[]))}}}}};
 try{
  const names=(await readdir(join(root,'migrations'))).filter(n=>n.endsWith('.sql')&&n<'200_').sort();
  for(const name of names)for(const sql of unstable_splitSqlQuery(await readFile(join(root,'migrations',name),'utf8')))scratch.exec(sql);
  return {...result,acceptedSchemas:{[await schemaIdentity(db,policy(result))]:{upgradeRow:outboundArchiveUpgradeRow}}};
 }finally{scratch.close()}
}
