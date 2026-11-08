import assert from 'node:assert/strict';
import {derivedSearchIndexes} from '../../scripts/installer/search-index-sql.mjs';

// Keep physical FTS pages in raw snapshots. Their segment/merge layout is not
// business state; validate each actual index against its external content rows.
const shadowRows=new WeakSet();
export const isSearchShadow=rows=>Array.isArray(rows)&&shadowRows.has(rows);
const definitionSql=table=>`SELECT sql FROM sqlite_master WHERE name='${table}' AND type='table'`;
// rank=1 checks missing/stale terms and rowids against the content too,
// rather than merely checking the index's internal B-tree consistency.
const integritySql=table=>`INSERT INTO ${table}(${table},rank) VALUES('integrity-check',1)`;
const shadowsOf=(tables,table)=>tables.filter(row=>row.schema==='main'&&row.type==='shadow'&&row.name.startsWith(table+'_')).map(row=>row.name);
export function validateSearchIndex(native){
 const shadows=[];
 for(const {table} of derivedSearchIndexes){
  const definition=native.prepare(definitionSql(table)).get();
  if(!definition)continue;
  assert.match(definition.sql,/\bUSING\s+fts5\s*\(/i,'search storage is SQLite FTS5');
  native.prepare(integritySql(table)).run();
  shadows.push(...shadowsOf(native.prepare('PRAGMA table_list').all(),table));
 }
 return shadows;
}
export function markSearchShadows(snapshot,names){
 for(const name of names){assert.ok(Array.isArray(snapshot[name]),'raw search storage is retained');shadowRows.add(snapshot[name]);}
}
export function assertSearchShadowEquality(before,after){
 if(!isSearchShadow(before)&&!isSearchShadow(after))return false;
 assert.ok(isSearchShadow(before)&&isSearchShadow(after),'both search snapshots passed content integrity validation');
 return true;
}

/** D1-backed observers use the same content check before retaining raw rows. */
export async function validateStoredSearch(inspect){
 const shadows=[],tables=[];
 for(const {table} of derivedSearchIndexes){
  const definition=(await inspect({sql:definitionSql(table)})).results[0];
  if(!definition)continue;
  assert.match(definition.sql,/\bUSING\s+fts5\s*\(/i,'search storage is SQLite FTS5');
  await inspect({sql:integritySql(table)});
  tables.push(table);
  shadows.push(...shadowsOf((await inspect({sql:'PRAGMA table_list'})).results,table));
 }
 return tables.length?{tables,shadows}:null;
}
