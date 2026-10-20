import type {Env} from '../../platform/env'
import type {SourceBundle,SourceRecord,TargetEffect} from '../import-kit/src/types'
import {htmlToMarkdown} from '../knowledge/importers'
import {apiRun} from './api-store'
import {LIMITS,recordKey,type PreparedMapping,type Run} from './types'
import {completeNativeValue,nativeStatementCount} from './targets'
import {nativeId,object,sourceId,text,time} from './readers/common'
import type {NativeValue} from './readers/normalise'

interface ApiFile {ticket_id:string;part_id:string;source_id:string;filename:string;content_type:string;size:number|null;private:number;object_key:string|null;error:string|null}
interface ApiAgent {source_id:string;member_id:string|null}
interface AttachmentPart {id:string;attachments:any[]}
interface CcReference {path:string;value:unknown;byId:boolean}
interface ContactIndex {ids:Map<string,Set<string>>;emails:Map<string,Set<string>>}
const array=(value:unknown):any[]=>Array.isArray(value)?value:[]
const address=(value:unknown)=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():null
const sourceValue=(run:Run,record:SourceRecord)=>{
 const p=record.payload as any
 return {vendor:run.vendor,kind:record.kind,id:record.sourceId,created_at:p.created_at??p.createdAt??null,updated_at:p.updated_at??p.updatedAt??null}
}
function addIndex(index:Map<string,Set<string>>,key:string,id:string){const matches=index.get(key)??new Set<string>();matches.add(id);index.set(key,matches)}
function importedContacts(source:SourceBundle,prepared:PreparedMapping):ContactIndex {
 const index:ContactIndex={ids:new Map(),emails:new Map()}
 for(const record of source.records){
  if(prepared.rejections.has(recordKey(record)))continue
  for(const effect of prepared.effects.get(recordKey(record))??[]){
   if(effect.targetKind!=='contact')continue
   for(const contact of (effect.value as unknown as NativeValue).tables.contacts??[]){
    addIndex(index.ids,record.sourceId,contact.id)
    const email=address(contact.email);if(email)addIndex(index.emails,email,contact.id)
   }
  }
 }
 return index
}
function attachmentParts(run:Run,record:SourceRecord,source:SourceBundle):AttachmentPart[]{
 const p=record.payload as any,part=(id:unknown,attachments:unknown)=>({id:String(id),attachments:array(attachments)})
 if(run.vendor==='zendesk')return [...array(p.comments).map(c=>part(c.id,c.attachments)),...(array(p.attachments).length?[part('ticket-metadata',p.attachments)]:[])]
 if(run.vendor==='freshdesk')return [part(`description:${record.sourceId}`,p.attachments),...array(p.conversations).map(c=>part(c.id,c.attachments))]
 if(run.vendor==='intercom')return [part(`source:${p.source?.id}`,p.source?.attachments),...array(p.conversation_parts?.conversation_parts).map(c=>part(c.id,c.attachments))]
 return source.records.filter(r=>r.kind==='thread-page'&&r.sourceId.split(':')[0]===record.sourceId).flatMap(r=>array((r.payload as any)?._embedded?.threads).map(t=>part(t.id,t._embedded?.attachments)))
}
function attachmentFailure(file:ApiFile,reason:string){
 const filename=file.filename.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160)
 return `Attachment ${JSON.stringify(filename)} was not imported: ${reason}.`
}
function markdownLabel(value:string){return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[\\`*_[\]<>!&]/g,char=>`&#${char.charCodeAt(0)};`)}

function enrichAttachments(run:Run,record:SourceRecord,source:SourceBundle,value:NativeValue,files:ApiFile[],omissions:string[]){
 const conversation=value.tables.conversations[0],messages=new Map((value.tables.messages??[]).map(row=>[row.id,row])),notes=new Map((value.tables.move_in_notes??[]).map(row=>[row.id,row])),imported=new Map<string,ApiFile[]>(),media=value.tables.media??[]
 for(const file of files){
  const messageId=nativeId(run.project_id,run.vendor,'message',`${record.sourceId}:${file.part_id}`),note=notes.get(messageId)
  let failure:string|null=null
  if(file.error)failure=/interrupted/i.test(file.error)?'the download was interrupted; resume the import':/size differs/i.test(file.error)?'the downloaded size differs from the source':/empty attachment/i.test(file.error)?'the provider returned an empty file':'the provider download failed; check the file in the source system'
  else if(!file.object_key||!Number.isSafeInteger(file.size)||(file.size??0)<1)failure='no successfully downloaded bytes are available'
  else if(file.private!==0&&file.private!==1)failure='source visibility is invalid'
  else if(file.private?!note:!messages.has(messageId))failure='its source message or private note was not imported'
  else if(!file.filename.trim()||!file.content_type.trim())failure='the source filename or content type is missing'
  if(failure){omissions.push(attachmentFailure(file,failure));continue}
  const id=nativeId(run.project_id,run.vendor,'media',`${record.sourceId}:${file.part_id}:${file.source_id}`)
  if(!media.some(row=>row.id===id))media.push({id,project_id:run.project_id,conversation_id:conversation.id,uploaded_by:run.actor_id,object_key:file.object_key,filename:file.filename,content_type:file.content_type,size:file.size,message_id:file.private?null:messageId,created_at:(note??messages.get(messageId))!.created_at})
  if(file.private&&note){
   const url=`/api/conversations/${encodeURIComponent(conversation.id)}/media/${encodeURIComponent(id)}`
   const link=`[${markdownLabel(file.filename)}](${url})`
   if(!note.content.includes(link))note.content+=`\n\n${link}`
  }
  const group=imported.get(file.part_id)??[];group.push(file);imported.set(file.part_id,group)
 }
 value.tables.media=media
 const parts=attachmentParts(run,record,source),complete=(part:AttachmentPart)=>{
  const importedFiles=imported.get(part.id)??[]
  // Intercom's attachment identity can be a locator removed from portable custody.
  // The run's download receipts still establish a complete per-part file count.
  return importedFiles.length===part.attachments.length&&part.attachments.every(a=>a.id==null?run.vendor==='intercom':importedFiles.some(file=>file.source_id===String(a.id)))
 }
 const allComplete=parts.every(complete)
 for(let i=omissions.length-1;i>=0;i--){
  const reason=omissions[i],prefix='attachments_metadata_retained_bytes_not_imported'
  if(reason===prefix&&allComplete&&files.length>0&&imported.size>0)omissions.splice(i,1)
  else if(reason.startsWith(`${prefix}:`)){
   const part=parts.find(p=>p.id===reason.slice(prefix.length+1))
   if(part&&part.attachments.length>0&&complete(part))omissions.splice(i,1)
  }
 }
 for(const part of parts)if(part.attachments.length&&!complete(part)){
  if(!files.some(file=>file.part_id===part.id))omissions.push(`Attachments for source part ${part.id} were not imported: no download receipt is available.`)
  if(!omissions.some(reason=>reason.startsWith('attachments_metadata_retained_bytes_not_imported')))omissions.push(`attachments_metadata_retained_bytes_not_imported:${part.id}`)
 }
}

function ccReferences(run:Run,record:SourceRecord,source:SourceBundle,value:NativeValue):CcReference[]{
 const p=record.payload as any,refs:CcReference[]=[],add=(path:string,values:unknown,byId=false)=>{
  if(values==null)return
  if(!Array.isArray(values)){refs.push({path,value:values,byId});return}
  values.forEach((value,index)=>refs.push({path:`${path}[${index}]`,value,byId}))
 }
 if(run.vendor==='zendesk'){
  add('collaborator_ids',p.collaborator_ids,true);add('email_cc_ids',p.email_cc_ids,true);add('email_ccs',p.email_ccs)
 }else if(run.vendor==='freshdesk'){
  for(const key of ['cc_emails','reply_cc_emails','ticket_cc_emails'])add(key,p[key])
  for(const part of array(p.conversations))if(part.private===false)add(`conversations/${part.id}/cc_emails`,part.cc_emails)
 }else if(run.vendor==='helpscout'){
  add('cc',p.cc)
  const messages=new Set((value.tables.messages??[]).map(row=>row.id))
  for(const page of source.records.filter(r=>r.kind==='thread-page'&&r.sourceId.split(':')[0]===record.sourceId))for(const thread of array((page.payload as any)?._embedded?.threads))if(messages.has(nativeId(run.project_id,run.vendor,'message',`${record.sourceId}:${thread.id}`)))add(`threads/${thread.id}/cc`,thread.cc)
 }else{
  // Only explicitly named CC fields count; contacts and authors are not CC proof.
  add('cc',p.cc);add('cc_emails',p.cc_emails);add('source/cc',p.source?.cc)
 }
 return refs
}
function enrichParticipants(run:Run,record:SourceRecord,source:SourceBundle,value:NativeValue,contacts:ContactIndex,omissions:string[]){
 const conversation=value.tables.conversations[0],rows=value.tables.conversation_participants??[]
 for(const ref of ccReferences(run,record,source,value)){
  const v=ref.value,person=object(v)?v:null,id=person?(person.contact_id??person.customer_id??person.user_id??person.id):ref.byId?v:null,email=address(person?(person.email??person.address??person.user_email??person.value):ref.byId?null:v),matches=new Set<string>()
  if(typeof id==='string'||typeof id==='number')for(const contact of contacts.ids.get(String(id))??[])matches.add(contact)
  if(email)for(const contact of contacts.emails.get(email)??[])matches.add(contact)
  if(matches.size!==1){omissions.push(`CC recipient at ${ref.path} was not imported: ${matches.size?'source identity matches multiple imported contacts':'no matching imported contact is available'}.`);continue}
  const contactId=[...matches][0]
  if(contactId===conversation.contact_id||rows.some(row=>row.contact_id===contactId))continue
  rows.push({id:nativeId(run.project_id,run.vendor,'participant',`${record.sourceId}:${contactId}`),conversation_id:conversation.id,contact_id:contactId,created_at:conversation.created_at,joined_via:'cc_header'})
 }
 value.tables.conversation_participants=rows
}
function enrichAssignment(run:Run,record:SourceRecord,value:NativeValue,agents:Map<string,string|null>){
 const p=record.payload as any,sourceAgent=run.vendor==='zendesk'?p.assignee_id:run.vendor==='intercom'?p.admin_assignee_id:run.vendor==='helpscout'?p.assignee?.id:p.responder_id
 if(sourceAgent!=null&&typeof sourceAgent!=='string'&&typeof sourceAgent!=='number')throw new Error('source_assignment_invalid')
 const agentId=sourceAgent==null?null:sourceId(sourceAgent,run.vendor)
 value.tables.move_in_assignment=[{conversation_id:value.tables.conversations[0].id,project_id:run.project_id,vendor:run.vendor,source_agent_id:agentId,member_id:agentId===null?null:agents.get(agentId)??null}]
 value.tables.conversations[0].assigned_to=null
}

function companyEffect(run:Run,record:SourceRecord):TargetEffect {
 const p=record.payload as any,id=nativeId(run.project_id,run.vendor,'company',record.sourceId),timestamp=p.created_at??p.createdAt??p.updated_at??p.updatedAt,occurred=timestamp==null?run.created_at:time(timestamp,run.vendor==='intercom'?'unix':'iso')
 const value:NativeValue={source:sourceValue(run,record),tables:{context_subjects:[{project_id:run.project_id,subject_id:id,consent:0,revision:1,help_types:'[]',bot_enabled:0}],context_evidence:[{id,project_id:run.project_id,subject_id:id,source:`import:${run.vendor}:company`,content:JSON.stringify(record.payload),visibility:'private',occurred_at:occurred}]}}
 return {targetKind:'company',targetId:id,value:completeNativeValue('company',value) as any}
}
function freshdeskPublicAudience(p:any,records:Map<string,SourceRecord>){
 const explicitlyPublic=(row:any)=>row&&(row.visibility===1||row.visibility==='public')&&![row.company_ids,row.contact_segment_ids,row.company_segment_ids].some(v=>v!=null&&(!Array.isArray(v)||v.length>0))
 const category=records.get(`category/${p.category_id}`)?.payload as any
 if(!explicitlyPublic(category))return false
 let folderId=p.folder_id;const seen=new Set<string>()
 while(folderId!=null){
  if(seen.has(String(folderId)))return false;seen.add(String(folderId))
  const folder=records.get(`folder/${folderId}`)?.payload as any
  if(!explicitlyPublic(folder)||folder.category_id==null||String(folder.category_id)!==String(p.category_id))return false
  if(!Object.hasOwn(folder,'parent_folder_id'))return false
  folderId=folder.parent_folder_id
 }
 return seen.size>0
}
async function freshdeskArticle(run:Run,record:SourceRecord,records:Map<string,SourceRecord>,omissions:string[]):Promise<TargetEffect>{
 const p=record.payload as any,id=nativeId(run.project_id,run.vendor,'article',record.sourceId)
 if(p.status!==1&&p.status!==2)throw new Error('article_publication_required')
 time(p.created_at,'iso');const updated=time(p.updated_at,'iso'),audience=freshdeskPublicAudience(p,records),raw=typeof p.description==='string'&&p.description.trim()?text(p.description,'article_body_required'):text(p.description_text,'article_body_required'),content=/<[a-z][^>]*>/i.test(raw)?await htmlToMarkdown(raw):raw
 if(!audience)omissions.push('Article kept as a draft: the supplied folder and category records do not establish a completely public audience.')
 const value:NativeValue={source:sourceValue(run,record),tables:{knowledge_articles:[{id,project_id:run.project_id,category_id:null,slug:`import-freshdesk-${record.sourceId.replace(/[^a-zA-Z0-9-]/g,'-')}-${id.slice(-8)}`,title:text(p.title,'article_title_required'),content,summary:'',status:p.status===2&&audience?'published':'draft',updated_at:updated,position:0,source_revision:1,source_incarnation:crypto.randomUUID()}]}}
 return {targetKind:'article',targetId:id,value:completeNativeValue('article',value) as any}
}

/** Enrich inert mapping effects only; downloads and activation remain separate steps. */
export async function enrichApiMapping(env:Env,run:Run,source:SourceBundle,prepared:PreparedMapping):Promise<void>{
 if(!await apiRun(env,run.id))return
 const [fileRows,agentRows]=await Promise.all([
  env.DB.prepare('SELECT ticket_id,part_id,source_id,filename,content_type,size,private,object_key,error FROM move_in_api_files WHERE run_id=? ORDER BY ticket_id,part_id,source_id').bind(run.id).all<ApiFile>(),
  env.DB.prepare('SELECT source_id,member_id FROM move_in_api_agents WHERE run_id=?').bind(run.id).all<ApiAgent>()
 ])
 const conflicts=new Set(source.diagnostics.filter(d=>d.code==='conflicting_duplicate_id').map(d=>`${d.kind}/${d.sourceId}`))
 const files=new Map<string,ApiFile[]>(),agents=new Map(agentRows.results.map(row=>[row.source_id,row.member_id])),contacts=importedContacts(source,prepared),records=new Map(source.records.filter(record=>!prepared.rejections.has(recordKey(record))&&!conflicts.has(recordKey(record))).map(record=>[recordKey(record),record]))
 // Existing unverified CC contacts can be reused without fetching a directory
 // profile in a delta. Index exactly the participants prepared for this source.
 const participantIds=[...new Set([...prepared.effects.values()].flatMap(effects=>effects.flatMap(effect=>((effect.value as any).tables.conversation_participants??[]).map((row:any)=>row.contact_id))))]
 if(participantIds.length)for(const row of (await env.DB.prepare('SELECT id,email FROM contacts WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(run.project_id,JSON.stringify(participantIds)).all<{id:string;email:string|null}>()).results){const email=address(row.email);if(email)addIndex(contacts.emails,email,row.id)}
 for(const file of fileRows.results){const group=files.get(file.ticket_id)??[];group.push(file);files.set(file.ticket_id,group)}
 for(const record of source.records){
  const key=recordKey(record),omissions=[...(prepared.omissions.get(key)??[])],existing=prepared.effects.get(key)??[]
  // Existing mapper rejections, conflicts and other imported targets retain authority.
  if(prepared.rejections.has(key)||prepared.known.has(key))continue
  try{
   let effects=existing
   if(record.kind==='company'&&!effects.length){effects=[companyEffect(run,record)];removeMetadataOmission(omissions,record.kind);const p=record.payload as any;if((p.created_at??p.createdAt??p.updated_at??p.updatedAt)==null)omissions.push('Company context is dated when fetched; the source API supplies no original company timestamp.')}
   else if(run.vendor==='freshdesk'&&record.kind==='article'&&!effects.length){effects=[await freshdeskArticle(run,record,records,omissions)];removeMetadataOmission(omissions,record.kind)}
   for(const effect of effects){
    const value=effect.value as unknown as NativeValue
    if(effect.targetKind==='conversation'){
     enrichAttachments(run,record,source,value,files.get(record.sourceId)??[],omissions)
     enrichAssignment(run,record,value,agents)
     enrichParticipants(run,record,source,value,contacts,omissions)
    }
    if(nativeStatementCount(effect.targetKind,value)>LIMITS.nativeStatements)throw new Error('native_record_statement_limit')
    effect.value=completeNativeValue(effect.targetKind,value) as any
   }
   prepared.effects.set(key,effects)
  }catch(error){prepared.effects.set(key,[]);prepared.rejections.set(key,error instanceof Error?error.message:'api_enrichment_failed')}
  if(omissions.length)prepared.omissions.set(key,[...new Set(omissions)]);else prepared.omissions.delete(key)
 }
}
function removeMetadataOmission(omissions:string[],kind:string){
 for(let i=omissions.length-1;i>=0;i--)if([`unsupported_record_kind:${kind}`,`source_metadata_only:${kind}`,'unsupported_source_field:'].includes(omissions[i]))omissions.splice(i,1)
}
