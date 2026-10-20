import type {Reader,Task,ApiRecord,ApiAttachment,SourceAgent} from './types'
import {agent,attachments,enc,entity,items,pageUrl} from './common'
const inbox='https://api.helpscout.net',docs='https://docsapi.helpscout.net'
// https://developer.helpscout.com/docs-api/ ; Docs has its own API key, separate from Inbox OAuth.
async function docsGet(client:{get(path:string):Promise<any>},path:string){try{return await client.get(path)}catch(error){const status=(error as any)?.status??(error as any)?.statusCode;if(status===401||status===403||/docs.*(credential|key).*missing|credential.*missing/i.test(String((error as any)?.message)))throw new Error('helpscout_docs_api_key_required');throw error}}
function inboxNext(task:Task,data:any):Task[]{
 const next=data._links?.next?.href,p=data.page
 if(!p||!Number.isInteger(p.number)||!Number.isInteger(p.totalPages))throw new Error('helpscout_pagination_invalid')
 if(p.number<p.totalPages&&!next)throw new Error('helpscout_next_page_missing')
 if(next&&p.number>=p.totalPages)throw new Error('helpscout_terminal_page_invalid')
 if(!next)return []
 const url=new URL(next);if(url.origin!==inbox)throw new Error('helpscout_next_host_invalid')
 return [{...task,path:next}]
}
export const helpscout:Reader={
 initial(since){const tickets={path:`${inbox}/v2/conversations?status=all&page=1${since!==null?`&modifiedSince=${enc(new Date(since).toISOString())}`:''}`,kind:'conversation'};return since!==null?[tickets]:[
  {path:`${inbox}/v2/users?page=1`,kind:'agent'},{path:`${inbox}/v2/customers?page=1`,kind:'contact'},
  {path:`${inbox}/v2/organizations?page=1`,kind:'company'},{path:`${docs}/v1/collections?page=1`,kind:'collection'},tickets]},
 async read(client,task){
  if(task.mode==='ticket'){
   const p=entity(await client.get(task.path),'helpscout_conversation'),records:ApiRecord[]=[],files:ApiAttachment[]=[],agents:SourceAgent[]=[]
   let path:string|null=`${inbox}/v2/conversations/${enc(p.id)}/threads`,seen=new Set<string>(),people=new Set<string>()
   while(path){
    if(seen.has(path))throw new Error('helpscout_thread_pagination_cycle');seen.add(path)
    const data=await client.get(path),self=data._links?.self?.href
    if(typeof self!=='string'||new URL(self).origin!==inbox)throw new Error('helpscout_thread_canonical_self_required')
    records.push({kind:'thread-page',payload:data})
    for(const thread of items(data._embedded?.threads,'helpscout_threads')){
     files.push(...attachments(p.id,String(thread.id),thread._embedded?.attachments,thread.type==='note','helpscout'))
     const person=thread.createdBy;if(person?.type==='user'&&!people.has(String(person.id))){people.add(String(person.id));agents.push({id:String(person.id),email:typeof person.email==='string'?person.email:null,name:[person.first,person.last].filter(v=>typeof v==='string').join(' ')||'Unknown historical agent',deleted:!person.first&&!person.last})}
    }
    const next=inboxNext({path,kind:'thread-page'},data);path=next[0]?.path??null
   }
   records.push({kind:'contact',payload:entity(await client.get(`${inbox}/v2/customers/${enc(p.primaryCustomer?.id)}`),'helpscout_customer')},{kind:'conversation',payload:p})
   return {records,attachments:files,agents}
  }
  if(task.mode==='detail'){
   const data=await docsGet(client,task.path),p=entity(data.article,'helpscout_article'),tasks:Task[]=[]
   if(task.kind==='article'&&p.hasDraft===true)tasks.push({path:`${docs}/v1/articles/${enc(p.id)}?draft=true`,kind:'article-draft',mode:'detail'})
   return {records:[{kind:task.kind,payload:p}],tasks}
  }
  if(task.path.startsWith(docs)){
   const data=await docsGet(client,task.path),key=task.kind==='collection'?'collections':task.kind==='category'?'categories':'articles',envelope=data[key],list=items(envelope?.items,`helpscout_${key}`),tasks:Task[]=[]
   if(!Number.isInteger(envelope.page)||!Number.isInteger(envelope.pages)||envelope.page<1||envelope.pages<0)throw new Error('helpscout_docs_pagination_invalid')
   if(envelope.page<envelope.pages)tasks.push({...task,path:pageUrl(task.path,envelope.page+1)})
   if(task.kind==='collection')return {records:list.map(payload=>({kind:'collection',payload})),tasks:[...list.flatMap(p=>[{path:`${docs}/v1/collections/${enc(p.id)}/categories?page=1`,kind:'category'},{path:`${docs}/v1/collections/${enc(p.id)}/articles?page=1&pageSize=100&status=all`,kind:'article'}]),...tasks]}
   if(task.kind==='article')return {tasks:[...list.map(p=>({path:`${docs}/v1/articles/${enc(p.id)}`,kind:'article',mode:'detail' as const})),...tasks]}
   return {records:list.map(payload=>({kind:task.kind,payload})),tasks}
  }
  const data=await client.get(task.path),key=task.kind==='agent'?'users':task.kind==='contact'?'customers':task.kind==='company'?'organizations':'conversations',list=items(data._embedded?.[key],`helpscout_${key}`),tasks=inboxNext(task,data)
  if(task.kind==='conversation')return {tasks:[...list.map(p=>({path:`${inbox}/v2/conversations/${enc(p.id)}`,kind:'conversation',mode:'ticket' as const})),...tasks]}
  return {records:list.map(payload=>({kind:task.kind,payload})),agents:task.kind==='agent'?list.map(p=>agent(p,'helpscout')):[],tasks}
 }
}
