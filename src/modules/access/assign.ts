import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,ActorSecurity} from '../../platform/env'
import {auditStatement,requestSource} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {memberAccess} from './gate'
import {ROLE_LABELS,customPermissions} from './catalogue'
import {endHandleTimers} from '../reports/timers'

type MembershipRole='owner'|'admin'|'operator'
/** Where a role choice lands: the membership's base role and, for collaborators and custom roles, the narrower role. */
async function resolveRole(db:D1Database,projectId:string,value:unknown):Promise<{membership:MembershipRole;roleKey:string|null;managesTickets:boolean}>{
 if(value==='owner'||value==='admin'||value==='operator')return {membership:value,roleKey:null,managesTickets:true}
 if(value==='collaborator')return {membership:'operator',roleKey:'collaborator',managesTickets:false}
 const custom=typeof value==='string'?await db.prepare('SELECT id,base,permissions_json FROM project_roles WHERE project_id=? AND id=?').bind(projectId,value).first<{id:string;base:'admin'|'operator'|'collaborator';permissions_json:string|null}>():null
 if(!custom)throw new HTTPException(400,{message:'Choose an existing role.'})
 let requested:unknown=[];try{requested=JSON.parse(custom.permissions_json||'[]')}catch{}
 return {membership:custom.base==='admin'?'admin':'operator',roleKey:custom.id,managesTickets:custom.base!=='collaborator'&&customPermissions(custom.base,requested).includes('conversations.manage')}
}

/**
 * Changes a member's role: owners may grant anything, admins only roles over the agent
 * base to members on it. The last owner stays; a changed base role ends the member's
 * sessions in this workspace, and a role without ticket management ends their running handle timers. Needs a recent step-up and is audited.
 */
export async function assignRole(c:Context<AppEnv>,actor:{id:string;projectId:string;role:string;security?:ActorSecurity},userId:string,value:unknown){
 const db=c.env.DB,target=await resolveRole(db,actor.projectId,value)
 const current=await memberAccess(db,actor.projectId,userId)
 if(!current)throw new HTTPException(409,{message:'Membership missing'})
 const currentKey=current.custom||current.key==='collaborator'?current.key:current.base
 const nextKey=target.roleKey??target.membership
 if(currentKey===nextKey)return {changed:false}
 const currentBase=current.base==='collaborator'?'operator':current.base
 if(!['owner','admin'].includes(actor.role))throw new HTTPException(403)
 if(actor.role!=='owner'&&(currentBase!=='operator'||target.membership!=='operator'))throw new HTTPException(403,{message:'Only an owner can grant or change the owner and admin roles.'})
 // The last owner stays an owner: refused before any step-up is asked for.
 if(current.base==='owner'&&target.membership!=='owner'&&((await db.prepare("SELECT count(*) n FROM memberships WHERE project_id=? AND role='owner'").bind(actor.projectId).first<{n:number}>())?.n??0)<=1)throw new HTTPException(409,{message:'Membership missing or last owner protected'})
 await requireStepUp(c,actor,'member.role_change')
 const now=Date.now(),nextName=target.roleKey==='collaborator'?'Collaborator':target.roleKey?(await db.prepare('SELECT name FROM project_roles WHERE id=?').bind(target.roleKey).first<{name:string}>())?.name??target.roleKey:ROLE_LABELS[target.membership]
 const results=await db.batch([db.prepare(`UPDATE memberships SET role=? WHERE project_id=? AND user_id=? AND (role='operator' OR ?='owner')
   AND (role!='owner' OR ?='owner' OR (SELECT count(*) FROM memberships WHERE project_id=? AND role='owner')>1)`).bind(target.membership,actor.projectId,userId,actor.role,target.membership,actor.projectId),
])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Membership missing or last owner protected'})
 await db.batch([
  db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(actor.projectId,userId),
  ...(target.roleKey?[db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,?)').bind(actor.projectId,userId,target.roleKey,now)]:[]),
  db.prepare('UPDATE sessions SET revoked_at=? WHERE project_id=? AND actor_id=? AND role<>? AND revoked_at IS NULL').bind(now,actor.projectId,userId,target.membership),
  ...(target.managesTickets?[]:[endHandleTimers(db,actor.projectId,userId,now)]),
  auditStatement(db,{projectId:actor.projectId,category:'access',action:'member.role_changed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'member',id:userId},detail:{from:currentKey,to:nextKey,fromName:current.name,toName:nextName}},now),
 ])
 return {changed:true}
}
