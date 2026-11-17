import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {registerHooks} from 'node:module'
import {existsSync} from 'node:fs'
import {credentialColumns,skippedTables,structuredOmissions} from '../../scripts/legacy-export/scope.mjs'

/** SQL inventory is independent of mapping: includes excluded tables and nulls,
 * never captures values, credentials or encrypted source payloads. */
export async function sourceInventory(connection){
 const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8'),fields=[]
 for(const table of schema.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g))for(const column of table[2].matchAll(/^  `([^`]+)`/gm)){
  const [[counts]]=await connection.query(`SELECT count(*) n,sum(\`${column[1]}\` IS NULL) nulls FROM \`${table[1]}\``)
  const position=schema.indexOf(column[0],table.index)
  fields.push({table:table[1],field:column[1],evidence:'tests/legacy-export/schema.sql:'+String(schema.slice(0,position).split('\n').length),fixtureRows:Number(counts.n),fixtureNulls:Number(counts.nulls??0)})
 }
 return fields
}
export async function writeFieldMatrix(output,inventory,sources,results){
 registerHooks({resolve(s,c,n){if(s.startsWith('.')&&c.parentURL){const url=new URL(s+'.ts',c.parentURL);if(existsSync(url))return n(url.href,c)}return n(s,c)}})
 const {fieldRule}=await import('../../src/modules/legacy-import/field-rules.ts'),{sourceColumns}=await import('../../src/modules/legacy-import/source-columns.ts')
 const catalog=Object.entries(sourceColumns).flatMap(([t,fs])=>fs.split(' ').map(f=>t+'.'+f))
 assert.deepEqual(new Set(catalog),new Set(inventory.map(f=>f.table+'.'+f.field)),'schema drift fails classification')
 const records=inventory.map(field=>{
  const rule=fieldRule(field.table,field.field);assert.notEqual(rule.kind,'unclassified',field.table+'.'+field.field)
  const excluded=skippedTables.includes(field.table),omitted=excluded||credentialColumns[field.table]?.includes(field.field)
  const present=sources.flatMap(s=>s.tables[field.table]??[]).filter(r=>Object.hasOwn(r,field.field)).length
  if(omitted)assert.equal(present,0,'omitted field must not reach artifact')
  const outcomes=results.flatMap(r=>r.first.fieldDispositions??[]).filter(f=>f.table===field.table&&f.field===field.field)
  if(present)assert.equal(outcomes.reduce((n,f)=>n+f.rows,0),present,'each source field counted once, never context twice')
  return {...field,fixtureCase:'generated SQL / field counts (including nulls)',exporter:omitted?'OMITTED(export); no archive':present?'carried sanitized source':'not in selected project scope',exportedRows:present,native:omitted?'DROPPED(native)':rule.target??'DROPPED(native)',policy:rule.kind,reason:rule.reason,outcomes,reader:omitted?'absence scanned in artifacts and every D1/R2 store':present?rule.kind==='archive'||rule.kind==='control'?'private custody/control; no equivalent native field claimed':'native flow oracle / authorized reader journey; see native-readers.json':'NOT EXERCISED in selected scope',command:'node --test --test-concurrency=1 tests/legacy-export.mjs'}
 })
 const extras=[...new Set(sources.flatMap(s=>Object.entries(s.tables).flatMap(([t,rows])=>rows.flatMap(r=>Object.keys(r).filter(f=>!catalog.includes(t+'.'+f)).map(f=>t+'.'+f)))))].map(key=>{const [table,field]=key.split('.');const rule=fieldRule(table,field);assert.notEqual(rule.kind,'unclassified',key);return {table,field,...rule}})
 const matrix={schemaTables:Object.keys(sourceColumns).length,baselineFields:records.length,records,enrichments:extras,nestedOmissions:structuredOmissions,objectCounts:results.map(r=>({projectId:r.projectId,objects:r.first.objects,uploaded:r.chunked.objectsUploaded,pivots:r.source.mediables,sourceRows:r.first.sourceRows,archiveRows:r.first.archivedOnly.length}))}
 await writeFile(join(output,'field-matrix.json'),JSON.stringify(matrix,null,2))
 const cell=value=>String(value).replaceAll('|','/').replaceAll('\n',' ')
 await writeFile(join(output,'FIELD-MATRIX.md'),'# Source field dispositions\n\nThis is synthetic qualification, not current production inventory. A native mapping is conditional on row eligibility; archive custody is not native workflow parity. Null/non-null coverage is explicit; an unexercised value remains unproved.\n\n| Table.column | Source evidence | Fixture rows/nulls | Export | Native / normalization | Reason | Actual outcome / command |\n|---|---|---|---|---|---|---|\n'+records.map(r=>[r.table+'.'+r.field,r.evidence,r.fixtureRows+'/'+r.fixtureNulls,r.exporter,r.native,r.reason,r.reader+'; '+r.command].map(cell).join(' | ')).map(r=>'| '+r+' |').join('\n')+'\n')
 return matrix
}
