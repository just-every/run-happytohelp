import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {policy,schemaIdentity,excludedTable} from '@runeditrun/rer/modules/portability/catalogue';

const {changesData}=await import(new URL('./migration-statements.mjs',import.meta.resolve('@runeditrun/rer/modules/portability/migration-history')));
const statuses='[{"id":"new","name":"New"},{"id":"open","name":"Open"},{"id":"pending","name":"Pending"},{"id":"on_hold","name":"On-hold"},{"id":"solved","name":"Solved"},{"id":"closed","name":"Closed"}]';
/** Old archives skipped the ticket backfill. Recognize only schemas produced by
 * this installation's own pre-ticket migrations and supply the new ticket cells.
 * The portability engine still validates every row, checksum and foreign key. */
export async function ticketArchivePolicy(root,input,excludedMigrations=name=>/^1[346][0-9]_/.test(name)||name>='191_'){
 const scratch=new DatabaseSync(':memory:'),config=policy(input),acceptedSchemas={...input.acceptedSchemas};
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:scratch.prepare(sql).all(...(this.args??[]))};}};}};
 try{
  // v0.4.2, the last pre-ticket release, ends at 190; every later migration
  // (191's ticket_history index onward) only ever runs after the ticket model.
  // R7b's reserved 172–174 numbers also landed after that release.
  const names=(await readdir(join(root,'migrations'))).filter(name=>name.endsWith('.sql')&&!excludedMigrations(name)&&!/^17[234]_/.test(name)).sort();
  const plan=await Promise.all(names.map(async name=>unstable_splitSqlQuery(await readFile(join(root,'migrations',name),'utf8'))));
  for(let index=0;index<plan.length;index++){
   for(const sql of plan[index])scratch.exec(sql);
   const tables=scratch.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name).filter(name=>!excludedTable(name,input)&&!(input.derivedTables??[]).some(derived=>name===derived||name.startsWith(derived+'_')));
   // Retain Base's refusal of unrelated missing data migrations. Only the R3
   // backfill is accounted for by this pure row upgrade.
   if(plan.slice(index+1).some(statements=>statements.some(sql=>changesData(sql,tables))))continue;
   acceptedSchemas[await schemaIdentity(db,config)]={upgradeRow(table,row){
    if(table==='conversations'&&row.status_id===undefined){
     const category=row.resolved_at!==null?'solved':row.revision>0?'open':'new';
     return {...row,status_id:category,status_category:category,subject:'',priority:'normal',channel:'widget',brand_id:row.project_id,group_id:null,requester_id:row.contact_id,submitter_id:row.contact_id,submitter_type:'contact',ticket_version:0,ticket_actor_id:null,ticket_actor_type:'system',ticket_source:'rer',mailbox_id:null};
    }
    if(table==='contact_erasures'&&row.ticket_records===undefined)return {...row,ticket_records:0};
    // 146: an archived participant has no record of how it joined, so it stays unproven.
    if(table==='conversation_participants'&&row.joined_via===undefined)return {...row,joined_via:'cc_header'};
    return row;
   }};
  }
  return {...input,acceptedSchemas};
 }finally{scratch.close();}
}

/** Trigger-free restore leaves newly introduced default status rows empty.
 * Existing archives already carry these definitions and remain byte-identical. */
export const ticketRestoreSql=`INSERT OR IGNORE INTO ticket_statuses(project_id,id,name,category,is_default,active,updated_at) SELECT p.id,json_extract(s.value,'$.id'),json_extract(s.value,'$.name'),json_extract(s.value,'$.id'),1,1,p.created_at FROM projects p CROSS JOIN json_each('${statuses}') s;
UPDATE conversations SET channel='email' WHERE ticket_source='rer' AND ticket_version=0 AND EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=conversations.project_id AND e.conversation_id=conversations.id);`;
