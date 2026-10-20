import type {Reader,Task,ApiRecord,SourceAgent} from './types'
import {agent,attachments,enc,entity,items} from './common'
// The 2.16 retrieve endpoint returns only the latest 500 parts. Never call this complete at that boundary.
// https://developers.intercom.com/docs/references/2.16/rest-api/api.intercom.io/conversations/retrieveconversation
function nextTask(task:Task,data:any):Task[]{
 if(task.kind!=='agent'&&(!data.pages||!Object.hasOwn(data.pages,'next')))throw new Error('intercom_pagination_missing')
 const next=data.pages?.next;if(!next)return []
 if(task.body){if(typeof next.starting_after!=='string')throw new Error('intercom_cursor_invalid');return [{...task,body:{...task.body,pagination:{per_page:100,starting_after:next.starting_after}}}]}
 if(typeof next==='string')return [{...task,path:next}]
 if(typeof next.starting_after==='string'){const path=task.path.split('?')[0];return [{...task,path:`${path}?per_page=100&starting_after=${enc(next.starting_after)}`} ]}
 if(typeof next.page==='number')return [{...task,path:`${task.path.split('?')[0]}?per_page=100&page=${next.page}`}]
 throw new Error('intercom_cursor_invalid')
}
function companyNext(task:Task,data:any,list:any[]):Task[]{
 if(!list.length)return []
 if(typeof data.scroll_param!=='string'||!data.scroll_param)throw new Error('intercom_company_scroll_missing')
 return [{...task,path:`/companies/scroll?scroll_param=${enc(data.scroll_param)}`} ]
}
export const intercom:Reader={
 initial(since){const tickets:Task=since===null?{path:'/conversations?per_page=100',kind:'conversation'}:{path:'/conversations/search',kind:'conversation',body:{query:{field:'updated_at',operator:'>',value:Math.floor(since/1000)-1},pagination:{per_page:100}}};return since!==null?[tickets]:[
  {path:'/admins',kind:'agent'},{path:'/contacts?per_page=100',kind:'contact'},{path:'/companies/scroll',kind:'company'},{path:'/articles?per_page=100&page=1',kind:'article'},tickets]},
 async read(client,task){
  if(task.mode==='ticket'){
   const path=new URL(task.path,'https://reader.invalid');path.searchParams.set('include_email_history','true')
   const p=entity(await client.get(task.path.startsWith('https://')?path.href:path.pathname+path.search),'intercom_conversation'),parts=items(p.conversation_parts?.conversation_parts,'intercom_parts')
   if(parts.length>=500||p.conversation_parts.total_count!==parts.length)throw new Error(`intercom_history_incomplete:${p.id}:api_500_part_limit`)
   const records:ApiRecord[]=[],agents:SourceAgent[]=[]
   for(const contact of items(p.contacts?.contacts,'intercom_conversation_contacts'))records.push({kind:'contact',payload:entity(await client.get(`/contacts/${enc(contact.id)}`),'intercom_contact')})
   const authors=[p.source?.author,...parts.map(p=>p.author)],seen=new Set<string>()
   for(const person of authors){if(!person||!['admin','teammate'].includes(person.type)||seen.has(String(person.id)))continue;seen.add(String(person.id));agents.push({id:String(person.id),email:typeof person.email==='string'?person.email:null,name:typeof person.name==='string'?person.name:'Unknown historical agent',deleted:person.name==null&&person.email==null})}
   records.push({kind:'conversation',payload:p})
   return {records,agents,attachments:[...attachments(p.id,`source:${p.source.id}`,p.source.attachments,false,'intercom'),...parts.flatMap(part=>attachments(p.id,String(part.id),part.attachments,part.part_type==='note','intercom'))]}
  }
  if(task.mode==='detail')return {records:[{kind:task.kind,payload:entity(await client.get(task.path),`intercom_${task.kind}`)}]}
  const data=task.body?await client.post(task.path,task.body):await client.get(task.path),key=task.kind==='agent'?'admins':task.kind==='conversation'?'conversations':'data',list=items(data[key],`intercom_${task.kind}`),tasks=task.kind==='company'?companyNext(task,data,list):nextTask(task,data)
  if(task.kind==='conversation'||task.kind==='article')return {tasks:[...list.map(p=>({kind:task.kind,path:`/${task.kind==='article'?'articles':'conversations'}/${enc(p.id)}`,mode:task.kind==='article'?'detail' as const:'ticket' as const})),...tasks]}
  return {records:list.map(payload=>({kind:task.kind,payload})),agents:task.kind==='agent'?list.map(p=>agent(p,'intercom')):[],tasks}
 }
}
