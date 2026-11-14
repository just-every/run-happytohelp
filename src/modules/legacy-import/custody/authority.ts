import {rehearsalPredicate,rehearsalStoredPredicate,assertRehearsal} from '../../rehearsal/authority'
import {expectedOwnerEmail} from '../adoption/authority'
import type {Env} from '../../../platform/env'
import {authority} from '../../move-in/context'
import {dbNow} from '../lease'
import {scopeAllowed} from './scope'
import {CustodyError,getCustody,type CustodyHandle,type CustodyPrincipal} from './types'
/** Native session plus the existing narrowed-role import permission, checked in each write batch. */
export function custodyPrincipal(p:CustodyPrincipal){
 if(p.authorityMode==='rehearsal'){
  if(!p.rehearsalId||!p.rehearsalGeneration||!p.rehearsalProjectId)return {sql:'0',params:[]}
  const a=rehearsalPredicate({rehearsal_id:p.rehearsalId,rehearsal_generation:p.rehearsalGeneration},p.rehearsalProjectId,'legacy')
  return {sql:`EXISTS(${a.sql}) AND EXISTS(SELECT 1 FROM rehearsal_grants WHERE id=? AND generation=? AND owner_id=? AND setup_project_id=?)`,params:[...a.params,p.rehearsalId,p.rehearsalGeneration,p.actorId,p.projectId]}
 }
 const a=authority({project_id:p.projectId,actor_id:p.actorId,session_hash:p.sessionHash})
 return {sql:`(${a.sql}) AND NOT EXISTS(SELECT 1 FROM memberships m JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=? AND m.role<>'owner' AND pr.name<>'' AND (pr.base<>'admin' OR NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(pr.permissions_json) THEN pr.permissions_json ELSE '[]' END) permission WHERE permission.value='data.import')))`,params:[...a.params!,p.projectId,p.actorId]}
}
export {scopeAllowed} from './scope'
/** C must add this predicate to every worker scratch/canonical/checkpoint group, alongside its run/lease guards. */
export const activeCustody=`c.status IN ('admitting','ready') AND c.mapping_policy_version=2 AND c.cleanup_only=0 AND c.seeding_complete=1 AND c.retention_state IN ('upload','progress','paused','stopped','resume','complete') AND c.expires_at>${dbNow} AND c.absolute_expires_at>${dbNow}
 AND ${scopeAllowed('c.custody_project_id')} AND ${scopeAllowed('c.source_project_id')}
 AND (c.destination_project_id IS NULL OR (${scopeAllowed('c.destination_project_id')}))`
/** Stored SHA discriminates unattended worker callers; session bytes are never
 * interpreted as consent. Interactive intake explicitly requests session mode. */
export function custodyAssertion(db:D1Database,h:CustodyHandle,p?:CustodyPrincipal,expectedEmail?:string){
 const native=p?custodyPrincipal({...p,authorityMode:'session'}):null
 const detached=rehearsalStoredPredicate({idSql:'c.rehearsal_id',generationSql:'c.rehearsal_generation',projectSql:'c.source_project_id'},'legacy',expectedEmail)
 const machine=`c.authority_mode='rehearsal' AND EXISTS(${detached.sql})${p?' AND EXISTS(SELECT 1 FROM rehearsal_grants cg WHERE cg.id=c.rehearsal_id AND cg.generation=c.rehearsal_generation AND cg.owner_id=? AND cg.setup_project_id=?)':''}`
 const session=`c.authority_mode='session'${native?` AND (${native.sql})`:''}`
 return db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=? AND c.generation=? AND ${activeCustody}${p?' AND c.custody_project_id=?':''}${p?.authorityMode?' AND c.authority_mode=?':''} AND ((${machine}) OR (${session})))`).bind(h.sha,h.generation,...(p?[p.projectId]:[]),...(p?.authorityMode?[p.authorityMode]:[]),...detached.params,...(p?[p.actorId,p.projectId]:[]),...(native?.params??[]))
}
export async function assertCustody(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal){
 const c=await getCustody(env.DB,h.sha)
 if(!c||c.custody_project_id!==p.projectId)throw new CustodyError('custody_conflict',404)
 if(p.authorityMode&&c.authority_mode!==p.authorityMode)throw new CustodyError('import_authority_revoked',403)
 if(c.authority_mode==='rehearsal'){
  if(!c.rehearsal_id||!c.rehearsal_generation)throw new CustodyError('import_authority_revoked',403)
  if(p.rehearsalId&&p.rehearsalId!==c.rehearsal_id||p.rehearsalGeneration&&p.rehearsalGeneration!==c.rehearsal_generation)throw new CustodyError('import_authority_revoked',403)
  const g=await assertRehearsal(env as Env,{rehearsal_id:c.rehearsal_id,rehearsal_generation:c.rehearsal_generation},c.source_project_id,'legacy')
  if(g.owner_id!==p.actorId||g.setup_project_id!==p.projectId)throw new CustodyError('import_authority_revoked',403)
 }else{
  const a=custodyPrincipal(p)
  if(!(await env.DB.prepare(`SELECT (${a.sql}) ok`).bind(...a.params).first<{ok:number}>())?.ok)throw new CustodyError('import_authority_revoked',403)
 }
 if(c.generation!==h.generation||!['admitting','ready'].includes(c.status))throw new CustodyError('source_invalidated')
 if(!(await env.DB.prepare(`SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=? AND ${activeCustody}`).bind(h.sha).first()))throw new CustodyError(c.expires_at<=Date.now()?'source_expired':'source_invalidated')
 return c
}
export async function custodyBatch(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal,statements:D1PreparedStatement[],checkAfter=true){
 await assertCustody(env,h,p)
 return env.DB.batch([custodyAssertion(env.DB,h,p,expectedOwnerEmail(env as Env)),...statements,...(checkAfter?[custodyAssertion(env.DB,h,p,expectedOwnerEmail(env as Env))]:[]),env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
