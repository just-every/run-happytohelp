import type {Reader,ApiRecord,ApiAttachment} from './types'
import {agent,attachments,enc,entity,items,zendeskNext} from './common'
import {zendeskEmailEvidence} from './email-evidence'
// https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
export const zendesk:Reader={
 initial(since){const tickets={path:`/api/v2/incremental/tickets/cursor.json?start_time=${Math.floor((since??0)/1000)}&per_page=100`,kind:'ticket'};return since!==null?[tickets]:[
  {path:'/api/v2/users.json?role[]=agent&role[]=admin&page[size]=100',kind:'staff'},
  {path:'/api/v2/users.json?role=end-user&page[size]=100',kind:'user'},
  {path:'/api/v2/organizations.json?page[size]=100',kind:'company'},
  {path:'/api/v2/help_center/articles.json?page[size]=100',kind:'article'},tickets]},
 async read(client,task){
  if(task.mode==='ticket'){
   // Deleted exports are vendor tombstones; preserve them for the mapper's explicit rejection.
   if(task.context?.ticket?.status==='deleted')return {records:[{kind:'ticket',payload:task.context.ticket}]}
   const p=entity((await client.get(task.path)).ticket,'zendesk_ticket'),comments:any[]=[],records:ApiRecord[]=[],files:ApiAttachment[]=[]
   let path:string|null=`/api/v2/tickets/${enc(p.id)}/comments.json?page[size]=100`;const visited=new Set<string>()
   while(path){if(visited.has(path))throw new Error('zendesk_comment_pagination_cycle');visited.add(path);const data=await client.get(path);comments.push(...items(data.comments,'zendesk_comments'));path=zendeskNext(data)}
   await zendeskEmailEvidence(client,p.id,comments)
   const users=[...new Set([p.requester_id,p.assignee_id,...(p.collaborator_ids??[]),...comments.map(c=>c.author_id)].filter(id=>id!=null))]
   const agents=[]
   for(const id of users){const user=entity((await client.get(`/api/v2/users/${enc(id)}.json`)).user,'zendesk_user');records.push({kind:'user',payload:user});if(['agent','admin'].includes(user.role))agents.push(agent(user,'zendesk'))}
   if(p.organization_id!=null)records.push({kind:'company',payload:entity((await client.get(`/api/v2/organizations/${enc(p.organization_id)}.json`)).organization,'zendesk_organization')})
   for(const comment of comments)files.push(...attachments(p.id,String(comment.id),comment.attachments,comment.public!==true,'zendesk'))
   records.push({kind:'ticket',payload:{...p,comments}});return {records,agents,attachments:files}
  }
  const data=await client.get(task.path),key=task.kind==='staff'||task.kind==='user'?'users':task.kind==='company'?'organizations':task.kind==='article'?'articles':'tickets',list=items(data[key],`zendesk_${key}`),next=zendeskNext(data)
  const tasks=next?[{...task,path:next}]:[]
  if(task.kind==='ticket')return {tasks:[...list.map(p=>({path:`/api/v2/tickets/${enc(p.id)}.json`,kind:'ticket',mode:'ticket' as const,context:{ticket:p}})),...tasks]}
  return {records:list.map(payload=>({kind:task.kind==='staff'?'user':task.kind,payload})),agents:task.kind==='staff'?list.map(p=>agent(p,'zendesk')):[],tasks}
 }
}
