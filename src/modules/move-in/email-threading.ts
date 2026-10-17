import type {SourceRecord} from '../import-kit/src/types'
import {headerThreadKeys,messageIds,subjectThreadKeys,threadAddresses,type ThreadKey} from '../integrations/email-threading-keys'
import type {Vendor} from './types'
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value)
/** Read explicit export fields only: never scan message bodies or activate vendor
 * reply addresses. Source paths remain visible in the portable import journal. */
export function importedEmailThreadKeys(projectId:string,conversationId:string,vendor:Vendor,record:SourceRecord,createdAt:number,pages:SourceRecord[]=[]){
 const p=record.payload as any,keys:ThreadKey[]=[]
 const origin=(source:SourceRecord,path:string)=>JSON.stringify({artifact:source.location?.artifact??null,pointer:`${source.location?.pointer??''}${path}`,sourceId:source.sourceId})
 const before=()=>keys.length
 const locate=(start:number,source:SourceRecord)=>{for(let index=start;index<keys.length;index++)keys[index].sourceRef=origin(source,keys[index].sourceRef)}
 const add=(value:any,path:string)=>{
  if(!object(value))return
  for(const field of ['headers','email_headers'])keys.push(...headerThreadKeys(value[field],vendor,`${path}/${field}`))
  for(const field of ['message_id','messageId','in_reply_to','inReplyTo','references'])for(const valueId of messageIds(value[field]))keys.push({kind:'message_id',value:valueId,source:vendor,sourceRef:`${path}/${field}`})
  for(const field of ['reply_to','replyTo','reply_to_email'])for(const address of threadAddresses(value[field]))keys.push({kind:'reply_address',value:address,source:vendor,sourceRef:`${path}/${field}`})
  for(const field of ['subject','title'])for(const key of subjectThreadKeys(value[field]))if(key.source===vendor)keys.push({...key,source:vendor,sourceRef:`${path}/${field}`})
 }
 const opening=before();add(p,'');add(p.source,'/source');add(p.source_additional_info,'/source_additional_info');add(p.via?.source,'/via/source');locate(opening,record)
 const children=vendor==='zendesk'?p.comments:vendor==='freshdesk'?p.conversations:vendor==='intercom'?p.conversation_parts?.conversation_parts:[]
 const rows:{part:any;path:string;source:SourceRecord}[]=(Array.isArray(children)?children:[]).map((part,index)=>({part,path:`/${vendor==='zendesk'?'comments':vendor==='freshdesk'?'conversations':'conversation_parts/conversation_parts'}/${index}`,source:record}))
 if(vendor==='helpscout')for(const page of pages)for(const [index,part] of ((page.payload as any)._embedded?.threads??[]).entries())rows.push({part,path:`/_embedded/threads/${index}`,source:page})
 for(const {part,path,source} of rows){
  // Private, hidden and unsent records cannot add a customer-facing route.
  if(part?.public===false||part?.private===true||part?.part_type==='note'||part?.type==='note'||part?.state&&part.state!=='published')continue
  const start=before();add(part,path);add(part?.source,`${path}/source`);add(part?.source_additional_info,`${path}/source_additional_info`);add(part?.via?.source,`${path}/via/source`);add(part?.metadata?.system,`${path}/metadata/system`);locate(start,source)
 }
 const identifiers=before()
 const header=vendor==='zendesk'?'x-zendesk-ticket-id':vendor==='freshdesk'?'x-freshdesk-ticket-id':vendor==='helpscout'?'x-hs-conversation-id':'x-intercom-conversation-id'
 keys.push({kind:'vendor_header',value:`${header}:${record.sourceId}`,source:vendor,sourceRef:'/id'})
 if(vendor==='helpscout')keys.push({kind:'vendor_header',value:`x-helpscout-conversation-id:${record.sourceId}`,source:vendor,sourceRef:'/id'})
 if(vendor==='intercom')keys.push({kind:'vendor_header',value:`x-intercom-conversation:${record.sourceId}`,source:vendor,sourceRef:'/id'})
 if(vendor==='freshdesk'&&/^[1-9][0-9]{0,19}$/.test(record.sourceId))keys.push({kind:'subject_token',value:`freshdesk:${record.sourceId}`,source:vendor,sourceRef:'/id'})
 locate(identifiers,record)
 const unique=[...new Map(keys.map(key=>[`${key.kind}:${key.value}`,key])).values()]
 if(unique.length>500)throw new Error('email_threading_key_limit')
 return unique.map(key=>({project_id:projectId,conversation_id:conversationId,key_kind:key.kind,key_value:key.value,source:key.source,source_ref:key.sourceRef,created_at:createdAt}))
}
