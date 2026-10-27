import {batchRead} from '../tickets/request-batch'
import type {Actor,Env} from '../../platform/env'
/** Keep preview values readable while retaining canonical IDs in the API payload. */
export async function labelMacroChanges(env:Env,actor:Actor,changes:any[]){
 const data=await batchRead(env,`macro-labels:${actor.projectId}`,()=>env.DB.batch<any>([
  env.DB.prepare('SELECT id,name FROM ticket_statuses WHERE project_id=?').bind(actor.projectId),
  env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=?').bind(actor.projectId),
  env.DB.prepare('SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=?').bind(actor.projectId),
  env.DB.prepare('SELECT id,name FROM workspace_tags WHERE project_id=?').bind(actor.projectId),
  env.DB.prepare('SELECT id,name,type FROM ticket_fields WHERE project_id=?').bind(actor.projectId),
  env.DB.prepare('SELECT id,name FROM companies WHERE project_id=?').bind(actor.projectId),
 ]))
 const maps=data.map(result=>new Map<string,string>(result.results.map((row:any)=>[String(row.id),String(row.name)])))
 const names=(map:Map<string,string>,value:any):string=>Array.isArray(value)?value.map(id=>map.get(String(id))||String(id)).join(', ')||'None':value==null?'None':map.get(String(value))||String(value)
 return changes.map(change=>{
  let label=change.field.replaceAll('_',' '),from=change.from,to=change.to
  if(change.field==='status_id'){label='Status';from=names(maps[0],from);to=names(maps[0],to)}
  else if(change.field==='group_id'){label='Group';from=names(maps[1],from);to=names(maps[1],to)}
  else if(change.field==='agent_id'){label='Assignee';from=names(maps[2],from);to=names(maps[2],to)}
  else if(change.field==='followers'){label='Followers';from=names(maps[2],from);to=names(maps[2],to)}
  else if(change.field==='tags_add'||change.field==='tags_remove'){
   label=change.field==='tags_add'?'Add tags':'Remove tags'
   to=names(maps[3],change.field==='tags_add'?[...new Set([...from,...to])]:from.filter((id:string)=>!to.includes(id)));from=names(maps[3],from)
  }else if(change.field.startsWith('custom.')){
   const id=change.field.slice(7);label=maps[4].get(id)||'Custom field'
   if(data[4].results.some((field:any)=>field.id===id&&field.type==='account')){
    const accountName=(value:any)=>value==null?'None':maps[5].get(String(value))||'Unavailable account'
    from=accountName(from);to=accountName(to)
   }
  }
  else if(change.field==='attachments'){label='Attachments';to=to.map((file:any)=>file.filename).join(', ');from='None'}
  else if(change.field==='reply')label=change.reply_type==='note'?'Internal note':'Public reply'
  return {...change,label,from_label:from,to_label:to}
 })
}
