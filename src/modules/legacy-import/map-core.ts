import { type Row,type LegacyBundle,type MappedRow,timestamp,text,stable } from './types'
import {truth,columns} from './mapping-shared'
import {relationships,contactIdentity} from './relationships'
import {mapProject} from './map-project'
import {historical,historicalNote,type MappingProfile} from './adoption/profile'
export function mapCore(table:string,r:Row,b:LegacyBundle,profile?:MappingProfile):MappedRow[]|undefined {
 const related=relationships(b)
 const created=timestamp(r.created_at),project=r.project_id&&String(r.project_id),id=r.id&&String(r.id);const one=(table:string,row:Row,key=['id'],hold?:string):MappedRow[]=>[{table,row,key,hold}]
 switch(table){
 case 'projects':return mapProject(r,b)
 case 'users':{if(String(r.type).toLowerCase()==='ai'||(!r.email&&(b.tables.ais||[]).some(ai=>String(ai.id)===id)))return [];const result=one('users',{id:text(id,'users.id'),email:text(r.email,'users.email'),name:text(r.name,'users.name'),created_at:created});if(r.timezone||r.avatar_url||r.is_notifiable_on_conversation_assignment!==undefined)result.push({table:'user_settings',row:{user_id:id,...columns(r,['timezone','avatar_url','is_notifiable_on_conversation_assignment'])},key:['user_id']});return result}
 case 'project_users':case 'memberships':if(!r.user_id)return [];return one('memberships',{project_id:project,user_id:String(r.user_id),role:String(r.role).toLowerCase()==='owner'||r.is_owner? 'owner':String(r.role).toLowerCase()==='admin'||r.is_admin?'admin':'operator'},['project_id','user_id'])
 case 'contacts':{const identity=contactIdentity(r),owner=identity===null?undefined:related.identityOwner(project,identity),shared=owner!==undefined&&String(owner.id)!==id
  return one('contacts',{id,project_id:project,name:r.provided_name||r.name||r.nickname||null,email:r.provided_email||r.email||null,external_id:shared?null:identity,created_at:created,is_verified:truth(r.is_verified)?1:0,metadata_json:stable({...columns(r,['timezone','country_code','avatar_url','language','user_agent','ip_address']),...((typeof r.metadata==='string'?JSON.parse(r.metadata):r.metadata||{}) as Row),...(r.blocked_at||truth(r.is_blocked)?{is_blocked:true,blocked_at:r.blocked_at||null}:{}),...(r.provided_name?{provided_name:r.provided_name}:{}),...(r.provided_email?{provided_email:r.provided_email}:{})})},['id'],shared?`Legacy contact shares its identifier with earlier contact ${owner!.id}; imported without an external identity until the two are merged`:undefined)}
 case 'conversations':{const messages=(related.messages.get(String(id))||[]);const last=messages.at(-1),summary=related.conversationSummary?.get(String(id));const aiId=r.ai_id||(b.tables.ais||b.tables.ai_profiles||[]).find(ai=>String(ai.id)===String(r.agent_id))?.id;const result=one('conversations',{id,project_id:project,contact_id:text(r.contact_id,'conversations.contact_id'),revision:summary?.count??messages.length,last_message_id:summary?summary.lastId:last?String(last.id):null,assigned_to:aiId?null:r.agent_id??r.assigned_to??null,resolved_at:r.resolved_at?timestamp(r.resolved_at):r.resolved?timestamp(r.updated_at||r.created_at):null,created_at:created,updated_at:timestamp(r.updated_at||r.created_at)});if(aiId)result.push({table:'conversation_ai',row:{conversation_id:id,ai_id:aiId},key:['conversation_id']});return result}
 case 'buckets':return one('conversation_buckets',{id,conversation_id:String(r.conversation_id),created_at:created,metadata_json:stable(r)})
 case 'messages':{if(r.deleted_at)return [];
  // Legacy widgets could deliver one local ID twice in a conversation; native keeps
  // delivery IDs unique, so the first message in transcript order keeps it.
  const owner=r.local_id?related.localIdOwner(String(r.conversation_id),String(r.local_id)):id
  if(owner===undefined)throw new Error(`Legacy message missing from mapping context: ${id}`)
  // Who wrote it is what legacy recorded: a contact, an AI, an agent. A message with no author at all (ChargeDesk's automatic away
  // text) is the workspace speaking, role 'system' as native away replies are, never an operator's reply. Authorship is
  // written only where the kind follows from that (visitor, human, ai); anything else is 'unknown', never a guess.
  const ai=Boolean(r.ai_id)||(b.tables.ais||b.tables.ai_profiles||[]).some(ai=>String(ai.id)===String(r.agent_id)),author=r.agent_id||r.contact_id||r.actor_id
  const role=String(r.actor_role||(r.contact_id?'contact':ai?'ai':author?'operator':'system')),kind=role==='contact'?'visitor':role==='ai'?'ai':role==='operator'&&author?'human':'unknown'
  return [...one('messages',{id,project_id:project,conversation_id:String(r.conversation_id),local_id:r.local_id&&owner===id?r.local_id:`legacy:${id}`,actor_id:String(author||'legacy-system'),actor_role:role,content:r.content??'',revision:related.revisions.get(String(id))??0,created_at:created,bucket_id:r.bucket_id??null,intent_hash:null}),...one('message_authorship',{message_id:id,project_id:project,kind,source_kind:'legacy_import',recorded_at:created},['message_id'])]}
 case 'events':{
  if(r.type==='INTERNAL_NOTE'){
   const content=r.payload
   if(typeof content!=='string')throw new Error('Internal note payload must be a string')
   if(historical(profile))return historicalNote(r,b,profile,content)
   return one('conversation_notes',{id,conversation_id:String(r.conversation_id),user_id:text(r.agent_id,'events.agent_id'),content,created_at:created})
  }
  if(r.type!=='AGENT_ASSIGNED'&&r.type!=='USED_INSIGHT')return []
  const conversation=related.find('conversations',r.conversation_id)
  const payload=typeof r.payload==='string'?JSON.parse(r.payload):r.payload
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Support history event payload must be an object')
  const attributed={...payload,conversation_id:text(r.conversation_id,'events.conversation_id'),bucket_id:r.bucket_id??r.conversation_id,agent_id:r.agent_id??null,...(r.close!==undefined?{close:truth(r.close)}:{})}
  return one('context_tracked_events',{id,project_id:text(conversation?.project_id,'event conversation project_id'),subject_id:text(conversation?.contact_id,'event conversation contact_id'),local_id:`legacy:${id}`,type:r.type,payload:stable(attributed),created_at:created})
 }
 case 'notes':case 'conversation_notes':return historical(profile)?historicalNote(r,b,profile,r.content||r.note||''):one('conversation_notes',{id,conversation_id:String(r.conversation_id),user_id:String(r.user_id||r.agent_id),content:r.content||r.note||'',created_at:created})
 case 'conversation_participants':return one('conversation_participants',{id:id||`${r.conversation_id}:${r.contact_id}`,conversation_id:String(r.conversation_id),contact_id:String(r.contact_id),created_at:created})
 case 'media':{const exported=related.find('media',id);const pivot=related.mediaMessages.get(String(id));const message=related.find('messages',r.message_id||pivot?.mediable_id);const conversationId=r.conversation_id||message?.conversation_id;if(!conversationId)return [];return one('media',{id,project_id:project||message?.project_id,conversation_id:String(conversationId),uploaded_by:String(r.uploaded_by||message?.agent_id||message?.contact_id||'legacy-system'),object_key:text(r.object_key||r.storage_key||exported?.object_key||exported?.storage_key,'media.object_key explicit exported R2 key'),filename:r.original_filename||r.filename_original||exported?.original_filename||exported?.filename_original||(r.extension?`${r.filename}.${r.extension}`:r.filename)||r.name||id,content_type:r.content_type||r.mime_type||'application/octet-stream',size:Number(r.size||0),message_id:message?String(message.id):null,created_at:created})}
 default:return undefined
 }
}
