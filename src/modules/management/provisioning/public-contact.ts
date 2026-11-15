import type {Env} from '../../../platform/env'
import type {Condition} from './condition'
import {anchorState,firstOwnerPredicate} from '../../identity/recovery-authority/first-owner'

/** Native published requests and email collection are ready with a new workspace. */
export function publicContact(env:Env,projectId:string,now:number,when:Condition):D1PreparedStatement[]{
 const form={title:'Contact support',description:'Tell us how we can help.',submitLabel:'Send request',locale:'en',enabled:true,fields:[],translations:{}}
 const pending=`${when.sql} AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=? AND json_extract(s.settings_json,'$.public_contact_provisioned')=1)`,params=[...when.params,projectId]
 return [
  env.DB.prepare(`INSERT INTO request_forms(project_id,id,config_json,enabled,updated_at) SELECT ?,'contact',?,1,? WHERE ${pending} AND NOT EXISTS(SELECT 1 FROM request_forms WHERE project_id=?)`).bind(projectId,JSON.stringify(form),now,...params,projectId),
  env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT ?,json_object('public_contact_provisioned',json('true'),'widget_settings',json_object('settings',json_object('collect',json_object('require_email',json('true'))))),? WHERE ${pending} ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(CASE WHEN json_type(project_settings.settings_json,'$.widget_settings.settings.collect.require_email') IS NULL THEN json_set(project_settings.settings_json,'$.widget_settings.settings.collect.require_email',json('true')) ELSE project_settings.settings_json END,'$.public_contact_provisioned',json('true')),updated_at=excluded.updated_at`).bind(projectId,now,...params),
 ]
}

/** An authenticated Setup mutation upgrades only the original owner's workspace. */
export async function ensureOwnerContact(env:Env,userId:string,projectId:string){
 const binding=`EXISTS(SELECT 1 FROM h2h_business_project b JOIN memberships m ON m.project_id=b.project_id AND m.user_id=b.owner_user_id AND m.role='owner' JOIN users u ON u.id=b.owner_user_id JOIN projects p ON p.id=b.project_id WHERE b.singleton=1 AND b.owner_user_id=? AND b.project_id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND (json_extract(s.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(s.settings_json,'$.suspended_at') IS NOT NULL)))`
 if(await env.DB.prepare(`SELECT 1 WHERE ${binding}`).bind(userId,projectId).first()){
  await env.DB.batch(publicContact(env,projectId,Date.now(),{sql:binding,params:[userId,projectId]}))
  return
 }
 const state=await anchorState(env)
 if(state.owner?.user_id!==userId||state.owner.project_id!==projectId)return
 const predicate=firstOwnerPredicate(env,userId,projectId)
 await env.DB.batch(publicContact(env,projectId,Date.now(),{sql:predicate.sql,params:predicate.args as (string|number|null)[]}))
}
