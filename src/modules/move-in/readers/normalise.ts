import {zendeskConfiguration,configurationTags} from './zendesk-configuration'
import {zendeskMacroBody,zendeskMacroActions} from './zendesk-macro'
import {importedEmailThreadKeys} from '../email-threading'
import type { SourceBundle, SourceRecord } from '../../import-kit/src/types'
import type { MappingInput, PreparedMapping, Vendor } from '../types'
import { recordKey,LIMITS } from '../types'
import { completeNativeValue,nativeStatementCount } from '../targets'
import {prepareHelpScout,helpScoutTags} from './helpscout-mapping'
import {prepareFreshdesk,freshdeskTags} from './freshdesk-mapping'
import {closedAt} from './closed-state'
import {auditShape,shapeReason} from './shapes'
import {htmlToMarkdown} from '../../knowledge/importers'
import { nativeId, object, sourceId, sourceRecord, tagKey, text, time } from './common'
export interface NativeValue { tables:Record<string,Record<string,any>[]>; source:Record<string,any> }
const email=(value:unknown)=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:null
const array=(value:unknown):any[]=>Array.isArray(value)?value:[]
const tags=(record:SourceRecord):string[]=>record.namespace==='helpscout'?helpScoutTags(record):record.namespace==='freshdesk'?freshdeskTags(record):record.namespace==='zendesk'?array((record.payload as any)?.tags).filter(v=>typeof v==='string'&&v.trim()):array((record.payload as any)?.tags?.tags ?? (record.payload as any)?.tags?.data).filter(v=>object(v)&&typeof v.name==='string'&&v.name.trim()).map(v=>v.name)
export function withTags(source:SourceBundle,vendor:Vendor):SourceBundle {
 const seen=new Set<string>(),added:SourceRecord[]=[]
 for(const record of source.records.filter(r=>['ticket','conversation'].includes(r.kind)||vendor==='helpscout'&&r.kind==='tag'||vendor==='zendesk'&&['macro','trigger','automation'].includes(r.kind)))for(const name of vendor==='zendesk'&&['macro','trigger','automation'].includes(record.kind)?configurationTags(record):tags(record)){if(name.trim().length>80){source.diagnostics.push({severity:'error',code:'tag_name_limit',message:'Tag names longer than 80 characters are not imported',location:record.location});continue}const key=tagKey(name);if(seen.has(key))continue;if(source.records.length+added.length>=LIMITS.records)throw new Error('export_record_limit');seen.add(key);added.push(sourceRecord(vendor,'tag-name',key,{name:name.trim()},record.location.artifact,record.artifactHash,record.location.row??1,`${record.location.pointer??''}/tags`))}
 return {...source,records:[...added,...source.records].sort((a,b)=>rank(a.kind)-rank(b.kind))}
}
const rank=(kind:string)=>kind==='tag-name'?0:['group','schedule'].includes(kind)?1:kind==='user'||kind==='contact'||kind==='agent'?1:kind==='collection'?2:kind==='category'?3:4
export async function prepareMapping(input:MappingInput):Promise<PreparedMapping> {
 if(input.vendor==='helpscout')return prepareHelpScout(input)
 if(input.vendor==='freshdesk')return prepareFreshdesk(input)
 const {projectId,actorId,vendor,source,tagIds}=input,result:PreparedMapping={known:new Set(),effects:new Map(),rejections:new Map(),omissions:new Map()}
 const records=new Map(source.records.map(r=>[recordKey(r),r])),id=(kind:string,source:string)=>nativeId(projectId,vendor,kind,source)
 const author=(value:any)=>{if(vendor==='zendesk'){const sid=sourceId(value,vendor),user=records.get(`user/${sid}`)?.payload as any;if(!user||!['end-user','agent','admin'].includes(user.role))throw new Error('comment_author_role_missing');return {id:sid,name:typeof user.name==='string'?user.name:null,role:user.role==='end-user'?'contact':'operator'}}
  if(!object(value))throw new Error('author_missing');const sid=sourceId(value.id,vendor),kind=value.type
  const role=['contact','user','lead'].includes(kind)?'contact':['admin','teammate','team'].includes(kind)?'operator':['bot','campaign','system'].includes(kind)?'system':null
  if(!role)throw new Error('author_role_unsupported');return {id:sid,name:typeof value.name==='string'?value.name:null,role}}
 for(const record of source.records){const key=recordKey(record),p=record.payload as any,issues=auditShape(vendor,record.kind,p).issues.filter(issue=>issue.reason!=='record_kind_not_understood'),omissions:string[]=issues.map(shapeReason)
  for(const issue of issues)source.diagnostics.push({severity:'warning',code:issue.code,message:shapeReason(issue),kind:record.kind,sourceId:record.sourceId,location:{...record.location,pointer:`${record.location.pointer??''}${vendor==='zendesk'?`/${record.kind}`:''}${issue.path}`}})
  try{if(tags(record).some(name=>name.trim().length>80))throw new Error('tag_name_limit');let kind:string,tables:NativeValue['tables']={},target:string
   const configuration=vendor==='zendesk'?zendeskConfiguration(record,projectId,actorId,records,tagIds,omissions):null
   if(configuration){kind=configuration.kind;target=configuration.target;Object.assign(tables,configuration.tables)}
   else if(record.kind==='tag-name'){kind='tag';target=tagIds.get(record.sourceId)??id('tag',record.sourceId);if(tagIds.has(record.sourceId)){result.omissions.set(key,['existing_workspace_tag_reused']);result.effects.set(key,[]);continue}tables.workspace_tags=[{id:target,project_id:projectId,name:p.name,normalized_name:record.sourceId}]}
   else if(vendor==='zendesk'&&record.kind==='user'||vendor==='intercom'&&record.kind==='contact'){
    if(vendor==='zendesk'){text(p.name,'contact_name_required',500);if(!email(p.email))throw new Error('contact_email_missing_or_invalid');time(p.created_at,'iso')}
    if(vendor==='intercom'&&p.name!=null&&typeof p.name!=='string')throw new Error('contact_name_invalid')
    if(vendor==='zendesk'&&p.role!=='end-user'){if(!['agent','admin'].includes(p.role))throw new Error('user_role_unsupported');result.effects.set(key,[]);result.omissions.set(key,[...omissions,'historical_staff_retained_as_authors_no_access_created']);continue}
    const address=email(p.email);if(!address)throw new Error('contact_email_missing_or_invalid')
    kind='contact';target=id(kind,record.sourceId);tables.contacts=[{id:target,project_id:projectId,name:vendor==='zendesk'?text(p.name,'contact_name_required',500):typeof p.name==='string'?p.name:address,email:address,external_id:`import:${vendor}:${record.sourceId}`,created_at:time(p.created_at,vendor==='zendesk'?'iso':'unix'),is_verified:0,metadata_json:JSON.stringify({imported_tags:[...new Set(tags(record))]})}]
    tables.context_subjects=[{project_id:projectId,subject_id:target,consent:0,revision:0,help_types:'[]',bot_enabled:0}]
    if(p.custom_attributes||p.user_fields)omissions.push('custom_fields_retained_in_original_only')
    if(p.external_id!=null)omissions.push('external_identity_retained_in_original_only')
   }else if(vendor==='zendesk'&&record.kind==='ticket'||vendor==='intercom'&&record.kind==='conversation'){
    kind='conversation';target=id(kind,record.sourceId)
    const created=time(p.created_at,vendor==='zendesk'?'iso':'unix'),updated=time(p.updated_at,vendor==='zendesk'?'iso':'unix')
    const contactSource=vendor==='zendesk'?sourceId(p.requester_id,vendor):(()=>{if(p.contacts?.type!=='contact.list'||!Array.isArray(p.contacts.contacts)||p.contacts.contacts.length!==1)throw new Error('exactly_one_conversation_contact_required');return sourceId(p.contacts.contacts[0]?.id,vendor)})()
    const contact=records.get(`${vendor==='zendesk'?'user':'contact'}/${contactSource}`)
    if(!contact||vendor==='zendesk'&&(contact.payload as any).role!=='end-user'||!email((contact?.payload as any)?.email))throw new Error('conversation_contact_unavailable')
    const state=vendor==='zendesk'?p.status:p.state;if(!(vendor==='zendesk'?['new','open','pending','hold','solved','closed']:['open','closed','snoozed']).includes(state))throw new Error('conversation_state_unsupported')
    const rows:Record<string,any>[]=[],notes:Record<string,any>[]=[],sources:Record<string,any>[]=[],seen=new Set<string>()
    const add=async(part:any,sid:string,content:unknown,visible:boolean,when:number,person:any,original:unknown,provenance:string)=>{
     if(seen.has(sid))throw new Error('duplicate_message_id');seen.add(sid);const rawBody=text(content,'message_body_missing'),body=vendor==='intercom'&&/<[a-z][^>]*>/i.test(rawBody)?await htmlToMarkdown(rawBody):rawBody,messageId=id('message',`${record.sourceId}:${sid}`)
     if(!visible){notes.push({id:messageId,project_id:projectId,conversation_id:target,author_json:JSON.stringify(person),content:body,created_at:when,source_time:JSON.stringify(original)});return}
     rows.push({id:messageId,project_id:projectId,conversation_id:target,local_id:`import:${sid}`,actor_id:person.role==='contact'?id('contact',person.id):`import:${vendor}:${person.id}`,actor_role:person.role,content:body,revision:rows.length+1,created_at:when,intent_hash:null,bucket_id:null,erased_at:null,citations_json:'[]'})
     sources.push({message_id:messageId,project_id:projectId,author_json:JSON.stringify(person),source_id:sid,source_time:original===null?null:JSON.stringify(original),time_provenance:provenance})
    }
    if(vendor==='zendesk'){
     if(p.via?.channel!=null&&typeof p.via.channel!=='string')throw new Error('conversation_source_channel_invalid')
     if(!Array.isArray(p.comments)||!p.comments.length)throw new Error('ticket_comments_required')
     for(const part of p.comments){if(!object(part)||typeof part.public!=='boolean')throw new Error('comment_visibility_required');await add(part,sourceId(part.id,vendor),part.plain_body??part.body,part.public,time(part.created_at,'iso'),author(part.author_id),part.created_at,'source')}
     if(p.attachments||p.comments.some((v:any)=>array(v.attachments).length))omissions.push('attachments_metadata_retained_bytes_not_imported')
    }else{
     if(!object(p.source)||!['email','messenger'].includes(p.channel?.initial))throw new Error('conversation_source_channel_unsupported')
     if(p.conversation_parts?.type!=='conversation_part.list'||!Array.isArray(p.conversation_parts.conversation_parts))throw new Error('conversation_parts_required')
     if(Object.hasOwn(p.conversation_parts,'total_count')&&(!Number.isSafeInteger(p.conversation_parts.total_count)||p.conversation_parts.total_count<0||p.conversation_parts.total_count!==p.conversation_parts.conversation_parts.length))throw new Error('conversation_parts_count_invalid_or_incomplete')
     await add(p.source,`source:${sourceId(p.source.id,vendor)}`,p.source.body,true,created,author(p.source.author),null,'conversation-created-context')
     omissions.push('initial_message_time_unavailable_conversation_created_context_shown')
     for(const part of p.conversation_parts.conversation_parts){if(!object(part))throw new Error('conversation_part_invalid');if(!['comment','note'].includes(part.part_type)){omissions.push(`unsupported_part_type:${typeof part.part_type==='string'?part.part_type:'malformed'}`);continue}await add(part,sourceId(part.id,vendor),part.body,part.part_type==='comment',time(part.created_at,'unix'),author(part.author),part.created_at,'source')}
     if(array(p.source.attachments).length||p.conversation_parts.conversation_parts.some((v:any)=>array(v.attachments).length))omissions.push('attachments_metadata_retained_bytes_not_imported')
    }
    rows.sort((a,b)=>a.created_at-b.created_at||a.local_id.localeCompare(b.local_id));rows.forEach((row,index)=>{row.revision=index+1})
    const resolved=['closed','solved'].includes(state)?closedAt([],p.updated_at,omissions,vendor==='zendesk'?'iso':'unix'):null
    tables.conversations=[{id:target,project_id:projectId,contact_id:id('contact',contactSource),revision:rows.length,last_message_id:rows.at(-1)?.id??null,assigned_to:null,resolved_at:resolved,created_at:created,updated_at:updated}]
    tables.move_in_conversations=[{conversation_id:target,project_id:projectId,vendor,source_id:record.sourceId,subject:typeof p.subject==='string'?p.subject:typeof p.title==='string'?p.title:typeof p.source?.subject==='string'?p.source.subject:'',source_state:state,source_channel:vendor==='zendesk'?(p.via?.channel??'unknown'):p.channel.initial}]
    tables.messages=rows;tables.move_in_message_sources=sources;tables.move_in_notes=notes
    tables.conversation_tags=[...new Set(tags(record).map(tagKey))].map(name=>({project_id:projectId,conversation_id:target,tag_id:tagIds.get(name)??id('tag',name)}))
    if(p.assignee_id||p.admin_assignee_id||p.team_assignee_id)omissions.push('historical_assignment_not_activated')
   }else if(record.kind==='macro'){
    kind='macro';target=id(kind,record.sourceId);let body:string,title:string,created:number,updated:number
    if(vendor==='zendesk'){
     if(p.restriction!=null)throw new Error('restricted_macro_not_imported')
     if(!Array.isArray(p.actions))throw new Error('macro_actions_required')
     const replies=p.actions.filter((a:any)=>['comment_value','comment_value_html'].includes(a.field));if(replies.length!==1)throw new Error('one_macro_reply_required')
     // A private macro becomes an explicit native note, never a public reply.
     body=text(replies[0].value,'macro_body_required');title=text(p.title,'macro_title_required');created=time(p.created_at,'iso');updated=time(p.updated_at,'iso');
    }else{
     if(p.visible_to!=='everyone')throw new Error('restricted_macro_not_imported')
     if(!Array.isArray(p.available_on)||!p.available_on.includes('inbox'))throw new Error('macro_channel_unsupported')
     body=text(p.body??p.body_text,'macro_body_required');title=text(p.name,'macro_title_required');created=time(p.created_at,'iso');updated=time(p.updated_at,'iso')
    }
    // Inspect every supported original representation before markup conversion
    // can discard dynamic attributes or the plain-text fallback expression.
    const representations=vendor==='intercom'?[p.body,p.body_text]:p.actions.filter((a:any)=>['comment_value','comment_value_html'].includes(a.field)).map((a:any)=>a.value)
    if(vendor!=='zendesk'&&representations.some((value:unknown)=>typeof value==='string'&&/\{\{|\{%|<\s*attribute\b/i.test(value)))throw new Error('macro_placeholders_not_supported')
    if(vendor==='zendesk'){body=zendeskMacroBody(body,omissions);if(/<[^>]*\{\{/.test(body))throw new Error('macro_attribute_placeholders_not_supported')}
    if(/<[a-z][^>]*>/i.test(body))body=await htmlToMarkdown(body)
    if(vendor!=='zendesk'&&/\{\{|\{%/.test(body))throw new Error('macro_placeholders_not_supported')
    tables.macros=[{id:target,project_id:projectId,title,content:body,created_by:actorId,created_at:created,updated_at:updated}]
    if(vendor==='zendesk')tables.macro_versions=[{macro_id:target,project_id:projectId,version:1,title,content:body,actions_json:JSON.stringify(zendeskMacroActions(p.actions,new Map([...array(source.records).filter(r=>r.kind==='tag-name').map(r=>[r.sourceId,id('tag',r.sourceId)] as [string,string]),...tagIds]),omissions)),scope_json:JSON.stringify({visibility:'shared',roles:[],groups:[],brands:[]}),created_by:actorId,created_at:updated}]
   }else if(record.kind==='article'){
    kind='article';target=id(kind,record.sourceId);let status:string
    if(vendor==='zendesk'){
     if(typeof p.draft!=='boolean')throw new Error('article_publication_required')
     if(!Object.hasOwn(p,'user_segment_id')&&!Object.hasOwn(p,'user_segment_ids'))throw new Error('article_audience_unknown')
     if(Object.hasOwn(p,'user_segment_ids')&&!Array.isArray(p.user_segment_ids))throw new Error('article_audience_unknown')
     if(p.user_segment_id!=null||array(p.user_segment_ids).length)throw new Error('restricted_article_not_imported');status=p.draft?'draft':'published'
    }else{if(!['draft','published'].includes(p.state))throw new Error('article_publication_required');if(p.audience!=null||p.audience_rules!=null)throw new Error('restricted_article_not_imported');status=p.state}
    time(p.created_at,vendor==='zendesk'?'iso':'unix');const updated=time(p.updated_at,vendor==='zendesk'?'iso':'unix')
    tables.knowledge_articles=[{id:target,project_id:projectId,category_id:null,slug:`import-${vendor}-${record.sourceId.replace(/[^a-zA-Z0-9-]/g,'-')}-${target.slice(-8)}`,title:text(p.title,'article_title_required'),content:vendor==='intercom'&&typeof p.body_markdown==='string'?text(p.body_markdown,'article_body_required'):await htmlToMarkdown(text(p.body,'article_body_required')),summary:'',status,updated_at:updated,position:0,source_revision:1,source_incarnation:crypto.randomUUID()}]
    if(p.translated_content||p.section_id||p.parent_id||p.tags||p.scheduled_publish_at||p.scheduled_unpublish_at||p.ai_agent_availability)omissions.push('article_structure_or_translations_retained_in_original_only')
   }else{result.effects.set(key,[]);result.omissions.set(key,[`unsupported_record_kind:${record.kind}`]);continue}
   if(kind==='conversation')tables.email_threading_keys=importedEmailThreadKeys(projectId,target,vendor,record,tables.conversations[0].created_at)
   const value:NativeValue={tables,source:{vendor,kind:record.kind,id:record.sourceId,created_at:p.created_at??null,updated_at:p.updated_at??null}}
   if(nativeStatementCount(kind,value)>LIMITS.nativeStatements)throw new Error('native_record_statement_limit');result.effects.set(key,[{targetKind:kind,targetId:target,value:completeNativeValue(kind,value) as any}]);if(omissions.length)result.omissions.set(key,omissions)
  }catch(error){result.rejections.set(key,error instanceof Error?error.message:'record_mapping_failed');result.effects.set(key,[]);if(omissions.length)result.omissions.set(key,omissions)}
 }
 return result
}
