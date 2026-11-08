import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {fieldAllowed} from './model'

/** Hydrate one inbox/API page in a bounded batch; restricted values never leave the server. */
export async function ticketPresentation(env:Env,rows:any[],userId?:string){
 if(!rows.length)return new Map<string,any>()
 const projects=[...new Set<string>(rows.map(r=>r.project_id))],ids=JSON.stringify(rows.map(r=>r.id))
 const access=new Map(await Promise.all(projects.map(async project=>[project,userId?await memberAccess(env.DB,project,userId):null] as const)))
 const results=await env.DB.batch<any>([
  // Each page conversation's own values through their primary key (its workspace, then it), never every value.
  env.DB.prepare('SELECT f.*,v.conversation_id,v.value_json FROM json_each(?) page CROSS JOIN conversations pc ON pc.id=page.value CROSS JOIN ticket_field_values v ON v.project_id=pc.project_id AND v.conversation_id=pc.id JOIN ticket_fields f ON f.project_id=v.project_id AND f.id=v.field_id').bind(ids),
  env.DB.prepare('SELECT c.id,s.name,s.category FROM conversations c JOIN ticket_statuses s ON s.project_id=c.project_id AND s.id=c.status_id WHERE c.id IN (SELECT value FROM json_each(?))').bind(ids),
  env.DB.prepare('SELECT c.id,g.id group_id,g.name FROM conversations c JOIN ticket_groups g ON g.project_id=c.project_id AND g.id=c.group_id WHERE c.id IN (SELECT value FROM json_each(?))').bind(ids),
  env.DB.prepare('SELECT ct.conversation_id,t.id,t.name FROM conversation_tags ct JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id WHERE ct.conversation_id IN (SELECT value FROM json_each(?)) ORDER BY t.name,t.id').bind(ids),
 ])
 const data=new Map<string,any>(rows.map(r=>[r.id,{fields:{},tags:[],status:{id:r.status_id,category:r.status_category,name:r.status_category},group:null}]))
 for(const field of results[0].results)if(fieldAllowed(field,access.get(field.project_id)??null))data.get(field.conversation_id).fields[field.id]=JSON.parse(field.value_json)
 for(const status of results[1].results)data.get(status.id).status={...data.get(status.id).status,name:status.name,category:status.category}
 for(const group of results[2].results)data.get(group.id).group={id:group.group_id,name:group.name}
 for(const tag of results[3].results)data.get(tag.conversation_id).tags.push({id:tag.id,name:tag.name})
 return data
}
