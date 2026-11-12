import type {Env} from '../../../platform/env'
import type {DeltaLease} from '../lease'
import type {LegacyBundle,MappedRow,Row} from '../types'
import {digest,stable} from '../types'
import {adoptionApply,getAdoption,type AdoptionApply} from '../adoption/store'
import {preflightAdoptionTargets} from '../adoption/scope'
import {planImport,normalizeImportPlan,type PreparedSlice} from '../importer'
import {identity,sqlName} from '../d1'
import {checkpoint,type Run} from './state'
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
 const targets=plan.rows.flatMap(row=>row.mapped),available=new Set<string>()
 // Only referenced target identities are looked up, never the entire plan.
 for(const target of targets){
  const refs=await env.DB.prepare(`PRAGMA foreign_key_list(${sqlName(target.table)})`).all<{id:number;seq:number;table:string;from:string;to:string|null}>()
  const groups=new Map<number,typeof refs.results>()
  for(const ref of refs.results){const list=groups.get(ref.id)??[];list.push(ref);groups.set(ref.id,list)}
  for(const group of groups.values()){
   group.sort((a,b)=>a.seq-b.seq)
   if(group.some(ref=>target.row[ref.from]==null))continue
   const key=identity(group[0].table,group.map(ref=>target.row[ref.from]))
   if(await env.DB.prepare("SELECT 1 FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:targets' AND source_id=?").bind(run.id,key).first())available.add(key)
  }
 }
 await preflightAdoptionTargets(env.DB,adoption.profile,targets,available,true)
 const statements:D1PreparedStatement[]=[]
 for(const target of targets){
  const key=identity(target.table,target.key.map(k=>target.row[k])),value=JSON.stringify(target.row)
  const prior=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:targets' AND source_id=?").bind(run.id,key).first<{row_json:string}>()
  if(prior&&stable(JSON.parse(prior.row_json))!==stable(target.row))refuse('canonical_target_conflict')
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest) VALUES(?,'delta_plan','v2:targets',?,?,?)").bind(run.id,key,value,await digest(value)))
  const indexes=await env.DB.prepare(`PRAGMA index_list(${sqlName(target.table)})`).all<{name:string;unique:number;partial:number}>()
  for(const index of indexes.results.filter(i=>i.unique&&!i.partial)){
   const columns=(await env.DB.prepare(`PRAGMA index_info(${sqlName(index.name)})`).all<{seqno:number;name:string|null}>()).results.sort((a,b)=>a.seqno-b.seqno).map(r=>r.name)
   if(!columns.length||columns.some(c=>!c||target.row[c]==null))continue
   const token=await digest(stable([target.table,columns,columns.map(c=>target.row[c!])])),holder=await env.DB.prepare("SELECT parent_id FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='v2:unique' AND source_id=?").bind(run.id,token).first<{parent_id:string}>()
   if(holder&&holder.parent_id!==key)refuse('canonical_target_conflict')
   statements.push(env.DB.prepare("INSERT OR IGNORE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest) VALUES(?,'delta_plan','v2:unique',?,?,'{}','')").bind(run.id,token,key))
  }
 }
 // Bound before batch; an expensive indivisible shape pauses before any native write.
 if(statements.length>100)refuse('quantum_too_large')
 await checkpoint(env,run,{},statements)
}
