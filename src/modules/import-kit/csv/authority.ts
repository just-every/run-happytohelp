import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../../platform/env'
import {issuerGuard} from '../../../platform/integration-authority'
import {scope} from '../../management/common'
import {memberAccess} from '../../access/gate'
import {STEP_UP_MS} from '../../identity/two-factor/state'
import {epochSql,stale} from './store'

export async function csvScope(c:Context<AppEnv>){
 const actor=await scope(c,true),access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access?.permissions.has('data.import'))throw new HTTPException(403,{message:'Import data permission required'})
 return {...actor,role:actor.role as Actor['role']}
}
/** Authorization is asserted in the same transaction as every customer mutation. */
export async function authorization(c:Context<AppEnv>,actor:Actor,stepUp:boolean){
 const guard=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const permission=`EXISTS(SELECT 1 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=? AND (m.role='owner' OR (m.role='admin' AND (pr.id IS NULL AND coalesce(mr.role_key,'')<>'collaborator' OR pr.base='admin' AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='data.import')))))`
 let sql=`EXISTS(${guard.sql}) AND ${permission}`,params=[...guard.params,actor.projectId,actor.id]
 if(stepUp&&!actor.security?.installation){
  sql+=` AND EXISTS(SELECT 1 FROM session_factors sf WHERE sf.token_hash=? AND sf.user_id=? AND sf.verified_at>=max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-?) AND (NOT EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=sf.user_id AND f.confirmed_at IS NOT NULL) OR sf.method IN ('totp','webauthn','recovery','installation')))`
  params.push(c.get('sessionHash'),actor.id,Date.now()-STEP_UP_MS,STEP_UP_MS)
 }
 return {sql,params}
}
export async function commit(c:Context<AppEnv>,actor:Actor,epoch:number,statements:D1PreparedStatement[],options:{runId?:string;status?:string;stepUp?:boolean}={}){
 const auth=await authorization(c,actor,Boolean(options.stepUp)),params=[actor.projectId,epoch,...auth.params]
 let condition=`${epochSql}=? AND (${auth.sql})`
 if(options.runId){condition+=' AND EXISTS(SELECT 1 FROM csv_customer_imports WHERE id=? AND project_id=? AND status=?)';params.push(options.runId,actor.projectId,options.status!)}
 const assertion=c.env.DB.prepare(`INSERT INTO csv_customer_assertions(ok) SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(...params)
 try{await c.env.DB.batch([assertion,...statements,c.env.DB.prepare('DELETE FROM csv_customer_assertions')])}
 catch(error){
  if(error instanceof Error&&/CHECK constraint|FOREIGN KEY constraint|UNIQUE constraint|csv_customer_assertions/i.test(error.message))throw stale()
  throw error
 }
}
