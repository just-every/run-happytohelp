import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv,Actor} from '../../platform/env'
import {auditStatement,requestSource} from '../audit/record'

/** SQL expressions are call-site constants; member ids always use bound values.
 * null means all teams; [] means no tickets, including unassigned tickets. */
export function ticketScopeSql(user:string,alias='c'){
 return `NOT EXISTS(SELECT 1 FROM member_roles scope_member JOIN project_roles scope_role ON scope_role.project_id=scope_member.project_id AND scope_role.id=scope_member.role_key WHERE scope_member.project_id=${alias}.project_id AND scope_member.user_id=${user} AND scope_role.team_ids_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM json_each(scope_role.team_ids_json) allowed_team WHERE allowed_team.value=${alias}.group_id))`
}
export async function enforceTicketScope(c:Context<AppEnv>,actor:Actor,projectId:string,teams:string[],path:string){
 const conversation=c.req.param('conversationId')||c.req.param('conversation')||(path.startsWith('/api/conversations/:id')?c.req.param('id'):undefined)
 let allowed=false
 if(conversation){
  const row=await c.env.DB.prepare('SELECT group_id FROM conversations WHERE id=? AND project_id=?').bind(conversation,projectId).first<{group_id:string|null}>()
  allowed=Boolean(row?.group_id&&teams.includes(row.group_id))
  // Scope changes cannot move a ticket into an unpermitted team through a general update door.
  if(allowed&&!['GET','HEAD','DELETE'].includes(c.req.method)&&c.req.header('Content-Type')?.includes('application/json')){
   const body=await c.req.json().catch(()=>null)
   if(body&&'group_id' in body)allowed=teams.includes(body.group_id)
  }
 }else{
  // The known listing and stream doors apply the same row predicate. Other
  // bulk/customer/export/report doors stay closed to a team-limited seat.
  allowed=c.req.method==='GET'&&(/^(?:\/api\/dashboard(?:\/projects\/:projectId)?)\/conversations(?:\/counts)?$/.test(path)||path==='/api/conversations'||path==='/api/management/bootstrap'||path==='/api/projects/:projectId/socket'||path.startsWith('/api/knowledge/:projectId/')||/\/ticket-settings$/.test(path))
  if(path.startsWith('/api/identity/')||path==='/auth/signout'||path==='/api/management/profile')allowed=true
 }
 if(allowed)return
 await auditStatement(c.env.DB,{projectId,category:'access',action:'team_scope.denied',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'route',id:path}}).run()
 throw new HTTPException(403,{message:'This role is limited to its selected ticket teams'})
}
