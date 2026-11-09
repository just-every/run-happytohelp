import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {fieldAllowed} from './model'

/** Hydrate one inbox/API page (whole `conversations` rows) in a bounded batch; restricted values never leave the
 * server. Each relation is read through the values the rows hold, never by reading the conversations again; a
 * caller that hydrates the tags itself passes `tags:false`. */
export async function ticketPresentation(env:Env,rows:any[],userId?:string,{tags=true}:{tags?:boolean}={}){
 if(!rows.length)return new Map<string,any>()
 const projects=[...new Set<string>(rows.map(r=>r.project_id))],ids=JSON.stringify(rows.map(r=>r.id))
 const held=(column:string)=>JSON.stringify(rows.map(r=>[r.id,r.project_id,r[column]]))
 const access=new Map(await Promise.all(projects.map(async project=>[project,userId?await memberAccess(env.DB,project,userId):null] as const)))
 const results=await env.DB.batch<any>([
  // Each page conversation's own values through their primary key (its workspace, then it), never every value.
  env.DB.prepare('SELECT v.project_id,v.conversation_id,v.field_id,v.value_json FROM json_each(?) page CROSS JOIN ticket_field_values v ON v.project_id=page.value->>1 AND v.conversation_id=page.value->>0').bind(held('id')),
  env.DB.prepare('SELECT page.value->>0 id,s.name,s.category FROM json_each(?) page CROSS JOIN ticket_statuses s ON s.project_id=page.value->>1 AND s.id=page.value->>2').bind(held('status_id')),
  env.DB.prepare('SELECT page.value->>0 id,g.id group_id,g.name FROM json_each(?) page CROSS JOIN ticket_groups g ON g.project_id=page.value->>1 AND g.id=page.value->>2').bind(held('group_id')),
  ...(tags?[env.DB.prepare('SELECT ct.conversation_id,t.id,t.name FROM conversation_tags ct JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id WHERE ct.conversation_id IN (SELECT value FROM json_each(?)) ORDER BY t.name,t.id').bind(ids)]:[]),
 ])
 // Each field the values name is read once, then joined to its values in their order.
 const fieldKeys=[...new Map(results[0].results.map((value:any)=>[JSON.stringify([value.project_id,value.field_id]),[value.project_id,value.field_id]])).values()]
 const fields=new Map(fieldKeys.length?(await env.DB.prepare('SELECT f.* FROM json_each(?) held CROSS JOIN ticket_fields f ON f.project_id=held.value->>0 AND f.id=held.value->>1').bind(JSON.stringify(fieldKeys)).all<any>()).results.map(field=>[JSON.stringify([field.project_id,field.id]),field]):[])
 const data=new Map<string,any>(rows.map(r=>[r.id,{fields:{},tags:[],status:{id:r.status_id,category:r.status_category,name:r.status_category},group:null}]))
 for(const value of results[0].results){
  const field=fields.get(JSON.stringify([value.project_id,value.field_id]))
  if(field&&fieldAllowed(field,access.get(field.project_id)??null))data.get(value.conversation_id).fields[field.id]=JSON.parse(value.value_json)
 }
 for(const status of results[1].results)data.get(status.id).status={...data.get(status.id).status,name:status.name,category:status.category}
 for(const group of results[2].results)data.get(group.id).group={id:group.group_id,name:group.name}
 for(const tag of tags?results[3].results:[])data.get(tag.conversation_id).tags.push({id:tag.id,name:tag.name})
 return data
}
