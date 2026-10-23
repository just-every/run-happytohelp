import {sourceCompany,contactCompany} from './companies'
import {sourceGroup} from './groups'
import {sourceOwnership} from '../source-ownership'
import {importedEmailThreadKeys} from '../email-threading'
import type {SourceRecord} from '../../import-kit/src/types'
import type {MappingInput,PreparedMapping} from '../types'
import {LIMITS,recordKey} from '../types'
import {completeNativeValue,nativeStatementCount} from '../targets'
import {htmlToMarkdown} from '../../knowledge/importers'
import {nativeId,object,sourceId,tagKey,text,time} from './common'
import {auditShape,shapeReason} from './shapes'
import {closedAt} from './closed-state'

// Freshdesk API v2 numeric codes (https://developers.freshdesk.com/api/#tickets).
const statuses:Record<number,string>={2:'open',3:'pending',4:'resolved',5:'closed'}
const channels:Record<number,string>={1:'email',2:'portal',3:'phone',7:'chat',9:'feedback_widget',10:'outbound_email'}
const email=(value:unknown)=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:null
const array=(value:unknown):any[]=>Array.isArray(value)?value:[]
const body=async(html:unknown,plain:unknown,label:string)=>typeof html==='string'&&html.trim()?/<[a-z][^>]*>/i.test(html)?htmlToMarkdown(html):html:text(plain,label)
export function freshdeskTags(record:SourceRecord):string[]{return array((record.payload as any)?.tags).filter(v=>typeof v==='string'&&v.trim())}

/** Tickets keep their description as the first message and every conversation after it: public
 * replies become messages, private notes stay notes. People are Freshdesk contacts (customers)
 * or agents (historical staff, never given access). Nothing is sent, assigned or activated. */
export async function prepareFreshdesk({projectId,actorId,importedAt,source,tagIds}:MappingInput):Promise<PreparedMapping>{
 const result:PreparedMapping={known:new Set(),effects:new Map(),rejections:new Map(),omissions:new Map()},records=new Map(source.records.map(r=>[recordKey(r),r])),id=(kind:string,sid:string)=>nativeId(projectId,'freshdesk',kind,sid)
 const person=(userId:unknown)=>{const sid=sourceId(userId,'freshdesk'),contact=records.get(`contact/${sid}`)?.payload as any,agent=records.get(`agent/${sid}`)?.payload as any
  if(contact)return {id:sid,name:typeof contact.name==='string'?contact.name:null,role:'contact'}
  if(agent)return {id:sid,name:typeof agent.contact?.name==='string'?agent.contact.name:null,role:'operator'}
  throw new Error('conversation_author_unknown')}
 for(const record of source.records){const key=recordKey(record),p=record.payload as any,issues=auditShape('freshdesk',record.kind,p).issues.filter(issue=>issue.reason!=='record_kind_not_understood'),omissions:string[]=issues.map(shapeReason),tables:Record<string,any[]>={};let kind=record.kind,target=id(kind,record.sourceId)
  for(const issue of issues)source.diagnostics.push({severity:'warning',code:issue.code,message:shapeReason(issue),kind:record.kind,sourceId:record.sourceId,location:{...record.location,pointer:`${record.location.pointer??''}/${record.kind}${issue.path}`}})
  try{
   const common=sourceCompany(record,projectId,importedAt,omissions)??sourceGroup(record,projectId,importedAt,omissions)
   if(common){kind=common.kind;target=common.target;Object.assign(tables,common.tables)}
   else if(kind==='tag-name'){kind='tag';target=tagIds.get(record.sourceId)??id('tag',record.sourceId);if(tagIds.has(record.sourceId)){result.effects.set(key,[]);result.omissions.set(key,['existing_workspace_tag_reused']);continue}tables.workspace_tags=[{id:target,project_id:projectId,name:p.name,normalized_name:record.sourceId}]}
   else if(kind==='agent'){result.effects.set(key,[]);result.omissions.set(key,[...omissions,'historical_staff_retained_as_authors_no_access_created']);continue}
   else if(kind==='contact'){
    if(p.deleted===true)throw new Error('deleted_contact_not_imported')
    const address=email(p.email);if(!address)throw new Error('contact_email_missing_or_invalid')
    tables.contacts=[{id:target,project_id:projectId,name:text(p.name,'contact_name_required',500),email:address,external_id:`import:freshdesk:${record.sourceId}`,created_at:time(p.created_at,'iso'),is_verified:0,metadata_json:JSON.stringify({imported_tags:[...new Set(freshdeskTags(record))]})}]
    tables.context_subjects=[{project_id:projectId,subject_id:target,consent:0,revision:0,help_types:'[]',bot_enabled:0}]
    if(array(p.other_emails).length)omissions.push('additional_emails_retained_in_original_only')
    if(p.unique_external_id!=null)omissions.push('external_identity_retained_in_original_only')
   }else if(kind==='ticket'){
    kind='conversation';target=id(kind,record.sourceId)
    if(p.deleted===true)throw new Error('deleted_ticket_not_imported')
    if(!Number.isSafeInteger(p.status)||p.status<2)throw new Error('conversation_state_unsupported')
    if(!Number.isSafeInteger(p.source))throw new Error('conversation_source_channel_invalid')
    if(!Array.isArray(p.conversations))throw new Error('ticket_conversations_required')
    const created=time(p.created_at,'iso'),updated=time(p.updated_at,'iso'),contactSource=sourceId(p.requester_id,'freshdesk'),contact=records.get(`contact/${contactSource}`)
    if(!contact||!email((contact.payload as any).email))throw new Error('conversation_contact_unavailable')
    const rows:any[]=[],notes:any[]=[],sources:any[]=[],seen=new Set<string>()
    const add=(sid:string,content:string,visible:boolean,when:number,author:Record<string,unknown>,actor:string,original:unknown)=>{
     if(seen.has(sid))throw new Error('duplicate_message_id');seen.add(sid);const messageId=id('message',`${record.sourceId}:${sid}`)
     if(!visible){notes.push({id:messageId,project_id:projectId,conversation_id:target,author_json:JSON.stringify(author),content,created_at:when,source_time:JSON.stringify(original)});return}
     rows.push({id:messageId,project_id:projectId,conversation_id:target,local_id:`import:${sid}`,actor_id:actor,actor_role:author.role,content,revision:rows.length+1,created_at:when,intent_hash:null,bucket_id:null,erased_at:null,citations_json:'[]'})
     sources.push({message_id:messageId,project_id:projectId,author_json:JSON.stringify(author),source_id:sid,source_time:JSON.stringify(original),time_provenance:'source'})
    }
    // The description is the ticket's opening message, written when the ticket was created. An outbound
    // email is written by an agent Freshdesk does not record, so its author stays unknown.
    const outbound=p.source===10,opening=outbound?{id:null,name:null,role:'operator',unrecorded:true}:{...person(p.requester_id),role:'contact'}
    add(`description:${record.sourceId}`,await body(p.description,p.description_text,'ticket_description_required'),true,created,opening,outbound?'import:freshdesk:unrecorded-agent':id('contact',contactSource),p.created_at)
    if(outbound)omissions.push('outbound_first_message_author_unrecorded')
    for(const part of p.conversations){
     if(!object(part)||typeof part.private!=='boolean')throw new Error('conversation_visibility_required')
     const author=person(part.user_id),sid=sourceId(part.id,'freshdesk')
     add(sid,await body(part.body,part.body_text,'message_body_missing'),!part.private,time(part.created_at,'iso'),author,author.role==='contact'?id('contact',author.id):`import:freshdesk:${author.id}`,part.created_at)
    }
    if(array(p.attachments).length||p.conversations.some((part:any)=>array(part.attachments).length))omissions.push('attachments_metadata_retained_bytes_not_imported')
    rows.sort((a,b)=>a.created_at-b.created_at||a.local_id.localeCompare(b.local_id));rows.forEach((row,index)=>{row.revision=index+1})
    const state=statuses[p.status]??`custom_status:${p.status}`,closed=p.status===4||p.status===5||p.spam===true
    const resolved=closed?closedAt([p.stats?.closed_at,p.stats?.resolved_at],p.updated_at,omissions):null
    tables.conversations=[{id:target,project_id:projectId,contact_id:id('contact',contactSource),revision:rows.length,last_message_id:rows.at(-1)?.id??null,assigned_to:null,resolved_at:resolved,created_at:created,updated_at:updated}]
    tables.move_in_conversations=[{conversation_id:target,project_id:projectId,vendor:'freshdesk',source_id:record.sourceId,subject:typeof p.subject==='string'?p.subject:'',source_state:p.spam===true?'spam':state,source_channel:channels[p.source]??`source:${p.source}`}]
    tables.messages=rows;tables.move_in_message_sources=sources;tables.move_in_notes=notes
    const names=freshdeskTags(record);if(names.some(name=>name.trim().length>80))throw new Error('tag_name_limit')
    tables.conversation_tags=[...new Set(names.map(tagKey))].map(name=>({project_id:projectId,conversation_id:target,tag_id:tagIds.get(name)??id('tag',name)}))
    if(p.responder_id!=null||p.group_id!=null)omissions.push('historical_assignment_not_activated')
   }else if(kind==='canned_response'){
    kind='macro';target=id(kind,record.sourceId)
    if(p.visibility!==0)throw new Error('restricted_macro_not_imported')
    const representations=[p.content_html,p.content]
    if(representations.some(value=>typeof value==='string'&&/\{\{|\{%/.test(value)))throw new Error('macro_placeholders_not_supported')
    tables.macros=[{id:target,project_id:projectId,title:text(p.title,'macro_title_required'),content:await body(p.content_html,p.content,'macro_body_required'),created_by:actorId,created_at:time(p.created_at,'iso'),updated_at:time(p.updated_at,'iso')}]
    if(array(p.attachments).length)omissions.push('attachments_metadata_retained_bytes_not_imported')
   }else{result.effects.set(key,[]);result.omissions.set(key,[...omissions,`unsupported_record_kind:${kind}`]);continue}
   if(kind==='contact')tables.contact_companies=contactCompany(record,projectId,records,target,omissions)
   if(kind==='conversation')tables.email_threading_keys=importedEmailThreadKeys(projectId,target,'freshdesk',record,tables.conversations[0].created_at)
   const value={tables,source:{vendor:'freshdesk',kind:record.kind,id:record.sourceId,...(kind==='conversation'?{ownership:sourceOwnership('freshdesk',p)}:{}),created_at:p.created_at??null,updated_at:p.updated_at??null,...(common&&'nativeCreatedAt' in common?{nativeCreatedAt:common.nativeCreatedAt}:{})}}
   if(nativeStatementCount(kind,value)>LIMITS.nativeStatements)throw new Error('native_record_statement_limit')
   result.effects.set(key,[{targetKind:kind,targetId:target,value:completeNativeValue(kind,value) as any}])
  }catch(error){result.rejections.set(key,error instanceof Error?error.message:'record_mapping_failed');result.effects.set(key,[])}
  if(omissions.length)result.omissions.set(key,omissions)
 }
 return result
}
