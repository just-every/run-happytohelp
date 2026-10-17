import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {policy,schemaIdentity,excludedTable} from '@runeditrun/rer/modules/portability/catalogue';
const {changesData}=await import(new URL('./migration-statements.mjs',import.meta.resolve('@runeditrun/rer/modules/portability/migration-history')));

export const workflowTables=['workflow_events','workflow_event_sequence','workflow_clock','ticket_followups','workflow_calendars','sla_policies','ticket_sla_state','sla_alerts','sla_scheduler_cursors','workflow_rules','workflow_rule_versions','workflow_runs','workflow_action_receipts','workflow_notifications','workflow_time_state','workflow_scheduler_cursors','routing_operators','routing_state','routing_decisions','workflow_schedules'];
export const ticketTables=['ticket_statuses','ticket_groups','ticket_group_members','ticket_fields','ticket_field_values','ticket_history','ticket_views'];

// The exact R3 row transition remains supported, including old erasure receipts.
// No invented customer data: these are the cells migration 130/132 introduced.
export function workflowArchiveUpgradeRow(table,row){
 if(table==='conversations'&&row.status_id===undefined){
  const category=row.resolved_at!==null?'solved':row.revision>0?'open':'new';
  return {...row,status_id:category,status_category:category,subject:'',priority:'normal',channel:'widget',brand_id:row.project_id,group_id:null,requester_id:row.contact_id,submitter_id:row.contact_id,submitter_type:'contact',ticket_version:0,ticket_actor_id:null,ticket_actor_type:'system',ticket_source:'rer'};
 }
 if(table==='contact_erasures'&&row.ticket_records===undefined)return {...row,ticket_records:0};
 return row;
}

/** Enumerate only installation-produced schemas before R5, with or without
 * R3's ticket migrations. Later independent migrations still form part of each
 * historical schema. Never apply 150-159 while constructing that inventory. */
export async function workflowArchivePolicy(root,input,{beforeTickets=false}={}){
 const omitted=[...workflowTables,...(beforeTickets?ticketTables:[])];
 const result={...input,excludeTables:[...new Set([...input.excludeTables,...omitted])],replaceableTables:input.replaceableTables.filter(table=>!omitted.includes(table))},config=policy(result);
 const scratch=new DatabaseSync(':memory:'),acceptedSchemas={...input.acceptedSchemas};
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:scratch.prepare(sql).all(...(this.args??[]))};}};}};
 try{
  const names=(await readdir(join(root,'migrations'))).filter(name=>name.endsWith('.sql')&&!/^15[0-9]_/.test(name)&&(!beforeTickets||!/^13[0-9]_/.test(name))).sort();
  const plan=await Promise.all(names.map(async name=>unstable_splitSqlQuery(await readFile(join(root,'migrations',name),'utf8'))));
  for(let index=0;index<plan.length;index++){
   for(const sql of plan[index])scratch.exec(sql);
   const tables=scratch.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name).filter(name=>!excludedTable(name,result)&&!(result.derivedTables??[]).some(derived=>name===derived||name.startsWith(derived+'_')));
   // Retain Base's refusal of unrelated skipped data migrations. Only the
   // explicitly supported ticket backfill above is allowed to upgrade rows.
   if(plan.slice(index+1).some(statements=>statements.some(sql=>changesData(sql,tables))))continue;
   acceptedSchemas[await schemaIdentity(db,config)]={upgradeRow:workflowArchiveUpgradeRow};
  }
  return {...result,acceptedSchemas};
 }finally{scratch.close();}
}
