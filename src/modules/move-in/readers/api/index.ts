import type {ApiClient,ApiCursor,ApiPage,ApiRecord,ApiVendor,Task} from './types'
import {zendesk} from './zendesk'
import {intercom} from './intercom'
import {freshdesk} from './freshdesk'
import {helpscout} from './helpscout'
export type {ApiClient,ApiCursor,ApiPage,ApiRecord,ApiAttachment,SourceAgent,ApiVendor} from './types'
const readers={zendesk,intercom,freshdesk,helpscout}
function recordId(record:ApiRecord):string{
 if(record.kind==='thread-page'){
  const p=record.payload,url=new URL(p._links?.self?.href),match=url.pathname.match(/^\/v2\/conversations\/([^/]+)\/threads$/)
  if(!match||!Number.isInteger(p.page?.number))throw new Error('helpscout_thread_page_identity_invalid')
  return `${match[1]}:${p.page.number}`
 }
 if(record.payload?.id==null)throw new Error(`api_record_id_missing:${record.kind}`)
 return String(record.payload.id)
}
/** The caller atomically persists the returned page with its cursor. Pending work
 * contains vendor IDs, not a moving offset within an already fetched list page.
 * A thrown request leaves the caller's input cursor untouched and safe to resume. */
export async function readVendorPage(vendor:ApiVendor,client:ApiClient,cursor:ApiCursor|null,since:number|null):Promise<ApiPage>{
 if(!Object.hasOwn(readers,vendor))throw new Error('api_vendor_unsupported')
 if(since!==null&&(!Number.isSafeInteger(since)||since<0))throw new Error('api_since_invalid')
 const reader=readers[vendor]
 const state=cursor?structuredClone(cursor):{version:1,vendor,since,tasks:reader.initial(since),seen:{},agentSeen:{}}
 if(state.version!==1||state.vendor!==vendor||state.since!==since||!Array.isArray(state.tasks))throw new Error('api_cursor_invalid')
 const output:ApiPage={records:[],attachments:[],agents:[],next:null,counts:{}}
 let hydrated=0,operations=0
 while(state.tasks.length&&operations<5){
  const task:Task=state.tasks.shift();operations++
  const result=await reader.read(client,task)
  state.tasks.unshift(...(result.tasks??[]))
  const ticketRecords=new Set<string>()
  for(const record of result.records??[]){const key=`${record.kind}/${recordId(record)}`;if(Object.hasOwn(state.seen,key))continue;state.seen[key]=true;output.records.push(record);if(['ticket','conversation'].includes(record.kind))ticketRecords.add(String(record.payload.id));output.counts![record.kind]=(output.counts![record.kind]??0)+1}
  for(const person of result.agents??[]){if(Object.hasOwn(state.agentSeen,`agent/${person.id}`))continue;state.agentSeen[`agent/${person.id}`]=true;output.agents.push(person)}
  for(const attachment of result.attachments??[])if(ticketRecords.has(attachment.ticketId))output.attachments.push(attachment)
  if(task.mode==='ticket'){hydrated++;if(hydrated===5)break}
  // Expose each resource page promptly; ticket hydration is bounded to five.
  else break
 }
 output.next=state.tasks.length?state:null
 return output
}
