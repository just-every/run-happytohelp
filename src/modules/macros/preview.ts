import {batchRead} from '../tickets/request-batch'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketAuthority,type TicketAuthority} from '../tickets/model'
import {prepareTicketChange} from '../tickets/mutate-validation'
import {prepareFollowerChange} from '../collaboration/followers'
import {readMacro,macroData} from './store'
import {loadMacroContext} from './context'
import {renderPlaceholders} from './placeholders'
import {validateAttachments} from './attachments'
import {labelMacroChanges} from './change-labels'
export interface MacroSelection {id:string;expected_version:number}
export async function prepareMacro(env:Env,actor:Actor,macroId:string,version:number,selected:MacroSelection,authority:TicketAuthority,preview=true){
 if(!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(selected.expected_version)||selected.expected_version<0)throw new HTTPException(400,{message:'Macro and ticket versions are required'})
 const replyGuard=await ticketAuthority(env,actor,authority,'conversations.reply')
 const loaded=await loadMacroContext(env,actor,selected.id),{row,guard:macroGuard}=await readMacro(env,actor,macroId,loaded.ticket.brand_id??actor.projectId)
 if(row.version!==version)throw new HTTPException(409,{message:'Macro changed. Review the latest version before applying.'})
 const macro=macroData(row),{reply_type,followers,attachments,...change}=macro.actions
 const prepared=await prepareTicketChange(env,actor,selected.id,{...change,expected_ticket_version:selected.expected_version},authority)
 const followerPlan=followers===undefined?null:await prepareFollowerChange(env,actor,selected.id,followers,authority)
 const media=await validateAttachments(env,actor,attachments??[])
 for(const [id,value] of Object.entries(prepared.fields))loaded.context[`ticket.custom.${id}`]=value
 if(prepared.next.assigned_to!==prepared.current.assigned_to){const assignee=prepared.next.assigned_to?await batchRead(env,`user:${prepared.next.assigned_to}`,()=>env.DB.prepare('SELECT name,email FROM users WHERE id=?').bind(prepared.next.assigned_to).first<any>()):null;loaded.context['assignee.name']=assignee?.name;loaded.context['assignee.email']=assignee?.email}
 const rendered=renderPlaceholders(macro.content,loaded.context)
 // Source attachments are rechecked with the requester privacy fence at commit.
 for(const source of media){prepared.predicates.push('EXISTS(SELECT 1 FROM media sm JOIN conversations sc ON sc.id=sm.conversation_id JOIN contacts ct ON ct.id=sc.contact_id WHERE sm.id=? AND sm.project_id=c.project_id AND sm.object_key=? AND coalesce(json_extract(ct.metadata_json,\'$.is_erased\'),0)!=1 AND coalesce(json_extract(ct.metadata_json,\'$.is_erasing\'),0)!=1)');prepared.params.push(source.id,source.object_key);prepared.predicates.push("EXISTS(SELECT 1 FROM contacts root WHERE root.id=? AND root.project_id=c.project_id AND coalesce(json_extract(root.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(root.metadata_json,'$.is_erasing'),0)!=1)");prepared.params.push(source.source_contact_id)}
 const changes:any[]=[]
 for(const [key,to] of Object.entries(change)){
  if(key==='fields')for(const [field,value] of Object.entries(to as object))changes.push({field:`custom.${field}`,from:loaded.ticket.fields[field]??null,to:value})
  else if(key==='tags_add'||key==='tags_remove')changes.push({field:key,from:loaded.ticket.tags.map((tag:any)=>tag.id),to})
  else changes.push({field:key,from:key==='agent_id'?prepared.current.assigned_to:prepared.current[key]??null,to})
 }
 if(followerPlan)changes.push({field:'followers',from:(await env.DB.prepare('SELECT user_id FROM conversation_followers WHERE conversation_id=?').bind(selected.id).all<any>()).results.map(r=>r.user_id),to:followers})
 if(media.length)changes.push({field:'attachments',from:[],to:media.map(row=>({id:row.id,filename:row.filename,size:row.size}))})
 if(macro.content)changes.push({field:'reply',from:'',to:rendered.text,reply_type:reply_type??'public'})
 return {macro,macroGuard,replyGuard,prepared,followerPlan,media,rendered,preview:{id:selected.id,macro_id:macroId,macro_version:version,expected_version:selected.expected_version,status:'ready',changes:preview?await labelMacroChanges(env,actor,changes):changes,draft:{content:rendered.text,reply_type:reply_type??'public',unresolved:rendered.unresolved,attachments:media.map(m=>({id:m.id,filename:m.filename,size:m.size}))}}}
}
