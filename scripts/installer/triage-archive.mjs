import {outboundArchiveUpgradeRow} from './outbound-archive.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {policy,schemaIdentity} from '@runeditrun/rer/modules/portability/catalogue';
export const triageTables=['triage_settings','triage_jobs','triage_labels','triage_usage'];
export function triageArchiveRow(table,row){
 if(table==='triage_settings')return {...row,routing_enabled:0};
 if(table==='triage_jobs'&&['pending','running'].includes(row.state))return {...row,state:'unavailable',reason:'Archived model work is never replayed',predictions_json:null};
 return row;
}
export const triageRestoreSql="UPDATE triage_settings SET routing_enabled=0; UPDATE triage_jobs SET state='unavailable',reason='Archived model work is never replayed',predictions_json=NULL WHERE state IN ('pending','running');";
export async function triageArchiveStagedSafety({db,tables}){
 const statements=triageRestoreSql.split(';').map(s=>s.trim()).filter(Boolean).flatMap(sql=>{const table=sql.match(/^UPDATE (\w+) /)[1],copy=tables[table];return copy?[db.prepare(sql.replace(/^UPDATE \w+ /,`UPDATE "${copy.replaceAll('"','""')}" `))]:[];});
 if(statements.length)await db.batch(statements);
 return true;
}
export async function beforeTriagePolicy(root,input){
 const result={...input,excludeTables:[...input.excludeTables,...triageTables]},scratch=new DatabaseSync(':memory:');
 const db={prepare(sql){return {bind(...args){this.args=args;return this},async all(){return {results:scratch.prepare(sql).all(...(this.args??[]))}}}}};
 try{
  const names=(await readdir(join(root,'migrations'))).filter(n=>n.endsWith('.sql')&&!/^22[0-9]_/.test(n)).sort(),acceptedSchemas={};
  const remember=async()=>{acceptedSchemas[await schemaIdentity(db,policy(result))]={upgradeRow:outboundArchiveUpgradeRow}};
  for(const name of names){if(name>='230_'&&!Object.keys(acceptedSchemas).length)await remember();for(const sql of unstable_splitSqlQuery(await readFile(join(root,'migrations',name),'utf8')))scratch.exec(sql);if(name>='230_')await remember();}
  await remember();return {...result,acceptedSchemas};
 }finally{scratch.close()}
}
