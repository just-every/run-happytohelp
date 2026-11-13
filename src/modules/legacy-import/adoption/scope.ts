import type {LegacyBundle,MappedRow} from '../types'
import type {MappingProfile} from './profile'
import {relationships} from '../relationships'
import {readGuard} from '../delta-guard'
import {refuse} from './errors'
import {identity,lookupRows,groupBy} from '../d1'
import {targetKeyOf,readStates,stateKey} from '../state'
import {stable} from '../types'

/** Use the runner's bounded, indexed source closure. It MUST include the single
 * validated project and parents, even when the current original part does not.
 * C performs this for EVERY part/context before its first canonical/object write. */
export function validateAdoptionScope(bundle:LegacyBundle,context:LegacyBundle,profile:MappingProfile){
 if(bundle.source.projectId!==profile.sourceProjectId||context.source.projectId!==profile.sourceProjectId||bundle.source.package!==profile.manifestSha256)refuse('invalid_scope',422)
 const projects=context.tables.projects??[]
 if(projects.length!==1||String(projects[0].id)!==profile.sourceProjectId||projects[0].deleted_at&&bundle.source.delta===undefined&&bundle.source.since===undefined)refuse('invalid_scope',422)
 const related=relationships(context)
 const parent=(table:string,id:unknown)=>{if(id===undefined||id===null)return;const r=related.find(table,id);if(!r||r.project_id!=null&&String(r.project_id)!==profile.sourceProjectId)refuse('invalid_scope',422)}
 for(const [table,rows] of Object.entries(bundle.tables))for(const row of rows){
  if(row.project_id!=null&&String(row.project_id)!==profile.sourceProjectId||table==='projects'&&String(row.id)!==profile.sourceProjectId)refuse('invalid_scope',422)
  if(row.conversation_id!=null)parent('conversations',row.conversation_id)
  if(table==='conversations'||table==='conversation_participants')parent('contacts',row.contact_id)
  if(row.message_id!=null)parent('messages',row.message_id)
  if(row.dataset_id!=null)parent(context.tables.datasets?'datasets':'knowledge_datasets',row.dataset_id)
  if(table==='mediables'){
   const model=String(row.mediable_type).split('\\').at(-1),parents:Record<string,string>={Message:'messages',Event:'events',SupportDelegation:'support_delegations',Project:'projects',Article:'articles',User:'users',AI:'ais'}
   if(!model||!parents[model])refuse('invalid_scope',422)
   parent(parents[model],row.mediable_id);parent('media',row.media_id)
  }
 }
}

/** Extra unique keys (widget/aliases/mailbox/global IDs) and orphan FKs are
 * preflighted by the existing schema-derived guard. `available` contains mapped
 * parents validated by earlier package slices, not native authority grants. */
export async function preflightAdoptionTargets(db:D1Database,profile:MappingProfile,targets:MappedRow[],available:Set<string>=new Set(),checkReferences=true){
 const guard=await readGuard(db,targets,{identityIndexes:true})
 const states=await readStates(db,targets.map(t=>[t.table,targetKeyOf(t)])),bound=new Set<string>()
 for(const [shape,rows] of groupBy(targets,t=>t.table+'\0'+t.key.join(','),t=>t)){
  const [table,columns]=shape.split('\0'),keys=columns.split(','),found=await lookupRows(db,table,keys,rows.map(t=>keys.map(k=>t.row[k])))
  for(const target of rows)if(found.get(identity(table,keys.map(k=>target.row[k])))){
   const state=states.get(stateKey(table,targetKeyOf(target)))
   if(!state)refuse('canonical_target_conflict')
   if(!bound.has(state.run_id)){
    if(!await db.prepare('SELECT 1 FROM legacy_import_mapping_profiles WHERE run_id=? AND profile_json=?').bind(state.run_id,stable(profile)).first())refuse('canonical_target_conflict')
    bound.add(state.run_id)
   }
  }
 }
 for(const target of targets){
  const clash=guard.clash(target.table,target.key,target.row),own=new Set([...available,...targets.map(t=>identity(t.table,t.key.map(k=>t.row[k])))])
  if(clash||checkReferences&&guard.missing(target.table,target.row,own))refuse('canonical_target_conflict')
  guard.take(target.table,target.key,target.row)
 }
}
