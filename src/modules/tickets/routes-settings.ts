import {lookupValueGuard} from './lookups'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority,ticketSettings,object,invalid,fieldAllowed,type TicketAuthority} from './model'
import {statusDefinition} from './statuses'
import {fieldDefinition,validateFieldValue} from './fields'
import {groupDefinition} from './groups'
export const ticketSettingsRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId'
ticketSettingsRoutes.get(`${prefix}/ticket-settings`,async c=>c.json({data:await ticketSettings(c.env,await scope(c) as Actor)}))
for(const kind of ['statuses','fields','groups'] as const){
 const table=`ticket_${kind}`,path=`${prefix}/ticket-${kind}`
 ticketSettingsRoutes.get(path,async c=>{const settings=await ticketSettings(c.env,await scope(c) as Actor);return c.json({data:settings[kind]})})
 if(kind==='fields')ticketSettingsRoutes.get(`${path}/:id/versions`,async c=>{
  const actor=await scope(c,true) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage'),id=c.req.param('id')
  const current=await c.env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? AND id=?').bind(actor.projectId,id).first<any>()
  if(current&&!fieldAllowed(current,guard.access))throw new HTTPException(403,{message:'Your role cannot read this field'})
  const rows=await c.env.DB.prepare("SELECT at,actor_id,action,detail_json FROM audit_events WHERE project_id=? AND target_type='ticket_fields' AND target_id=? AND action IN ('ticket.fields.post','ticket.fields.patch','ticket.fields.delete') ORDER BY at DESC,id DESC LIMIT 100").bind(actor.projectId,id).all<any>()
  return c.json({data:rows.results.map(({detail_json,...row})=>({...row,...JSON.parse(detail_json)})).filter(row=>row.version!==undefined&&(!row.definition||fieldAllowed(row.definition,guard.access)))})
 })
 for(const method of ['post','patch','delete'] as const)ticketSettingsRoutes[method](method==='post'?path:`${path}/:id`,async c=>{
  const actor=await scope(c,true) as Actor,authority:TicketAuthority={sessionHash:c.get('sessionHash'),source:'dashboard'},guard=await ticketAuthority(c.env,actor,authority,'settings.manage'),id=method==='post'?crypto.randomUUID():c.req.param('id')!,existing=method==='post'?null:await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND id=?`).bind(actor.projectId,id).first<any>()
  if(method!=='post'&&!existing)throw new HTTPException(404)
  const body=method==='delete'?{}:object(await c.req.json())
  let definition:Record<string,any>={},fieldSnapshot:string|undefined
  const fieldSnapshotSql=`SELECT json_group_array(json_object('conversation_id',conversation_id,'value_json',value_json)) snapshot FROM (SELECT conversation_id,value_json FROM ticket_field_values WHERE project_id=? AND field_id=? ORDER BY conversation_id)`
  if(method!=='delete'){
   if(kind==='statuses'){definition=statusDefinition({...existing,...body});if(existing?.is_default&&(definition.category!==existing.category||definition.name!==existing.name))invalid('Default lifecycle statuses cannot be renamed or recategorized');if(existing&&definition.category!==existing.category&&await c.env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND status_id=? LIMIT 1').bind(actor.projectId,id).first())invalid('A status in use cannot change category')}
   if(kind==='fields'){
    const old=existing?{name:existing.name,type:existing.type,required:!!existing.required,options:JSON.parse(existing.options_json),validation:JSON.parse(existing.validation_json),read_roles:JSON.parse(existing.read_roles_json),write_roles:JSON.parse(existing.write_roles_json)}:{}
    definition=fieldDefinition({...old,...body})
    for(const role of [...JSON.parse(definition.read_roles_json),...JSON.parse(definition.write_roles_json)])if(!['owner','admin','operator','collaborator','api'].includes(role)&&!await c.env.DB.prepare('SELECT 1 FROM project_roles WHERE project_id=? AND id=?').bind(actor.projectId,role).first())invalid('Unknown workspace field role')
    if(existing){fieldSnapshot=(await c.env.DB.prepare(fieldSnapshotSql).bind(actor.projectId,id).first<{snapshot:string}>())!.snapshot;for(const row of JSON.parse(fieldSnapshot)){validateFieldValue(definition,JSON.parse(row.value_json));if(JSON.parse(existing.validation_json).lookup!==JSON.parse(definition.validation_json).lookup)await lookupValueGuard(c.env,actor.projectId,[{...definition,id} as any],{[id]:JSON.parse(row.value_json)})}}
   }
   if(kind==='groups'){definition=groupDefinition({name:existing?.name,...(existing?{members:(await c.env.DB.prepare('SELECT user_id FROM ticket_group_members WHERE project_id=? AND group_id=?').bind(actor.projectId,id).all<{user_id:string}>()).results.map(m=>m.user_id)}:{}),...body});for(const user of definition.members)if(!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(actor.projectId,user).first())invalid('Every group member must belong to the workspace')
    if(existing){const assigned=await c.env.DB.prepare('SELECT DISTINCT assigned_to FROM conversations WHERE project_id=? AND group_id=? AND assigned_to IS NOT NULL').bind(actor.projectId,id).all<any>();if(assigned.results.some(a=>!definition.members.includes(a.assigned_to)))invalid('Reassign tickets before removing their assignee from the group')}
   }
  }
  if(method==='delete'&&kind==='fields'&&await c.env.DB.prepare('SELECT 1 FROM ticket_field_values WHERE project_id=? AND field_id=? LIMIT 1').bind(actor.projectId,id).first())invalid('A field with ticket values cannot be deleted; edit its definition or make it optional instead')
  if(method==='delete'&&kind==='statuses'&&existing.is_default)invalid('Default lifecycle statuses cannot be removed')
  if(method==='delete'&&kind==='groups'&&await c.env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND group_id=? LIMIT 1').bind(actor.projectId,id).first())invalid('Move tickets out of this group before deleting it')
  const now=Math.max(Date.now(),(existing?.updated_at??0)+1),receipt=crypto.randomUUID(),extra:string[]=[],args:any[]=[]
  if(existing){extra.push(`EXISTS(SELECT 1 FROM ${table} WHERE project_id=? AND id=? AND updated_at=?)`);args.push(actor.projectId,id,existing.updated_at)}
  if(kind==='fields'&&method==='delete'){extra.push('NOT EXISTS(SELECT 1 FROM ticket_field_values WHERE project_id=? AND field_id=?)');args.push(actor.projectId,id)}
  if(fieldSnapshot!==undefined){extra.push(`(${fieldSnapshotSql})=?`);args.push(actor.projectId,id,fieldSnapshot)}
  if(kind==='fields'&&method!=='delete')for(const role of [...JSON.parse(definition.read_roles_json),...JSON.parse(definition.write_roles_json)])if(!['owner','admin','operator','collaborator','api'].includes(role)){extra.push('EXISTS(SELECT 1 FROM project_roles WHERE project_id=? AND id=?)');args.push(actor.projectId,role)}
  if(kind==='groups'){
   if(method==='delete'){extra.push('NOT EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND group_id=?)');args.push(actor.projectId,id)}
   else{for(const user of definition.members){extra.push('EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)');args.push(actor.projectId,user)}
    extra.push(`NOT EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND group_id=? AND assigned_to IS NOT NULL AND assigned_to NOT IN (SELECT value FROM json_each(?)))`);args.push(actor.projectId,id,JSON.stringify(definition.members))}
  }
  if(kind==='statuses'&&existing&&method!=='delete'&&definition.category!==existing.category){extra.push('NOT EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND status_id=?)');args.push(actor.projectId,id)}
  const detail=kind==='fields'?JSON.stringify({version:now,previousVersion:existing?.updated_at??null,definition:method==='delete'?null:definition}):'{}'
  const accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=?)',statements=[c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard',?,?,? WHERE EXISTS(${guard.sql}) ${extra.map(e=>'AND '+e).join(' ')}`).bind(receipt,actor.projectId,now,`ticket.${kind}.${method}`,actor.id,table,id,detail,...guard.params,...args)]
  if(method==='delete'){
   statements.push(kind==='statuses'?c.env.DB.prepare(`UPDATE ticket_statuses SET active=0,updated_at=? WHERE project_id=? AND id=? AND ${accepted}`).bind(now,actor.projectId,id,receipt):c.env.DB.prepare(`DELETE FROM ${table} WHERE project_id=? AND id=? AND ${accepted}`).bind(actor.projectId,id,receipt))
  }else{
   const {members,...columns}=definition
   const keys=Object.keys(columns),values=Object.values(columns)
   statements.push(method==='post'?c.env.DB.prepare(`INSERT INTO ${table}(project_id,id,${keys.join(',')},updated_at) SELECT ?,?,${keys.map(()=>'?').join(',')},? WHERE ${accepted}`).bind(actor.projectId,id,...values,now,receipt):c.env.DB.prepare(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE project_id=? AND id=? AND ${accepted}`).bind(...values,now,actor.projectId,id,receipt))
   if(kind==='groups'){
    statements.push(c.env.DB.prepare(`DELETE FROM ticket_group_members WHERE project_id=? AND group_id=? AND ${accepted}`).bind(actor.projectId,id,receipt))
    for(const user of members)statements.push(c.env.DB.prepare(`INSERT INTO ticket_group_members(project_id,group_id,user_id) SELECT ?,?,? WHERE ${accepted}`).bind(actor.projectId,id,user,receipt))
   }
  }
  const committed=await c.env.DB.batch(statements)
  if(!committed[0].meta.changes)throw new HTTPException(409,{message:'Settings or authority changed. Reload before applying changes.'})
  if(method==='delete')return c.json({removed:true})
  const settings=await ticketSettings(c.env,actor)
  return c.json({data:settings[kind].find((item:any)=>item.id===id)},method==='post'?201:200)
 })
}
