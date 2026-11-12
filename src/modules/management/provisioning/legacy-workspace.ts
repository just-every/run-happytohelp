import type {Env} from '../../../platform/env'
import type {SqlGuard} from '../../../platform/integration-authority'
import {creationCondition} from './condition'

/** Joins the core's project/settings creation transaction. No after-commit work.
 * Source settings precede this entry; only an absent settings row gets defaults.
 * A historical workspace has no starter, sender, mailbox or owner alerts. */
export function legacyWorkspaceDefaults(env:Pick<Env,'DB'>,projectId:string,guard:SqlGuard):D1PreparedStatement[]{
 const when=creationCondition(projectId,guard)
 return [
  env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT ?,?,0 WHERE ${when.sql} ON CONFLICT(project_id) DO NOTHING`).bind(projectId,JSON.stringify({default_visitor_ai_id:null,default_verified_user_ai_id:null,is_human_response_enabled:false}),...when.params),
  env.DB.prepare(`DELETE FROM workflow_rule_versions WHERE rule_id IN (SELECT id FROM workflow_rules WHERE project_id=? AND owner_id='system') AND ${when.sql}`).bind(projectId,...when.params),
  env.DB.prepare(`UPDATE workflow_rules SET state='draft',published_version=0 WHERE project_id=? AND owner_id='system' AND ${when.sql}`).bind(projectId,...when.params),
 ]
}
