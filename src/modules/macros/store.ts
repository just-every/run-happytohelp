import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketAuthority,ticketReadAccess,invalid,object,fieldAllowed,type TicketAuthority} from '../tickets/model'
import {definition,type MacroDefinition,type MacroScope} from './schema'
import {validateFieldValue} from '../tickets/fields'
import {assertMacroFieldsReadable} from './read-access'
import {validateAttachments} from './attachments'
export function macroData(row:any){return {...row,actions:JSON.parse(row.actions_json),scope:JSON.parse(row.scope_json)}}
const selection='SELECT v.*,m.created_by owner_id,m.created_at created_at,(SELECT name FROM users WHERE id=m.created_by) created_by_name,h.version current_version,h.archived_at FROM macros m JOIN macro_heads h ON h.macro_id=m.id JOIN macro_versions v ON v.macro_id=m.id AND v.version=h.version'
export function scopeGuard(actor:Actor,row:any,roleKey:string,brandId:string){
 const scope:MacroScope=JSON.parse(row.scope_json),conditions=['m.project_id=?','m.id=?','h.version=?','h.archived_at IS NULL'],params:any[]=[actor.projectId,row.macro_id,row.version]
 if(scope.visibility==='personal'){conditions.push('m.created_by=?');params.push(actor.id)}
 if(scope.roles.length&&!scope.roles.includes(roleKey))throw new HTTPException(403,{message:'Your role cannot use this macro'})
 if(scope.brands.length&&!scope.brands.includes(brandId))throw new HTTPException(403,{message:'This macro is unavailable for this brand'})
 if(scope.groups.length){conditions.push('EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=m.project_id AND gm.user_id=? AND gm.group_id IN (SELECT value FROM json_each(?)))');params.push(actor.id,JSON.stringify(scope.groups))}
 return {sql:`SELECT 1 FROM macros m JOIN macro_heads h ON h.macro_id=m.id WHERE ${conditions.join(' AND ')}`,params}
}
export async function readMacro(env:Env,actor:Actor,id:string,brandId=actor.projectId){
 const access=await ticketReadAccess(env,actor),row=await env.DB.prepare(`${selection} WHERE m.project_id=? AND m.id=? AND h.archived_at IS NULL`).bind(actor.projectId,id).first<any>()
 if(!row)throw new HTTPException(404)
 const guard=scopeGuard(actor,row,access.key,brandId)
 if(!await env.DB.prepare(guard.sql).bind(...guard.params).first())throw new HTTPException(404)
 await assertMacroFieldsReadable(env,actor,row)
 return {row,guard,access}
}
export async function listMacros(env:Env,actor:Actor,search:string,page:number,limit=50,sort='title',direction='asc'){
 const sorts:Record<string,string>={title:'v.title COLLATE NOCASE',created_at:'m.created_at',updated_at:'m.updated_at',created_by_name:'created_by_name COLLATE NOCASE'}
 if(!sorts[sort]||!['asc','desc'].includes(direction)||!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(limit)||limit<1||limit>200||search.length>500)invalid('Invalid search, page, limit or sort order')
 const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`,access=await ticketReadAccess(env,actor)
 const where=`m.project_id=? AND h.archived_at IS NULL AND (v.title LIKE ? ESCAPE '\\' OR v.content LIKE ? ESCAPE '\\')
 AND (json_extract(v.scope_json,'$.visibility')<>'personal' OR m.created_by=?)
 AND (json_array_length(v.scope_json,'$.roles')=0 OR EXISTS(SELECT 1 FROM json_each(v.scope_json,'$.roles') WHERE value=?))
 AND (json_array_length(v.scope_json,'$.brands')=0 OR EXISTS(SELECT 1 FROM json_each(v.scope_json,'$.brands') WHERE value=?))
 AND (json_array_length(v.scope_json,'$.groups')=0 OR EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=m.project_id AND gm.user_id=? AND gm.group_id IN(SELECT value FROM json_each(v.scope_json,'$.groups'))))
 AND NOT EXISTS(SELECT 1 FROM json_each(v.actions_json,'$.fields') a JOIN ticket_fields f ON f.project_id=m.project_id AND f.id=a.key WHERE json_array_length(f.read_roles_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(f.read_roles_json) WHERE value=?))`
 const params=[actor.projectId,pattern,pattern,actor.id,access.key,actor.projectId,actor.id,access.key]
 const rows=await env.DB.batch<any>([
  env.DB.prepare(`SELECT count(*) total FROM macros m JOIN macro_heads h ON h.macro_id=m.id JOIN macro_versions v ON v.macro_id=m.id AND v.version=h.version WHERE ${where}`).bind(...params),
  env.DB.prepare(`${selection} WHERE ${where} ORDER BY ${sorts[sort]} ${direction},m.id LIMIT ? OFFSET ?`).bind(...params,limit,(page-1)*limit)
 ])
 const total=rows[0].results[0].total
 return {data:rows[1].results.map(row=>({...macroData(row),id:row.macro_id})),sort,direction,pagination:{page,limit,total,hasMore:page*limit<total}}

}
async function validReferences(env:Env,actor:Actor,data:MacroDefinition){
 for(const group of data.scope.groups)if(!await env.DB.prepare('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?').bind(actor.projectId,group).first())invalid('Choose a workspace group')
 if(data.scope.brands.some(id=>id!==actor.projectId))invalid('Choose a workspace brand')
 for(const role of data.scope.roles)if(!['owner','admin','operator','collaborator'].includes(role)&&!await env.DB.prepare('SELECT 1 FROM project_roles WHERE project_id=? AND id=?').bind(actor.projectId,role).first())invalid('Choose a workspace role')
 const access=await ticketReadAccess(env,actor)
 for(const [id,value] of Object.entries(data.actions.fields??{})){const field=await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? AND id=?').bind(actor.projectId,id).first<any>();if(!field)invalid('Choose a workspace field');if(!fieldAllowed(field,access)||!fieldAllowed(field,access,true))throw new HTTPException(403,{message:'This macro field is not writable by your role'});validateFieldValue(field,value)}
 await validateAttachments(env,actor,data.actions.attachments??[],true)
}
export async function saveMacro(env:Env,actor:Actor,input:unknown,authority:TicketAuthority,id?:string){
 const b=object(input),existing=id?await env.DB.prepare('SELECT m.*,h.version FROM macros m JOIN macro_heads h ON h.macro_id=m.id WHERE m.id=? AND m.project_id=? AND h.archived_at IS NULL').bind(id,actor.projectId).first<any>():null
 if(id&&!existing)throw new HTTPException(404)
 if(existing&&b.expected_version!==undefined&&!Number.isSafeInteger(b.expected_version))invalid('expected_version is invalid')
 if(existing&&b.expected_version!==undefined&&existing.version!==b.expected_version)throw new HTTPException(409,{message:'Macro changed. Reload before saving.'})
 const previous=existing?await env.DB.prepare('SELECT * FROM macro_versions WHERE macro_id=? AND version=?').bind(id,existing.version).first<any>():null
 const data=definition(previous?{...macroData(previous),...b}:input)
 if(existing&&(JSON.parse(previous.scope_json).visibility==='personal'||data.scope.visibility==='personal')&&existing.created_by!==actor.id)throw new HTTPException(403)
 const personal=data.scope.visibility==='personal'&&(!previous||JSON.parse(previous.scope_json).visibility==='personal')
 if(personal&&existing&&existing.created_by!==actor.id)throw new HTTPException(403)
 const guard=await ticketAuthority(env,actor,authority,personal?'conversations.reply':'settings.manage')
 if(!personal&&!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Only a workspace owner or admin may manage shared macros'})
 await validReferences(env,actor,data)
 const macroId=id??crypto.randomUUID(),version=(existing?.version??0)+1,now=Date.now()
 // The new immutable version is inserted only from the guarded current head. The
 // head moves only when that exact new version exists; a stale writer creates none.
 const statements=existing?[
  env.DB.prepare(`INSERT INTO macro_versions SELECT m.id,m.project_id,?,?,?,?,?,?,? FROM macros m JOIN macro_heads h ON h.macro_id=m.id WHERE m.id=? AND m.project_id=? AND h.version=? AND h.archived_at IS NULL AND EXISTS(${guard.sql})`).bind(version,data.title,data.content,JSON.stringify(data.actions),JSON.stringify(data.scope),actor.id,now,macroId,actor.projectId,existing.version,...guard.params),
  env.DB.prepare('UPDATE macro_heads SET version=? WHERE macro_id=? AND version=? AND EXISTS(SELECT 1 FROM macro_versions WHERE macro_id=? AND version=? AND created_at=? AND created_by=?)').bind(version,macroId,existing.version,macroId,version,now,actor.id),
  env.DB.prepare('UPDATE macros SET title=?,content=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM macro_heads WHERE macro_id=? AND version=?)').bind(data.title,data.content,now,macroId,macroId,version),
 ]:[
  env.DB.prepare(`INSERT INTO macros(id,project_id,title,content,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(macroId,actor.projectId,data.title,data.content,actor.id,now,now,...guard.params),
  env.DB.prepare('UPDATE macro_versions SET actions_json=?,scope_json=? WHERE macro_id=? AND version=1 AND created_by=?').bind(JSON.stringify(data.actions),JSON.stringify(data.scope),macroId,actor.id),
 ]
 const result=await env.DB.batch(statements)
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Macro or authority changed. Reload before saving.'})
 return {...macroData(await env.DB.prepare(`${selection} WHERE m.id=? AND m.project_id=?`).bind(macroId,actor.projectId).first()),id:macroId}
}
export async function archiveMacro(env:Env,actor:Actor,id:string,expected:number,authority:TicketAuthority){
 const {row}=await readMacro(env,actor,id),personal=JSON.parse(row.scope_json).visibility==='personal'
 if(personal&&row.owner_id!==actor.id)throw new HTTPException(403)
 if(!personal&&!['owner','admin'].includes(actor.role))throw new HTTPException(403)
 const guard=await ticketAuthority(env,actor,authority,personal?'conversations.reply':'settings.manage')
 const result=await env.DB.prepare(`UPDATE macro_heads SET archived_at=? WHERE macro_id=? AND EXISTS(SELECT 1 FROM macros WHERE id=macro_id AND project_id=?) AND version=? AND archived_at IS NULL AND EXISTS(${guard.sql})`).bind(Date.now(),id,actor.projectId,expected,...guard.params).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Macro or authority changed'})
}
