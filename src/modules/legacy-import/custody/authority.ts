import type {Env} from '../../../platform/env'
import {authority} from '../../move-in/context'
import {dbNow} from '../lease'
import {CustodyError,getCustody,type CustodyHandle,type CustodyPrincipal} from './types'
/** Native session plus the existing narrowed-role import permission, checked in each write batch. */
export function custodyPrincipal(p:CustodyPrincipal){
 const a=authority({project_id:p.projectId,actor_id:p.actorId,session_hash:p.sessionHash})
 return {sql:`(${a.sql}) AND NOT EXISTS(SELECT 1 FROM memberships m JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=? AND m.role<>'owner' AND pr.name<>'' AND (pr.base<>'admin' OR NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(pr.permissions_json) THEN pr.permissions_json ELSE '[]' END) permission WHERE permission.value='data.import')))`,params:[...a.params!,p.projectId,p.actorId]}
}
export const scopeAllowed=(scope:string)=>`NOT EXISTS(SELECT 1 FROM legacy_package_scope_fences WHERE project_id=${scope}) AND NOT EXISTS(SELECT 1 FROM contact_erasures WHERE project_id=${scope}) AND NOT EXISTS(SELECT 1 FROM contact_erasure_leases WHERE project_id=${scope})`
/** C must add this predicate to every worker scratch/canonical/checkpoint group, alongside its run/lease guards. */
export const activeCustody=`c.status IN ('admitting','ready') AND c.mapping_policy_version=2 AND c.expires_at>${dbNow} AND c.absolute_expires_at>${dbNow}
 AND ${scopeAllowed('c.custody_project_id')} AND ${scopeAllowed('c.source_project_id')}
 AND (c.destination_project_id IS NULL OR (${scopeAllowed('c.destination_project_id')}))`
export function custodyAssertion(db:D1Database,h:CustodyHandle,p?:CustodyPrincipal){
 const a=p?custodyPrincipal(p):null
 return db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=? AND c.generation=? AND ${activeCustody}${p?' AND c.custody_project_id=?':''})${a?` AND (${a.sql})`:''}`).bind(h.sha,h.generation,...(p?[p.projectId,...a!.params]:[]))
}
export async function assertCustody(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal){
 const a=custodyPrincipal(p)
 if(!(await env.DB.prepare(`SELECT (${a.sql}) ok`).bind(...a.params).first<{ok:number}>())?.ok)throw new CustodyError('import_authority_revoked',403)
 const c=await getCustody(env.DB,h.sha)
 if(!c||c.custody_project_id!==p.projectId)throw new CustodyError('custody_conflict',404)
 if(c.generation!==h.generation||!['admitting','ready'].includes(c.status))throw new CustodyError('source_invalidated')
 if(!(await env.DB.prepare(`SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=? AND ${activeCustody}`).bind(h.sha).first()))throw new CustodyError(c.expires_at<=Date.now()?'source_expired':'source_invalidated')
 return c
}
export async function custodyBatch(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal,statements:D1PreparedStatement[],checkAfter=true){
 await assertCustody(env,h,p)
 return env.DB.batch([custodyAssertion(env.DB,h,p),...statements,...(checkAfter?[custodyAssertion(env.DB,h,p)]:[]),env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
