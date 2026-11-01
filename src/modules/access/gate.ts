import {parseTicketScope,type TicketScope} from './ticket-scope'
import type {Context} from 'hono'
import {matchedRoutes} from 'hono/route'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {BASE_PERMISSIONS,PERMISSIONS,ROLE_LABELS,customPermissions,type Permission} from './catalogue'
import {routeRule} from './route-permissions'
import {auditStatement,requestSource} from '../audit/record'
import {jsonResponse} from '../../platform/json-response'

export interface MemberAccess {key:string;name:string;base:'owner'|'admin'|'operator'|'collaborator';permissions:Set<Permission>;custom:boolean;knowledgeArticleIds:string[]|null;ticketScope:TicketScope}

/** A member's effective role in one workspace: built-in, the collaborator role, or a custom role over a base. */
export async function memberAccess(db:D1Database,projectId:string,userId:string):Promise<MemberAccess|null>{
 const row=await db.prepare('SELECT m.role,mr.role_key,pr.name,pr.base,pr.permissions_json,pr.knowledge_article_ids,pr.ticket_scope_json FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=?').bind(projectId,userId).first<{role:'owner'|'admin'|'operator';role_key:string|null;name:string|null;base:'admin'|'operator'|'collaborator'|null;permissions_json:string|null;knowledge_article_ids:string|null;ticket_scope_json:string|null}>()
 if(!row)return null
 if(row.role_key==='collaborator'&&row.role==='operator')return {key:'collaborator',name:ROLE_LABELS.collaborator,base:'collaborator',permissions:new Set(BASE_PERMISSIONS.collaborator),custom:false,knowledgeArticleIds:null,ticketScope:null}
 if(row.base&&row.name&&row.role!=='owner'){
  let requested:unknown=[];try{requested=JSON.parse(row.permissions_json||'[]')}catch{}
  return {key:row.role_key!,name:row.name,base:row.base,permissions:new Set(customPermissions(row.base,requested)),custom:true,knowledgeArticleIds:row.knowledge_article_ids===null?null:JSON.parse(row.knowledge_article_ids),ticketScope:parseTicketScope(row.ticket_scope_json)}
 }
 return {key:row.role,name:ROLE_LABELS[row.role],base:row.role,permissions:new Set(BASE_PERMISSIONS[row.role]),custom:false,knowledgeArticleIds:null,ticketScope:null}
}

/** The registered route that will answer this request (middleware calls see the final handler too). */
export function answeringRoute(c:Context<AppEnv>){
 const method=c.req.method==='HEAD'?'GET':c.req.method
 let routes:{method:string;path:string}[]=[]
 try{routes=matchedRoutes(c)}catch{}
 const route=[...routes].reverse().find(route=>route.method===method)
 return route?{method,path:route.path}:null
}

/** The workspace a request acts in: the path's project, else the conversation's, else the session's. */
async function targetProject(c:Context<AppEnv>,actor:Actor,path:string){
 const project=c.req.param('projectId')||c.req.param('project')
 if(project)return project
 const conversation=c.req.param('conversationId')||c.req.param('conversation')||(path.startsWith('/api/conversations/:id')?c.req.param('id'):undefined)
 if(conversation)return (await c.env.DB.prepare('SELECT project_id FROM conversations WHERE id=?').bind(conversation).first<{project_id:string}>())?.project_id||actor.projectId
 return actor.projectId
}

/**
 * Custom roles and collaborators are held to the permission each door needs; built-in
 * owner, admin and agent roles keep their handlers' own checks. A refusal is audited.
 */
export async function enforceRole(c:Context<AppEnv>,actor:Actor){
 if(actor.role==='contact')return
 // A door that cannot be identified is treated as unclassified: refused to a collaborator unless it only reads.
 const route=answeringRoute(c)??{method:c.req.method==='HEAD'?'GET':c.req.method,path:''}
 const projectId=await targetProject(c,actor,route.path)
 if(!projectId)return
 const access=await memberAccess(c.env.DB,projectId,actor.id)
 if(!access||(!access.custom&&access.base!=='collaborator'))return
 // Parent authentication middleware runs before Hono exposes a child handler's
 // parameters. Resolve its article ID against the registered route as well.
 const articleIndex=route.path.split('/').indexOf(':articleId')
 const articleId=articleIndex<0?undefined:decodeURIComponent(c.req.path.split('/')[articleIndex]??'')
 let rule=route.path?routeRule(route.method,route.path):undefined
 if(rule==='members.manage'&&/\/agents\/:userId$/.test(route.path)&&c.req.param('userId')===actor.id)rule='self'
 // A report downloaded as CSV is an export.
 if(((route.path.endsWith('/reports')||route.path.endsWith('/reports/team'))||route.path==='/api/outcomes/projects/:projectId/results')&&c.req.query('format'))rule='data.export'
 if(route.path.endsWith('/conversations/:conversationId/actions')){const body=await c.req.json().catch(()=>null);if(body?.action==='markAsRead')rule='self'}
 if(rule==='self'||rule==='none')return
 if(rule===undefined){if(route.method==='GET'||access.base!=='collaborator')return}
 else if((access.permissions.has(rule)||(rule==='knowledge.read'&&access.permissions.has('knowledge.edit')))&&!(rule==='knowledge.read'&&access.knowledgeArticleIds!==null&&articleId!==undefined&&!access.knowledgeArticleIds.includes(articleId))){
  if(rule==='knowledge.read')await auditStatement(c.env.DB,{projectId,category:'access',action:'knowledge.read',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'route',id:`${route.method} ${route.path}`},detail:{role:access.name,permission:rule}}).run()
  return
 }
 await auditStatement(c.env.DB,{projectId,category:'access',action:'permission.denied',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'route',id:`${route.method} ${route.path}`},detail:{role:access.name,...(rule?{permission:rule}:{})}}).run()
 const what=rule?PERMISSIONS[rule].toLowerCase():'do this'
 throw new HTTPException(403,{res:jsonResponse({error:`Your role (${access.name}) does not allow you to ${what}.`,code:'permission_denied',...(rule?{permission:rule}:{})},403)})
}
