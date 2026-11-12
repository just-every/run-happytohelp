import type {Env} from '../../../platform/env'
import {refuse,type Predicate} from './common'
const live=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))`
// A retained Business/import claim wins only when both retained claims agree.
// Otherwise only the unique setup timestamp relationship can select a workspace.
function anchorSql(){return `SELECT u.id user_id,p.id project_id,u.email FROM owner_setup o JOIN users u ON u.id=o.claim_id JOIN memberships m ON m.user_id=u.id AND m.role='owner' JOIN projects p ON p.id=m.project_id
 WHERE o.singleton=1 AND o.claim_id<>'existing-installation' AND ${live}
 AND (NOT EXISTS(SELECT 1 FROM h2h_business_project) OR EXISTS(SELECT 1 FROM h2h_business_project b WHERE b.singleton=1 AND b.owner_user_id=u.id AND b.project_id=p.id))
 AND (NOT EXISTS(SELECT 1 FROM h2h_import_door_claim) OR EXISTS(SELECT 1 FROM h2h_import_door_claim b WHERE b.owner_id=u.id AND b.project_id=p.id))
 AND (EXISTS(SELECT 1 FROM h2h_business_project) OR EXISTS(SELECT 1 FROM h2h_import_door_claim) OR (p.created_at=u.created_at AND (SELECT count(*) FROM memberships mm JOIN projects pp ON pp.id=mm.project_id WHERE mm.user_id=u.id AND mm.role='owner' AND pp.created_at=u.created_at)=1))`}
export interface Anchor {user_id:string;project_id:string;email:string}
export function firstOwnerPredicate(env:Env,userId:string,projectId:string):Predicate{
 const email=String(env.H2H_SETUP_OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase()
 return {sql:`EXISTS(SELECT 1 FROM (${anchorSql()}) a WHERE a.user_id=? AND a.project_id=? AND (?='' OR lower(a.email)=?))`,args:[userId,projectId,email,email]}
}
export async function anchorState(env:Env):Promise<{anchor:'bound'|'sentinel'|'ambiguous';owner?:Anchor}>{
 const singleton=await env.DB.prepare('SELECT claim_id FROM owner_setup WHERE singleton=1').first<{claim_id:string}>()
 if(singleton?.claim_id==='existing-installation')return {anchor:'sentinel'}
 const rows=(await env.DB.prepare(anchorSql()).all<Anchor>()).results
 if(rows.length!==1)return {anchor:'ambiguous'}
 const predicate=firstOwnerPredicate(env,rows[0].user_id,rows[0].project_id)
 if(!(await env.DB.prepare(`SELECT 1 WHERE ${predicate.sql}`).bind(...predicate.args).first()))return {anchor:'ambiguous'}
 return {anchor:'bound',owner:rows[0]}
}
export async function firstOwner(env:Env){const state=await anchorState(env);if(!state.owner)refuse(409,'installation_owner_binding_required');return state.owner}
