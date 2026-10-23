import type {Vendor} from '../types'
import {object,sourceId} from './common'

export class AttachmentReferenceError extends Error {}
export interface AttachmentReference {conversation:string;message:string;private:boolean;occurrence:string;sourceAttachmentId:string|null;filename:unknown;contentType:unknown;sizes:unknown[];unavailable:boolean}
export const attachmentMember=(conversation:string,occurrence:string)=>`attachments/${encodeURIComponent(conversation)}/${encodeURIComponent(occurrence)}`
export const isAttachmentMember=(name:string)=>/^attachments\/[^/]+\/[^/]+$/.test(name)

/** Only documented attachment containers are interpreted. Body text and URLs
 * never choose a member or cause a download. Private and unpublished history
 * remain distinct from customer-visible messages. */
export function attachmentReferences(vendor:Vendor,kind:string,p:any):AttachmentReference[]{
 const result:AttachmentReference[]=[]
 const id=(value:unknown)=>{try{return sourceId(value,vendor)}catch{throw new AttachmentReferenceError('attachment_source_id_invalid')}}
 const add=(conversation:unknown,message:unknown,privateNote:boolean,values:unknown)=>{
  if(values==null)return
  if(!Array.isArray(values))throw new AttachmentReferenceError('attachment_list_required')
  for(const [position,value] of values.entries()){
   if(!object(value))throw new AttachmentReferenceError('attachment_metadata_required')
   const parent=String(message)
   // Intercom documents no attachment ID. Parent + array position identifies a
   // source occurrence, not a fabricated provider identity or a shared file.
   result.push({conversation:id(conversation),message:parent,private:privateNote,occurrence:`${parent}:${position}`,sourceAttachmentId:vendor==='intercom'?null:id(value.id),filename:value.file_name??value.filename??value.name,contentType:value.content_type??value.contentType??value.mimeType,sizes:[value.size,value.file_size,value.filesize].filter(size=>size!==undefined),unavailable:value.deleted===true||value.state==='virus'||value.malware_scan_result==='malware_found'})
  }
 }
 if(vendor==='zendesk'&&kind==='ticket')for(const part of Array.isArray(p.comments)?p.comments:[])add(p.id,part.id,part.public===false,part.attachments)
 if(vendor==='freshdesk'&&kind==='ticket'){
  add(p.id,`description:${p.id}`,false,p.attachments)
  for(const part of Array.isArray(p.conversations)?p.conversations:[])add(p.id,part.id,part.private===true,part.attachments)
 }
 if(vendor==='intercom'&&kind==='conversation'){
  if(object(p.source))add(p.id,`source:${p.source.id}`,false,p.source.attachments)
  for(const part of Array.isArray(p.conversation_parts?.conversation_parts)?p.conversation_parts.conversation_parts:[])if(['comment','note'].includes(part.part_type))add(p.id,part.id,part.part_type==='note',part.attachments)
 }
 if(vendor==='helpscout'&&kind==='thread-page'){
  const conversation=typeof p._links?.self?.href==='string'?p._links.self.href.match(/\/v2\/conversations\/([1-9][0-9]*)\/threads(?:[?#]|$)/)?.[1]:null
  for(const part of Array.isArray(p._embedded?.threads)?p._embedded.threads:[])if(part.state==='published')add(conversation,part.id,part.type==='note',part._embedded?.attachments)
 }
 return result
}
