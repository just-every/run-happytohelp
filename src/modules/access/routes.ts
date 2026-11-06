import {publishAccessChange} from './live'
import {parseTicketScope,type TicketScope} from './ticket-scope'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope,text} from '../management/common'
import {dashboardAccess} from '../management/dashboard'
import {auditStatement,requestSource} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {BASE_PERMISSIONS,PERMISSIONS,ROLE_LABELS,customPermissions} from './catalogue'
import {setSelfFollowing,listFollowers} from '../collaboration/followers'

/** Settings → Roles: the permission catalogue, built-in roles and the workspace's custom roles. */
export const roles=new Hono<AppEnv>()
const P='/projects/:projectId'
const missingGroups='SELECT 1 FROM json_each(?) selected LEFT JOIN ticket_groups g ON g.project_id=? AND g.id=selected.value WHERE g.id IS NULL'
const parse=(json:string)=>{try{return JSON.parse(json)}catch{return []}}

roles.get(`${P}/roles`,async c=>{
 const actor=await scope(c,true)
 const custom=(await c.env.DB.prepare('SELECT r.id,r.name,r.base,r.permissions_json,r.knowledge_article_ids,r.ticket_scope_json,r.updated_at,(SELECT count(*) FROM member_roles mr WHERE mr.project_id=r.project_id AND mr.role_key=r.id) members FROM project_roles r WHERE r.project_id=? ORDER BY r.name').bind(actor.projectId).all<{id:string;name:string;base:'admin'|'operator'|'collaborator';permissions_json:string;knowledge_article_ids:string|null;ticket_scope_json:string|null;updated_at:number;members:number}>()).results
 return c.json({data:{
  permissions:Object.entries(PERMISSIONS).map(([key,label])=>({key,label})),
  builtIn:(['owner','admin','operator','collaborator'] as const).map(key=>({key,name:ROLE_LABELS[key],permissions:BASE_PERMISSIONS[key]})),
  groups:(await c.env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(actor.projectId).all()).results,
  custom:custom.map(({permissions_json,knowledge_article_ids,ticket_scope_json,...role})=>({...role,ticketScope:parseTicketScope(ticket_scope_json),knowledgeArticleIds:knowledge_article_ids===null?null:parse(knowledge_article_ids),permissions:customPermissions(role.base,parse(permissions_json))})),
 }})
})

async function readRole(c:any,actor:{projectId:string;role:string},previousSelection:string|null=null,previousScope:string|null=null){
 const body=await c.req.json().catch(()=>({}))
 const scopeProvided=body.ticketScope!==undefined
 let supplied:unknown=body.ticketScope
 if(!scopeProvided){
  try{supplied=previousScope===null?null:JSON.parse(previousScope)}catch{throw new HTTPException(409,{message:'The stored ticket selection is invalid. Choose ticket access explicitly before saving.'})}
 }
 const validScope=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['groupIds','includeUngrouped'].includes(key))&&Array.isArray(value.groupIds)&&value.groupIds.length<=1000&&value.groupIds.every((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=200)&&typeof value.includeUngrouped==='boolean'
 if((supplied!==null||!scopeProvided&&previousScope!==null)&&!validScope(supplied))throw new HTTPException(scopeProvided?400:409,{message:scopeProvided?'Choose workspace groups and whether to include ungrouped tickets.':'The stored ticket selection is invalid. Choose ticket access explicitly before saving.'})
 const selectionScope=supplied as Exclude<TicketScope,null>|null
 const ticketScope:TicketScope=!scopeProvided?parseTicketScope(previousScope):selectionScope===null?null:{groupIds:[...new Set(selectionScope.groupIds)],includeUngrouped:selectionScope.includeUngrouped}
 if(scopeProvided&&ticketScope&&await c.env.DB.prepare(missingGroups).bind(JSON.stringify(ticketScope.groupIds),actor.projectId).first())throw new HTTPException(400,{message:'Select ticket groups from this workspace.'})
 // Omission keeps valid stored bytes, rather than normalizing a selection or
 // converting a corrupt value into the deliberate zero-visibility choice.
 const ticketScopeJson=scopeProvided?(ticketScope===null?null:JSON.stringify(ticketScope)):previousScope
 const name=text(body.name,60)
 if(!name)throw new HTTPException(400,{message:'Name the role.'})
 if(!['admin','operator','collaborator'].includes(body.base))throw new HTTPException(400,{message:'Choose what the role is based on: admin, agent or collaborator.'})
 if(body.base==='admin'&&actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can create or change a role based on admin.'})
 const selection=body.knowledgeArticleIds===undefined?(previousSelection===null?null:parse(previousSelection)):body.knowledgeArticleIds
 if(selection!==null&&(!Array.isArray(selection)||selection.length>1000||selection.some((id:unknown)=>typeof id!=='string'||!id||id.length>200)))throw new HTTPException(400,{message:'Select article IDs from this workspace.'})
 const knowledgeArticleIds=selection===null?null:[...new Set(selection)] as string[]
 const previousIds=new Set<string>(previousSelection===null?[]:parse(previousSelection))
 // Retained IDs may have been deleted; only newly supplied IDs need current membership.
 if(body.knowledgeArticleIds!==undefined&&knowledgeArticleIds)for(const id of knowledgeArticleIds)if(!previousIds.has(id)&&!await c.env.DB.prepare('SELECT 1 FROM knowledge_articles WHERE project_id=? AND id=?').bind(actor.projectId,id).first())throw new HTTPException(400,{message:'Select article IDs from this workspace.'})
 return {ticketScopeJson,ticketScope,knowledgeArticleIds,name,base:body.base as 'admin'|'operator'|'collaborator',permissions:customPermissions(body.base,body.permissions)}
}

roles.post(`${P}/roles`,async c=>{
 const actor=await scope(c,true),{ticketScopeJson,...role}=await readRole(c,actor)
 await requireStepUp(c,actor,'role.create')
 const id=`role_${crypto.randomUUID()}`,now=Date.now()
 try{
  const results=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO project_roles(id,project_id,name,base,permissions_json,knowledge_article_ids,ticket_scope_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(${missingGroups})`).bind(id,actor.projectId,role.name,role.base,JSON.stringify(role.permissions),role.knowledgeArticleIds===null?null:JSON.stringify(role.knowledgeArticleIds),ticketScopeJson,now,now,JSON.stringify(role.ticketScope?.groupIds??[]),actor.projectId),
   auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'role.created',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'role',id},detail:{name:role.name,base:role.base,permissions:role.permissions,knowledgeArticleIds:role.knowledgeArticleIds,ticketScope:{before:null,after:role.ticketScope}}},now,{sql:'changes()=1',params:[]}),
  ])
  if(!results[0].meta.changes)throw new HTTPException(409,{message:'Ticket groups changed. Reload before saving the role.'})
 }catch(error){if(String(error).includes('UNIQUE'))throw new HTTPException(409,{message:'A role with this name already exists.'});throw error}
 return c.json({data:{id,...role}},201)
})

roles.put(`${P}/roles/:roleId`,async c=>{
 const actor=await scope(c,true),existing=await c.env.DB.prepare('SELECT base,knowledge_article_ids,ticket_scope_json,updated_at FROM project_roles WHERE project_id=? AND id=?').bind(actor.projectId,c.req.param('roleId')).first<{base:string;knowledge_article_ids:string|null;ticket_scope_json:string|null;updated_at:number}>()
 if(!existing)throw new HTTPException(404)
 if(existing.base==='admin'&&actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can change a role based on admin.'})
 const {ticketScopeJson,...role}=await readRole(c,actor,existing.knowledge_article_ids,existing.ticket_scope_json)
 if(role.base!==existing.base)throw new HTTPException(409,{message:'A role keeps the base it was created with. Create a new role instead.'})
 await requireStepUp(c,actor,'role.update')
 const now=Math.max(Date.now(),existing.updated_at+1)
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE project_roles SET name=?,permissions_json=?,knowledge_article_ids=?,ticket_scope_json=?,updated_at=? WHERE project_id=? AND id=? AND updated_at=? AND ticket_scope_json IS ? AND NOT EXISTS(${missingGroups})`).bind(role.name,JSON.stringify(role.permissions),role.knowledgeArticleIds===null?null:JSON.stringify(role.knowledgeArticleIds),ticketScopeJson,now,actor.projectId,c.req.param('roleId'),existing.updated_at,existing.ticket_scope_json,JSON.stringify(role.ticketScope?.groupIds??[]),actor.projectId),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'role.updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'role',id:c.req.param('roleId')},detail:{name:role.name,permissions:role.permissions,knowledgeArticleIds:role.knowledgeArticleIds,ticketScope:{before:parseTicketScope(existing.ticket_scope_json),after:role.ticketScope}}},now,{sql:'changes()=1',params:[]}),
 ]).catch(error=>{if(String(error).includes('UNIQUE'))throw new HTTPException(409,{message:'A role with this name already exists.'});throw error})
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Role or ticket groups changed. Reload before saving the role.'})
 publishAccessChange(c,actor.projectId,{roleId:c.req.param('roleId')})
 return c.json({data:{id:c.req.param('roleId'),...role}})
})

roles.delete(`${P}/roles/:roleId`,async c=>{
 const actor=await scope(c,true),roleId=c.req.param('roleId')
 const existing=await c.env.DB.prepare('SELECT base,(SELECT count(*) FROM member_roles WHERE project_id=r.project_id AND role_key=r.id) members FROM project_roles r WHERE project_id=? AND id=?').bind(actor.projectId,roleId).first<{base:string;members:number}>()
 if(!existing)throw new HTTPException(404)
 if(existing.base==='admin'&&actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can delete a role based on admin.'})
 if(existing.members)throw new HTTPException(409,{message:'Move the members who hold this role to another role first.'})
 await requireStepUp(c,actor,'role.delete')
 await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM project_roles WHERE project_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM member_roles WHERE project_id=? AND role_key=?)').bind(actor.projectId,roleId,actor.projectId,roleId),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'role.deleted',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'role',id:roleId}}),
 ])
 return c.json({deleted:true})
})

/** Following a conversation: collaborators and agents keep track of tickets they do not own. */
export const followers=new Hono<AppEnv>()
const C=`${P}/conversations/:conversationId`
followers.get(`${C}/followers`,async c=>{const {actor,conversation}=await dashboardAccess(c),list=await listFollowers(c.env,actor.projectId,conversation.id);return c.json({data:{followers:list,following:list.some(row=>row.id===actor.id)}})})
followers.post(`${C}/follow`,async c=>{const {actor,conversation}=await dashboardAccess(c);const list=await setSelfFollowing(c.env,actor,conversation.id,true,{sessionHash:c.get('sessionHash'),source:requestSource(c)});return c.json({data:{followers:list,following:true}})})
followers.delete(`${C}/follow`,async c=>{const {actor,conversation}=await dashboardAccess(c);const list=await setSelfFollowing(c.env,actor,conversation.id,false,{sessionHash:c.get('sessionHash'),source:requestSource(c)});return c.json({data:{followers:list,following:false}})})
