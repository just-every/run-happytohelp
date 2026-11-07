import {identifier} from './mysql.mjs';
import {directTables,childScopes,morphTables,supportEventTypes,skippedTables} from './scope.mjs';

/** Subqueries keep tenant boundaries in SQL, independent of project size. */
export function projectQueries(schema,projectId,authorIds) {
  const scopes=new Map([['projects',{where:'id=?',args:[projectId]}]]);
  for(const table of directTables.filter(t=>t!=='projects'))if(schema.has(table))scopes.set(table,{where:'project_id=?',args:[projectId]});
  const ids=table=>{const scope=scopes.get(table);return {sql:`SELECT id FROM ${identifier(table)} WHERE ${scope.where}`,args:scope.args};};
  for(const [table,[foreign,parent]] of Object.entries(childScopes))if(schema.has(table)&&scopes.has(parent)){
    const p=ids(parent);let where=`${identifier(foreign)} IN (${p.sql})`,args=[...p.args];
    // Scan events once against materialized conversation ids. The default plan probes
    // events per conversation: ~5.5M random reads for a production-sized project, which never finished.
    if(table==='events'){where=`${identifier(foreign)} IN (${p.sql.replace(/^SELECT /,'SELECT /*+ NO_SEMIJOIN() SUBQUERY(MATERIALIZATION) */ ')}) AND type IN (${supportEventTypes.map(()=>'?').join(',')})`;args.push(...supportEventTypes);}
    scopes.set(table,{where,args});
  }
  // Include only project devices/grants and exact dependencies of scoped jobs.
  if(schema.has('local_agent_devices')){
    const d=scopes.has('support_delegations')?ids('support_delegations'):{sql:'SELECT NULL',args:[]};scopes.set('local_agent_devices',{where:`project_id=? OR id IN (SELECT local_agent_device_id FROM support_delegations WHERE id IN (${d.sql})) OR id IN (SELECT local_agent_device_id FROM local_agent_device_project_settings WHERE project_id=?)`,args:[projectId,...d.args,projectId]});
  }
  if(schema.has('local_agent_grants')){
    const d=ids('local_agent_devices');scopes.set('local_agent_grants',{where:`project_id=? OR id IN (SELECT local_agent_grant_id FROM local_agent_devices WHERE id IN (${d.sql}))`,args:[projectId,...d.args]});
  }
  if(schema.has('articles')&&schema.has('categories')){const a=ids('articles'),c=ids('categories');scopes.set('article_categories',{where:`article_id IN (${a.sql}) AND category_id IN (${c.sql})`,args:[...a.args,...c.args]});}
  const fields=new Set(['user_id','agent_id','operator_id','invited_by_id','created_by_id','created_by_user_id','modified_by_id']);
  const refs=[],args=[];
  for(const [table,scope]of scopes)for(const {col}of schema.get(table)?.columns||[])if(fields.has(col)){refs.push(`SELECT DISTINCT ${identifier(col)} FROM ${identifier(table)} WHERE ${scope.where}`);args.push(...scope.args);}
  if(schema.has('ais')){const ai=ids('ais');refs.push(ai.sql);args.push(...ai.args);}
  if(schema.has('users'))scopes.set('users',authorIds?{where:authorIds.length?`id IN (${authorIds.map(()=>'?').join(',')})`:'FALSE',args:authorIds}:{where:refs.length?`id IN (${refs.join(' UNION ')})`:'FALSE',args});
  if(schema.has('ai_defaults')&&schema.has('ais'))scopes.set('ai_defaults',{where:'type IN (SELECT type FROM ais WHERE project_id=?)',args:[projectId]});
  const morphs=[],margs=[];
  for(const [name,table]of Object.entries(morphTables))if(scopes.has(table)){const p=ids(table);morphs.push(`(mediable_type=? AND mediable_id IN (${p.sql}))`);margs.push(`App\\Models\\${name}`,...p.args);}
  if(schema.has('mediables'))scopes.set('mediables',{where:morphs.join(' OR ')||'FALSE',args:margs});
  if(schema.has('media')&&scopes.has('mediables')){const m=scopes.get('mediables'),select=`SELECT media_id FROM mediables WHERE ${m.where}`;scopes.set('media',{where:`id IN (${select}) OR original_media_id IN (${select})`,args:[...m.args,...m.args]});}
  const unknown=[...schema.keys()].filter(t=>!scopes.has(t)&&!skippedTables.includes(t));
  if(unknown.length)throw Error(`Unclassified legacy tables; add an explicit scope or drop decision: ${unknown.join(', ')}`);
  return scopes;
}
