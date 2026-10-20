import type {Reader,Task,ApiRecord,SourceAgent} from './types'
import {agent,attachments,enc,entity,items,pageUrl} from './common'
// https://developers.freshdesk.com/api/#list_all_tickets
function ticketLists(since:number|null):Task[]{const base=`/api/v2/tickets?per_page=100&page=1&order_by=updated_at&order_type=asc&updated_since=${enc(new Date(since??0).toISOString())}`;return [{path:base,kind:'ticket',page:1},{path:base+'&filter=spam',kind:'ticket',page:1}]}
export const freshdesk:Reader={
 initial(since){return since!==null?ticketLists(since):[{path:'/api/v2/agents?per_page=100&page=1',kind:'agent'},{path:'/api/v2/contacts?per_page=100&page=1',kind:'contact'},{path:'/api/v2/companies?per_page=100&page=1',kind:'company'},{path:'/api/v2/solutions/categories?per_page=100&page=1',kind:'category'},...ticketLists(null)]},
 async read(client,task){
  if(task.mode==='ticket'){
   const p=entity(await client.get(task.path),'freshdesk_ticket'),parts:any[]=[],records:ApiRecord[]=[],agents:SourceAgent[]=[]
   for(let page=1;;page++){const list=items(await client.get(`/api/v2/tickets/${enc(p.id)}/conversations?per_page=100&page=${page}`),'freshdesk_conversations');parts.push(...list);if(list.length<100)break}
   records.push({kind:'contact',payload:entity(await client.get(`/api/v2/contacts/${enc(p.requester_id)}`),'freshdesk_contact')})
   for(const id of [...new Set(parts.map(p=>p.user_id).filter(id=>id!=null&&String(id)!==String(p.requester_id)))]){
    let staff:any
    try{staff=await client.get(`/api/v2/agents/${enc(id)}`)}catch(error){if(((error as any)?.status??(error as any)?.statusCode)!==404)throw error}
    if(staff){entity(staff,'freshdesk_agent');records.push({kind:'agent',payload:staff});agents.push(agent(staff,'freshdesk'))}
    else {
     let person:any
     try{person=entity(await client.get(`/api/v2/contacts/${enc(id)}`),'freshdesk_historical_author')}catch(error){if(((error as any)?.status??(error as any)?.statusCode)===404)throw new Error(`freshdesk_historical_author_unavailable:${id}`);throw error}
     if(person.deleted===true){
      records.push({kind:'historical-author',payload:person})
      agents.push({id:String(person.id),email:typeof person.email==='string'?person.email:null,name:typeof person.name==='string'?person.name:'Unknown historical author',deleted:true})
     }else records.push({kind:'contact',payload:person})
    }
   }
   if(p.company_id!=null)records.push({kind:'company',payload:entity(await client.get(`/api/v2/companies/${enc(p.company_id)}`),'freshdesk_company')})
   records.push({kind:'ticket',payload:{...p,conversations:parts}})
   return {records,agents,attachments:[...attachments(p.id,`description:${p.id}`,p.attachments,false,'freshdesk'),...parts.flatMap(part=>attachments(p.id,String(part.id),part.attachments,part.private===true,'freshdesk'))]}
  }
  if(task.mode==='detail')return {records:[{kind:task.kind,payload:entity(await client.get(task.path),`freshdesk_${task.kind}`)}]}
  const list=items(await client.get(task.path),`freshdesk_${task.kind}`),page=task.page??1,tasks:Task[]=[]
  if(list.length===100){
   if(task.kind==='ticket'&&page>=300){
    const boundary=list.at(-1).updated_at,url=new URL(task.path,'https://reader.invalid'),previous=url.searchParams.get('updated_since')
    if(typeof boundary!=='string'||!Number.isFinite(Date.parse(boundary))||Date.parse(boundary)<=Date.parse(previous??''))throw new Error('freshdesk_ticket_window_exceeds_300_pages_at_same_timestamp')
    url.searchParams.set('updated_since',boundary);url.searchParams.set('page','1');tasks.push({...task,page:1,path:url.pathname+url.search})
   }else tasks.push({...task,page:page+1,path:pageUrl(task.path,page+1)})
  }
  if(task.kind==='ticket')return {tasks:[...list.map(p=>({path:`/api/v2/tickets/${enc(p.id)}?include=stats`,kind:'ticket',mode:'ticket' as const})),...tasks]}
  if(task.kind==='category')return {records:list.map(payload=>({kind:'category',payload})),tasks:[...list.map(p=>({path:`/api/v2/solutions/categories/${enc(p.id)}/folders?per_page=100&page=1`,kind:'folder'})),...tasks]}
  if(task.kind==='folder')return {records:list.map(payload=>({kind:'folder',payload})),tasks:[...list.map(p=>({path:`/api/v2/solutions/folders/${enc(p.id)}/articles?per_page=100&page=1`,kind:'article'})),...tasks]}
  if(task.kind==='article')return {tasks:[...list.map(p=>({path:`/api/v2/solutions/articles/${enc(p.id)}`,kind:'article',mode:'detail' as const})),...tasks]}
  return {records:list.map(payload=>({kind:task.kind==='contact'&&payload.deleted===true?'historical-author':task.kind,payload})),agents:task.kind==='agent'?list.map(p=>agent(p,'freshdesk')):[],tasks}
 }
}
