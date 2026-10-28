import {createBusinessSettings,type TeamAdapter,type ManagedMember} from '../../vendor/agent-base/modules/business-settings/index.ts'
import {SettingsError} from '../../vendor/agent-base/modules/business-settings/types.ts'
import type {Env} from '../../platform/env'
import {linkedProject} from './people.ts'

export function nativeTeam(env:Env):TeamAdapter {
 return {
  async ownerEmail(){const link=await linkedProject(env);return link?(await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(link.owner_user_id).first<{email:string}>())?.email??null:null},
  async prepare({members,managed,guard}){
   const link=await linkedProject(env)
   if(!link)throw new SettingsError('native_project_link_required',409)
   const statements:D1PreparedStatement[]=[],rows:ManagedMember[]=[],desired=new Set(members.map(m=>m.email))
   for(const previous of managed)if(!desired.has(previous.email)){
    rows.push({...previous,state:'inactive'})
    if(previous.operatorId&&previous.operatorId!==link.owner_user_id){
     statements.push(env.DB.prepare(`DELETE FROM memberships WHERE project_id=? AND user_id=? AND role<>'owner' AND ${guard.sql}`).bind(link.project_id,previous.operatorId,...guard.args))
     statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE project_id=? AND actor_id=? AND ${guard.sql}`).bind(Date.now(),link.project_id,previous.operatorId,...guard.args))
    }
   }
   for(const member of members){
    const previous=managed.find(m=>m.email===member.email)
    // An applied Business id retains its native id across an email change/reassignment.
    const existing=previous?.operatorId?await env.DB.prepare('SELECT id,email FROM users WHERE id=?').bind(previous.operatorId).first<{id:string;email:string}>():await env.DB.prepare('SELECT id,email FROM users WHERE lower(email)=?').bind(member.email).first<{id:string;email:string}>()
    if(existing?.id===link.owner_user_id){rows.push({email:member.email,operatorId:null,invite:member.invite,state:'conflict'});continue}
    const id=existing?.id??crypto.randomUUID(),now=Date.now(),role=member.role==='admin'?'admin':'operator'
    const current=existing?await env.DB.prepare('SELECT role FROM memberships WHERE project_id=? AND user_id=?').bind(link.project_id,id).first<{role:string}>():null
    // Never overwrite independent native owner/custom role authority through roster sync.
    if(current?.role==='owner'){rows.push({email:member.email,operatorId:null,invite:member.invite,state:'conflict'});continue}
    if(!existing)statements.push(env.DB.prepare(`INSERT INTO users(id,email,name,created_at) SELECT ?,?,?,? WHERE ${guard.sql}`).bind(id,member.email,member.name,now,...guard.args))
    statements.push(env.DB.prepare(`INSERT INTO memberships(project_id,user_id,role) SELECT ?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM h2h_business_project WHERE singleton=1 AND project_id=? AND owner_user_id=?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role WHERE memberships.role<>'owner'`).bind(link.project_id,id,role,...guard.args,link.project_id,link.owner_user_id))
    const admitted=existing&&await env.DB.prepare('SELECT 1 FROM credentials WHERE user_id=? UNION SELECT 1 FROM sessions WHERE actor_id=? AND revoked_at IS NULL AND expires_at>?').bind(id,id,now).first()
    rows.push({email:member.email,operatorId:id,invite:member.invite,state:admitted?'active':'invited'})
   }
   return {statements,rows,async afterCommit(){}}
  },
 }
}
export function happySettings(env:Env){return createBusinessSettings({db:env.DB,trust:typeof env.RER_BUSINESS_TRUST==='string'?env.RER_BUSINESS_TRUST:null,business:{settings:1,values:['display_name'],team:{roles:{admin:'admin',member:'operator'}}},team:nativeTeam(env)})}
