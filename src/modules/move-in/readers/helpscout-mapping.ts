import {importedEmailThreadKeys} from '../email-threading'
import type {SourceRecord} from '../../import-kit/src/types'
import type {MappingInput,PreparedMapping} from '../types'
import {LIMITS,recordKey} from '../types'
import {completeNativeValue,nativeStatementCount} from '../targets'
import {htmlToMarkdown} from '../../knowledge/importers'
import {nativeId,sourceId,tagKey,text,time,object} from './common'
import {auditShape,shapeReason} from './shapes'
import {helpScoutListIssues} from './helpscout-lists'
import {helpScoutHistory,helpScoutCustomer,helpScoutArticleStatus} from './helpscout-history'
import {closedAt} from './closed-state'
const markdown=async(body:string)=>/<[a-z][^>]*>/i.test(body)?htmlToMarkdown(body):body
export function helpScoutTags(record:SourceRecord):string[]{const p=record.payload as any;return record.kind==='tag'&&typeof p.name==='string'?[p.name]:Array.isArray(p.tags)?p.tags.filter((t:any)=>object(t)&&typeof t.tag==='string').map((t:any)=>t.tag):[]}
export async function prepareHelpScout({projectId,source,tagIds}:MappingInput):Promise<PreparedMapping>{
 const listIssues=helpScoutListIssues(source.records),conflicts=new Set(source.diagnostics.filter(d=>d.code==='conflicting_duplicate_id').map(d=>`${d.kind}/${d.sourceId}`))
 const result:PreparedMapping={known:new Set(),effects:new Map(),rejections:new Map(),omissions:new Map()},records=new Map(source.records.map(r=>[recordKey(r),r])),id=(kind:string,sid:string)=>nativeId(projectId,'helpscout',kind,sid)
 for(const record of source.records){const key=recordKey(record),p=record.payload as any,omissions:string[]=[],tables:Record<string,any[]>={};let kind=record.kind,target=id(kind,record.sourceId)
  for(const issue of auditShape('helpscout',record.kind,p).issues){omissions.push(shapeReason(issue));source.diagnostics.push({severity:'warning',code:issue.code,message:shapeReason(issue),kind:record.kind,sourceId:record.sourceId,location:{...record.location,pointer:`${record.location.pointer??''}${issue.path}`}})}
  try{
   if(listIssues.has(key))throw new Error(listIssues.get(key))
   if(kind==='tag-name'){kind='tag';target=tagIds.get(record.sourceId)??id('tag',record.sourceId);if(tagIds.has(record.sourceId)){result.effects.set(key,[]);result.omissions.set(key,['existing_workspace_tag_reused']);continue}tables.workspace_tags=[{id:target,project_id:projectId,name:p.name,normalized_name:record.sourceId}]}
   else if(kind==='contact'){const customer=helpScoutCustomer(p);tables.contacts=[{id:target,project_id:projectId,name:customer.name,email:customer.email,external_id:`import:helpscout:${record.sourceId}`,created_at:customer.created,is_verified:0,metadata_json:JSON.stringify({imported_tags:[]})}];tables.context_subjects=[{project_id:projectId,subject_id:target,consent:0,revision:0,help_types:'[]',bot_enabled:0}]}
   else if(kind==='conversation'){
    if(p.state!=='published')throw new Error('conversation_not_published');if(!['active','closed','pending','spam'].includes(p.status)||!['email','chat','phone'].includes(p.type))throw new Error('conversation_state_or_channel_unsupported')
    const contactSource=sourceId(p.primaryCustomer?.id,'helpscout'),contact=records.get(`contact/${contactSource}`)
    if(!contact)throw new Error('conversation_contact_unavailable');helpScoutCustomer(contact.payload)
    const created=time(p.createdAt,'iso'),updated=time(p.userUpdatedAt,'iso'),threads=helpScoutHistory(p,source.records,source.diagnostics),messages:any[]=[],notes:any[]=[],sources:any[]=[]
    for(const thread of threads){
     if(!['published','draft','bounced','hidden','review','underreview'].includes(thread.state))throw new Error('thread_state_unknown')
     if(thread.state!=='published'){omissions.push(`unsent_or_hidden_thread_not_imported:${thread.id}:${thread.state}`);continue}
     if(thread.type==='lineitem'){omissions.push(`thread_event_metadata_only:${thread.id}`);continue}
     if(!['customer','message','note','chat','beaconchat','phone'].includes(thread.type))throw new Error('thread_type_unsupported')
     if(thread.type==='customer'&&thread.customer?.type!==undefined&&thread.customer.type!=='customer')throw new Error('thread_customer_type_invalid')
     const person=thread.type==='customer'?{...(thread.customer??thread.createdBy),type:'customer'}:thread.createdBy
     if(!object(person)||!['customer','user','system_user'].includes(person.type))throw new Error('thread_author_required')
     const sid=sourceId(person.id,'helpscout'),role=person.type==='customer'?'contact':person.type==='user'?'operator':'system'
     if(role==='contact'&&sid!==contactSource)throw new Error('additional_thread_customer_unsupported')
     const author={id:sid,name:[person.first,person.last].filter(v=>typeof v==='string').join(' ')||null,role,type:person.type},when=time(thread.createdAt,'iso'),body=await markdown(text(thread.body,'thread_body_required')),messageId=id('message',`${record.sourceId}:${sourceId(thread.id,'helpscout')}`)
     if(thread.type==='note')notes.push({id:messageId,project_id:projectId,conversation_id:target,author_json:JSON.stringify(author),content:body,created_at:when,source_time:JSON.stringify(thread.createdAt)})
     else {messages.push({id:messageId,project_id:projectId,conversation_id:target,local_id:`import:${thread.id}`,actor_id:role==='contact'?id('contact',sid):`import:helpscout:${sid}`,actor_role:role,content:body,revision:messages.length+1,created_at:when,intent_hash:null,bucket_id:null,erased_at:null,citations_json:'[]'});sources.push({message_id:messageId,project_id:projectId,author_json:JSON.stringify(author),source_id:String(thread.id),source_time:JSON.stringify(thread.createdAt),time_provenance:'source'})}
     if(thread._embedded?.attachments?.length)omissions.push(`attachments_metadata_retained_bytes_not_imported:${thread.id}`)
     if(thread.savedReplyId)omissions.push(`saved_reply_reference_not_content:${thread.savedReplyId}`)
    }
    if(!messages.length)throw new Error('published_conversation_messages_required')
    tables.conversations=[{id:target,project_id:projectId,contact_id:id('contact',contactSource),revision:messages.length,last_message_id:messages.at(-1).id,assigned_to:null,resolved_at:['closed','spam'].includes(p.status)?closedAt([p.closedAt],p.userUpdatedAt,omissions):null,created_at:created,updated_at:updated}]
    tables.move_in_conversations=[{conversation_id:target,project_id:projectId,vendor:'helpscout',source_id:record.sourceId,subject:text(p.subject,'conversation_subject_required'),source_state:p.status,source_channel:p.type}]
    tables.messages=messages;tables.move_in_message_sources=sources;tables.move_in_notes=notes
    const names=helpScoutTags(record);if(names.some(name=>name.trim().length>80))throw new Error('tag_name_limit');tables.conversation_tags=[...new Set(names.map(tagKey))].map(name=>({project_id:projectId,conversation_id:target,tag_id:tagIds.get(name)??id('tag',name)}))
    omissions.push('historical_assignment_not_activated');if(p._embedded?.threads)omissions.push('embedded_threads_ignored_full_thread_pages_used')
   }else if(kind==='collection'||kind==='category'){
    if(!['public','private'].includes(p.visibility))throw new Error('category_visibility_unknown');const collection=kind==='category'?records.get(`collection/${sourceId(p.collectionId,'helpscout')}`)?.payload as any:null;if(kind==='category'&&(!collection||!['public','private'].includes(collection.visibility)||listIssues.has(`collection/${p.collectionId}`)||conflicts.has(`collection/${p.collectionId}`)))throw new Error('category_collection_unavailable');target=id('category',`${kind}:${record.sourceId}`);kind='category';tables.knowledge_categories=[{id:target,project_id:projectId,parent_id:collection?id('category',`collection:${p.collectionId}`):null,name:text(p.name,'category_name_required'),slug:`import-helpscout-${record.kind}-${target.slice(-16)}`,summary:typeof p.description==='string'?p.description:'',is_published:p.visibility==='public'&&(!collection||collection.visibility==='public')?1:0,position:Number.isSafeInteger(p.order)&&p.order>=0?p.order:0}];omissions.push('docs_collection_as_root_category_site_and_sort_metadata_retained');
   }else if(kind==='article'){
    for(const dependency of [`collection/${p.collectionId}`,...(Array.isArray(p.categories)?p.categories.map((id:any)=>`category/${id}`):[])])if(conflicts.has(dependency)||listIssues.has(dependency))throw new Error('article_ancestry_incomplete_or_conflicting');const status=helpScoutArticleStatus(p,records);time(p.createdAt,'iso');tables.knowledge_articles=[{id:target,project_id:projectId,category_id:id('category',p.categories.length?`category:${p.categories[0]}`:`collection:${p.collectionId}`),slug:`import-helpscout-${record.sourceId.replace(/[^a-zA-Z0-9-]/g,'-')}-${target.slice(-8)}`,title:text(p.name,'article_title_required'),content:await markdown(text(p.text,'article_body_required')),summary:'',status,updated_at:time(p.updatedAt,'iso'),position:0,source_revision:1,source_incarnation:crypto.randomUUID()}]
    tables.knowledge_article_categories=(p.categories.length?p.categories.map((category:any)=>id('category',`category:${category}`)):[id('category',`collection:${p.collectionId}`)]).map((category_id:string)=>({article_id:target,category_id}));if(p.hasDraft)omissions.push('article_draft_body_provenance_ambiguous_kept_unpublished');if(status==='draft'&&p.status==='published')omissions.push('private_ancestry_kept_unpublished')
   }else{result.effects.set(key,[]);result.omissions.set(key,[...omissions,kind==='article-ref'?'article_list_metadata_only_detail_body_required':kind==='article-draft'?'unpublished_draft_body_retained_only':`source_metadata_only:${kind}`]);continue}
   if(kind==='conversation')tables.email_threading_keys=importedEmailThreadKeys(projectId,target,'helpscout',record,tables.conversations[0].created_at,source.records.filter(r=>r.kind==='thread-page'&&r.sourceId.split(':')[0]===record.sourceId))
   const value={tables,source:{vendor:'helpscout',kind:record.kind,id:record.sourceId,created_at:p.createdAt??null,updated_at:p.updatedAt??p.userUpdatedAt??null}}
   if(nativeStatementCount(kind,value)>LIMITS.nativeStatements)throw new Error('native_record_statement_limit')
   result.effects.set(key,[{targetKind:kind,targetId:target,value:completeNativeValue(kind,value) as any}])
  }catch(error){result.rejections.set(key,error instanceof Error?error.message:'record_mapping_failed');result.effects.set(key,[])}
  if(omissions.length)result.omissions.set(key,omissions)
 }
 return result
}
