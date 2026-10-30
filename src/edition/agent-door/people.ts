import {Hono} from 'hono'
import type {Actor,AppEnv,Env} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {memberAccess} from '../../modules/access/gate'
import {policyRoles} from '../../modules/identity/two-factor/state'
import type {PeopleAdapter,Person} from '../../vendor/agent-base/modules/agent-door/index.ts'

export interface LinkedProject {project_id:string;owner_user_id:string}
export const linkedProject=(env:Env)=>env.DB.prepare('SELECT project_id,owner_user_id FROM h2h_business_project WHERE singleton=1').first<LinkedProject>()
export async function nativePerson(env:Env,id:string):Promise<Person|null>{
 const row=await env.DB.prepare(`SELECT u.id,u.email,u.name,m.role,ps.settings_json,
 (EXISTS(SELECT 1 FROM credentials credential WHERE credential.user_id=u.id) OR EXISTS(SELECT 1 FROM sessions session JOIN session_factors proof ON proof.token_hash=session.token_hash WHERE session.actor_id=u.id AND session.revoked_at IS NULL AND session.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) admitted,
 EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=u.id AND f.confirmed_at IS NOT NULL) has_factor
 FROM h2h_business_project b JOIN users u ON u.id=? JOIN memberships m ON m.project_id=b.project_id AND m.user_id=u.id JOIN projects p ON p.id=m.project_id
 LEFT JOIN project_settings ps ON ps.project_id=p.id WHERE b.singleton=1 AND json_extract(COALESCE(ps.settings_json,'{}'),'$.deleted_at') IS NULL AND json_extract(COALESCE(ps.settings_json,'{}'),'$.suspended_at') IS NULL`).bind(id).first<{id:string;email:string;name:string;role:string;settings_json:string|null;has_factor:number;admitted:number}>()
 if(!row||!row.admitted)return null
 const link=await linkedProject(env),access=await memberAccess(env.DB,link!.project_id,id)
 if(!access)return null
 const settings=JSON.parse(row.settings_json??'{}')
 if(policyRoles(settings.two_factor_roles).includes(access.base)&&!row.has_factor)return null
 return {id:row.id,email:row.email,name:row.name,role:access.key,active:true}
}
/** Native cookies stay native cookies. Business JWT email is never passed here. */
export async function nativeSession(env:Env,request:Request):Promise<Actor|null>{
 let actor:Actor|null=null
 const router=new Hono<AppEnv>()
 router.all('*',async c=>{try{actor=await requireActor(c);return new Response(null,{status:204})}catch{return new Response(null,{status:401})}})
 await router.fetch(request,env)
 return actor&&((actor as Actor).role!=='contact')?actor:null
}
export function happyPeople(env:Env):PeopleAdapter {
 const read=(id:string)=>nativePerson(env,id)
 return {
  person:read,
  async sponsor({sub}){
   const link=await linkedProject(env)
   if(!link)return null
   const owner=await env.DB.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id:string|null}>()
   if(!owner)return null
   if(owner.owner_id===sub)return read(link.owner_user_id)
   const rows=await env.DB.prepare("SELECT operator_id FROM bs_team WHERE business_id=? AND state IN ('active','invited')").bind(sub).all<{operator_id:string|null}>()
   return rows.results.length===1&&rows.results[0].operator_id?read(rows.results[0].operator_id):null
  },
  async session(request){const actor=await nativeSession(env,request),link=await linkedProject(env);return actor&&link&&actor.projectId===link.project_id?read(actor.id):null},
  businessRole:person=>person.role==='owner'?'owner':person.role==='admin'?'editor':null,
  async businessMember(person){
   const link=await linkedProject(env),state=await env.DB.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id:string|null}>()
   if(!link||!state||!await read(person.id))return null
   if(link.owner_user_id===person.id&&state.owner_id)return {id:state.owner_id,role:'owner'}
   const rows=await env.DB.prepare("SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND state IN ('active','invited') AND business_id IS NOT NULL").bind(person.id).all<{business_id:string;business_role:string}>()
   return rows.results.length===1?{id:rows.results[0].business_id,role:rows.results[0].business_role==='admin'?'editor':null}:null
  },
 }
}
