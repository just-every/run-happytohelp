import type {LegacyBundle, MappedRow, Row} from '../types'
import {stable} from '../types'
import {actorOrigin,historicalPrincipal,sourceActor,type MappingProfile} from './profile'
import {relationships} from '../relationships'

/** Extend the existing mapper's targets; source/journal bytes stay unchanged. */
export function historicalTargets(table:string,source:Row,bundle:LegacyBundle,targets:MappedRow[],profile:MappingProfile,assignees?:Map<string,string>):MappedRow[]{
 const result:MappedRow[]=[]
 for(let target of targets){
  if(['users','memberships','user_settings','credentials','sessions','identity_tokens','identity_tokens_account','platform_admins'].includes(target.table))throw new Error('historical_access_target_refused')
  const row={...target.row},origins:MappedRow[]=[]
  // Old verification keys were deliberately omitted. Their source verification
  // fact remains in the private journal, never as present-day native trust.
  if(target.table==='contacts')row.is_verified=0
  if(target.table==='conversations'){
   origins.push(...actorOrigin(profile,bundle,'conversations',row.id,'assigned_to',row.assigned_to))
   row.assigned_to=row.assigned_to==null?null:assignees?.get(String(row.assigned_to))??null
   if(target.row.assigned_to!=null&&!row.assigned_to)target={...target,hold:[target.hold,'Historical assignee could not be matched to one native workspace member; left unassigned'].filter(Boolean).join('; ')}
  }
  if(target.table==='macros'){
   const author=source.created_by_id??source.created_by
   if(author)origins.push(...actorOrigin(profile,bundle,'macros',row.id,'created_by',author))
   else origins.push({table:'legacy_actor_origins',key:['project_id','target_table','target_id','field'],row:{project_id:profile.sourceProjectId,target_table:'macros',target_id:String(row.id),field:'created_by',source_user_id:'',display_name:'Unknown source author'}})
   row.created_by=profile.custodianId
  }
  if(target.table==='ai_profiles')row.is_enabled=0
  if(target.table==='media'&&relationships(bundle).find('users',row.uploaded_by)){
   origins.push(...actorOrigin(profile,bundle,'media',row.id,'uploaded_by',row.uploaded_by))
   row.uploaded_by=historicalPrincipal(profile,row.uploaded_by)
  }
  // Revoked devices and cancelled/reconciled jobs remain historical. None of
  // their principal IDs can alias a native user, even when source IDs overlap.
  if(['local_grants','local_devices','local_jobs','training_runs'].includes(target.table))for(const field of ['user_id','operator_id']){
   if(row[field]!==undefined&&row[field]!==null){origins.push(...actorOrigin(profile,bundle,target.table,row.id,field,row[field]));row[field]=historicalPrincipal(profile,row[field])}
  }
  if(target.table==='local_devices'){row.client_session_id=null;row.capabilities='[]'}
  if(target.table==='local_jobs')row.session_id=null
  result.push({...target,row},...origins)
  if(target.table==='messages'&&!['contact','ai','system'].includes(String(row.actor_role))){
   result.push({table:'move_in_message_sources',key:['message_id'],row:{message_id:row.id,project_id:profile.sourceProjectId,author_json:stable(sourceActor(bundle,row.actor_id)),source_id:String(source.id),source_time:JSON.stringify(source.created_at??null),time_provenance:'source'}})
  }
 }
 return result
}
