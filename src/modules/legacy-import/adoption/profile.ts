import type {LegacyBundle, MappedRow, Row} from '../types'
import {stable, timestamp, text} from '../types'
import {relationships} from '../relationships'

/** Supplied by stored approval, never by manifest/source JSON. No CLI default changes. */
export interface HistoricalAdoptionProfile {
 kind:'historical-adoption'; policyVersion:2
 manifestSha256:string; custodyProjectId:string; sourceProjectId:string; custodianId:string
}
export type MappingProfile = HistoricalAdoptionProfile
export const historical = (profile?:MappingProfile):profile is HistoricalAdoptionProfile => profile?.kind==='historical-adoption'&&profile.policyVersion===2

export function sourceActor(bundle:LegacyBundle,value:unknown){
 const id=text(value,'historical actor id'),r=relationships(bundle).find('users',id)
 const membership=(bundle.tables.project_users??bundle.tables.memberships??[]).find(m=>String(m.user_id)===id)
 return {id,name:r?.name??null,role:membership?.role??r?.role??(membership?.is_owner?'owner':membership?.is_admin?'admin':'operator')}
}
export function actorOrigin(profile:MappingProfile,bundle:LegacyBundle,table:string,id:unknown,field:string,value:unknown):MappedRow[]{
 if(value===undefined||value===null||value==='')return []
 const actor=sourceActor(bundle,value)
 return [{table:'legacy_actor_origins',key:['project_id','target_table','target_id','field'],row:{project_id:profile.sourceProjectId,target_table:table,target_id:String(id),field,source_user_id:actor.id,display_name:actor.name}}]
}
export function historicalNote(r:Row,bundle:LegacyBundle,profile:MappingProfile,content:unknown):MappedRow[]{
 const conversation=relationships(bundle).find('conversations',r.conversation_id)
 if(!conversation||String(conversation.project_id)!==profile.sourceProjectId)throw new Error('invalid_scope')
 return [{table:'move_in_notes',key:['id'],row:{id:text(r.id,'note.id'),project_id:profile.sourceProjectId,conversation_id:String(r.conversation_id),bucket_id:String(r.bucket_id??r.conversation_id),author_json:stable(sourceActor(bundle,r.user_id??r.agent_id)),content,created_at:timestamp(r.created_at),source_time:JSON.stringify(r.created_at??null)}}]
}

// Old execution principals cannot occupy a native ID that belongs to a real
// account. A project/source namespace preserves attribution without access.
export const historicalPrincipal=(profile:MappingProfile,id:unknown)=>'legacy-actor:'+JSON.stringify([profile.sourceProjectId,String(id)])
