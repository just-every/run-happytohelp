import type {MappingInput,PreparedMapping} from '../types'
import {recordKey} from '../types'
import {nativeId,time} from './common'
import {completeNativeValue} from '../targets'
import {suppliedAttachments} from '../supplied-attachments'
import {noRequesterId} from '../../customers/no-requester'

/** Customer senders are inert contacts. Historical mailbox messages are never
 * native admissions: only the reviewed import journal writes these rows. */
export async function prepareMailbox({projectId,source,tagIds}:MappingInput):Promise<PreparedMapping>{
 const result:PreparedMapping={known:new Set(),effects:new Map(),rejections:new Map(),omissions:new Map()},people=new Map(source.records.filter(r=>r.kind==='contact').map(r=>[r.sourceId,r.payload as any])),id=(kind:string,sid:string)=>nativeId(projectId,'mailbox',kind,sid)
 for(const record of source.records){const p=record.payload as any,key=recordKey(record),tables:Record<string,any[]>={};let kind=record.kind,target=id(kind,record.sourceId)
  try{
   if(kind==='tag-name'){kind='tag';target=tagIds.get(record.sourceId)||id('tag',record.sourceId);if(tagIds.has(record.sourceId)){result.effects.set(key,[]);continue}tables.workspace_tags=[{id:target,project_id:projectId,name:p.name,normalized_name:record.sourceId}]}
   else if(kind==='contact'){
    tables.contacts=[{id:target,project_id:projectId,name:p.name,email:p.email,external_id:`import:mailbox:${record.sourceId}`,created_at:0,is_verified:0,metadata_json:'{"mailbox_history":true}'}]
    tables.context_subjects=[{project_id:projectId,subject_id:target,consent:0,revision:0,help_types:'[]',bot_enabled:0}]
   }else if(kind==='conversation'){
    if(!Array.isArray(p.messages)||!p.messages.length)throw new Error('mailbox_history_messages_required')
    const created=time(p.messages[0].created_at,'iso'),updated=time(p.messages.at(-1).created_at,'iso')
    tables.messages=[];tables.move_in_message_sources=[];tables.media=[];tables.move_in_attachment_bytes=[]
    for(const [index,m] of p.messages.entries()){
     const teamReply=m.sender_id===null,person=people.get(m.sender_id)
     if(!teamReply&&!person)throw new Error('mailbox_history_sender_missing')
     const mid=id('message',m.id),when=time(m.created_at,'iso')
     const actorId=teamReply?id('team',p.mailbox):id('contact',m.sender_id)
     const author=teamReply?{id:actorId,name:'Unknown source author',role:'operator'}:{id:m.sender_id,name:person.name,email:person.email,role:'contact'}
     tables.messages.push({id:mid,project_id:projectId,conversation_id:target,local_id:`import:${m.id}`,actor_id:actorId,actor_role:author.role,content:m.content,revision:index+1,created_at:when,citations_json:'[]'})
     tables.move_in_message_sources.push({message_id:mid,project_id:projectId,author_json:JSON.stringify(author),source_id:m.id,source_time:JSON.stringify(m.created_at),time_provenance:'source'})
     suppliedAttachments({vendor:'mailbox',attachments:m.attachments,projectId,conversationId:target,messageId:mid,visible:true,when,tables,omissions:[]})
    }
    tables.conversations=[{id:target,project_id:projectId,contact_id:p.requester_id===null?noRequesterId(projectId):id('contact',p.requester_id),revision:p.messages.length,last_message_id:tables.messages.at(-1).id,assigned_to:null,resolved_at:updated,created_at:created,updated_at:updated}]
    tables.move_in_conversations=[{conversation_id:target,project_id:projectId,vendor:'mailbox',source_id:record.sourceId,subject:p.subject,source_state:'closed',source_channel:'email'}]
    tables.conversation_tags=(p.tags||[]).map((name:string)=>({project_id:projectId,conversation_id:target,tag_id:tagIds.get(name.toLowerCase())||id('tag',name.toLowerCase())}))
   }else throw new Error('unsupported_mailbox_history_record')
   result.effects.set(key,[{targetKind:kind,targetId:target,value:completeNativeValue(kind,{tables,source:{vendor:'mailbox',kind:record.kind,id:record.sourceId,provider:p.provider??null,mailbox:p.mailbox??null}}) as any}])
  }catch(error){result.effects.set(key,[]);result.rejections.set(key,error instanceof Error?error.message:'mailbox_history_mapping_failed')}
 }
 return result
}
