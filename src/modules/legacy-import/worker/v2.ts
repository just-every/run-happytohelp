import type {Env} from '../../../platform/env'
import type {DeltaLease} from '../lease'
import type {LegacyBundle,MappedRow,Row} from '../types'
import {digest,stable} from '../types'
import {adoptionApply,getAdoption,mappingProfile,type AdoptionApply} from '../adoption/store'
import {preflightAdoptionTargets,validateAdoptionScope} from '../adoption/scope'
import {planImport,normalizeImportPlan,type PreparedSlice} from '../importer'
import {identity,sqlName,insertJson,byteSlices,jsonBytes} from '../d1'
import {checkpoint,cursor,type Run} from './state'
import {refuse} from './errors'

export async function adoptionForRun(env:Env,run:Run,lease:DeltaLease):Promise<AdoptionApply>{
 const a=await getAdoption(env.DB,run.manifest_sha256),token=(lease as DeltaLease&{token?:string}).token
 if(!a||!token)refuse('adoption_approval_required')
 return adoptionApply(env,run.manifest_sha256,{runId:run.id,version:run.version,leaseToken:run.lease_token!,workspaceToken:token,approvalVersion:a.approval_version})
}
/** Persist only bounded proposed targets in existing private scratch. This keeps
 * the all-package barrier across invocations without materializing a package.
 * B's normal/erasure cleanup removes these rows with every other context kind. */
export async function preflightSlice(env:Env,run:Run,bundle:LegacyBundle,hydrated:{context:LegacyBundle;media:any},prepared:PreparedSlice,adoption:AdoptionApply,objectKeys:Set<string>){
 const plan=await planImport(bundle,{context:hydrated.context,media:hydrated.media,objectKeys,identity:prepared.identity,mappingProfile:adoption.profile})
 await normalizeImportPlan(plan,env,prepared)
 const targets=plan.rows.flatMap(row=>row.mapped),available=new Set<string>(),wanted=new Set<string>()
 const references=new Map<string,Array<{id:number;seq:number;table:string;from:string;to:string|null}>>()
 for(const table of new Set(targets.map(t=>t.table)))references.set(table,(await env.DB.prepare(`PRAGMA foreign_key_list(${sqlName(table)})`).all<{id:number;seq:number;table:string;from:string;to:string|null}>()).results)
 for(const target of targets){
  const groups=new Map<number,Array<{id:number;seq:number;table:string;from:string;to:string|null}>>()
  for(const ref of references.get(target.table)!){const list=groups.get(ref.id)??[];list.push(ref);groups.set(ref.id,list)}
  for(const group of groups.values()){group.sort((a,b)=>a.seq-b.seq);if(group.every(ref=>target.row[ref.from]!=null))wanted.add(identity(group[0].table,group.map(ref=>target.row[ref.from])))}
 }
 if(wanted.size){const found=await env.DB.prepare("SELECT source_id FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:targets' AND source_id IN (SELECT value FROM json_each(?))").bind(run.id,JSON.stringify([...wanted])).all<{source_id:string}>();for(const row of found.results)available.add(row.source_id)}
 await preflightAdoptionTargets(env.DB,adoption.profile,targets,available,true)
 const keys=targets.map(t=>identity(t.table,t.key.map(k=>t.row[k]))),prior=await env.DB.prepare("SELECT source_id,row_json FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:targets' AND source_id IN (SELECT value FROM json_each(?))").bind(run.id,JSON.stringify(keys)).all<{source_id:string;row_json:string}>(),proposed=new Map(prior.results.map(r=>[r.source_id,stable(JSON.parse(r.row_json))]))
 const indexes=new Map<string,string[][]>()
 for(const table of new Set(targets.map(t=>t.table))){
  const list=await env.DB.prepare(`PRAGMA index_list(${sqlName(table)})`).all<{name:string;unique:number;partial:number}>(),columns:string[][]=[]
  for(const index of list.results.filter(i=>i.unique&&!i.partial)){const fields=(await env.DB.prepare(`PRAGMA index_info(${sqlName(index.name)})`).all<{seqno:number;name:string|null}>()).results.sort((a,b)=>a.seqno-b.seqno).map(r=>r.name);if(fields.length&&fields.every((f):f is string=>f!==null))columns.push(fields)}
  indexes.set(table,columns)
 }
 const targetRows:unknown[][]=[],unique=new Map<string,string>()
 for(let at=0;at<targets.length;at++){
  const target=targets[at],key=keys[at],value=JSON.stringify(target.row),canonical=stable(target.row)
  if(proposed.has(key)&&proposed.get(key)!==canonical)refuse('canonical_target_conflict')
  proposed.set(key,canonical);targetRows.push([run.id,'delta_plan','v2:targets',key,value,await digest(value)])
  for(const fields of indexes.get(target.table)!){if(fields.some(f=>target.row[f]==null))continue;const token=await digest(stable([target.table,fields,fields.map(f=>target.row[f])])),holder=unique.get(token);if(holder&&holder!==key)refuse('canonical_target_conflict');unique.set(token,key)}
 }
 if(unique.size){const holders=await env.DB.prepare("SELECT source_id,parent_id FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:unique' AND source_id IN (SELECT value FROM json_each(?))").bind(run.id,JSON.stringify([...unique.keys()])).all<{source_id:string;parent_id:string}>();for(const holder of holders.results)if(unique.get(holder.source_id)!==holder.parent_id)refuse('canonical_target_conflict')}
 const statements:D1PreparedStatement[]=[]
 for(const rows of byteSlices(targetRows,jsonBytes))statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest)',6,rows))
 const uniqueRows=[...unique].map(([token,key])=>[run.id,'delta_plan','v2:unique',token,key,'{}',''])
 for(const rows of byteSlices(uniqueRows,jsonBytes))statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest)',7,rows))
 if(statements.length>100)refuse('quantum_too_large')
 await checkpoint(env,run,{},statements)
}

/** Context parts receive the same scope proof even when no mapped row needs
 * their dependencies. Package-wide validation finishes before any object/native write. */
export async function preflightContextScope(env:Env,run:Run,manifest:import('../worker-contract').LegacyPackageManifest){
 const c=cursor(run),ordinal=Number(c.ordinal??0),part=manifest.context[ordinal]
 if(!part){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:run.mode==='delta'?'delta':'rows',ordinal:0,row:0})});return {rows:0,bytes:0}}
 const rows=await readRows(env.FILES,run.manifest_sha256,run.project_id,'context',part,2,run.source_project_id),offset=Number(c.row??0),slice=sliceRows(rows,offset),hydrated=await hydrate(env,run,manifest,part.table,slice.rows),a=await getAdoption(env.DB,run.manifest_sha256)
 if(!a)refuse('adoption_approval_required')
 validateAdoptionScope(chunkBundle(manifest,run.manifest_sha256,part,slice.rows),hydrated.context,mappingProfile(a))
 const next=offset+slice.rows.length,done=next===rows.length
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'scope',ordinal:done?ordinal+1:ordinal,row:done?0:next})})
 return {rows:slice.rows.length,bytes:slice.bytes}
}
import {readRows,chunkBundle} from './reader'
import {sliceRows} from './context-load'
import {hydrate} from './context-read'
