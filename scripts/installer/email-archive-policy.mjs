import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {policy,schemaIdentity,excludedTable} from '@runeditrun/rer/modules/portability/catalogue';
import {archivePolicy} from './portability-policy.mjs';
import {emailArchiveTables} from './email-archive-tables.mjs';

// This explicit transition admits native archives from before R6. It never
// executes archive-provided code, skips unrelated data migrations or invents
// provider credentials. Their new mailbox column has the declared null default.
const input={...archivePolicy,excludeTables:[...new Set([...archivePolicy.excludeTables,...emailArchiveTables])]};
const {changesData}=await import(new URL('./migration-statements.mjs',import.meta.resolve('@runeditrun/rer/modules/portability/migration-history')));
const scratch=new DatabaseSync(':memory:'),config=policy(input),acceptedSchemas={};
const db={prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:scratch.prepare(sql).all(...(this.args??[]))};}};}};
try{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const names=(await readdir(join(root,'migrations'))).filter(name=>name.endsWith('.sql')&&!/^16[0-9]_/.test(name)).sort();
 const plan=await Promise.all(names.map(async name=>unstable_splitSqlQuery(await readFile(join(root,'migrations',name),'utf8'))));
 for(let index=0;index<plan.length;index++){
  for(const sql of plan[index])scratch.exec(sql);
  const tables=scratch.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name).filter(name=>!excludedTable(name,input)&&!(input.derivedTables??[]).some(derived=>name===derived||name.startsWith(derived+'_')));
  if(plan.slice(index+1).some(statements=>statements.some(sql=>changesData(sql,tables))))continue;
  acceptedSchemas[await schemaIdentity(db,config)]={upgradeRow(table,row){return table==='conversations'?{...row,mailbox_id:null}:row;}};
 }
}finally{scratch.close();}
export default {...input,acceptedSchemas};
