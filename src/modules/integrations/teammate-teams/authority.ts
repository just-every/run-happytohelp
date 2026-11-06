import type {Env} from '../../../platform/env'
import {liveConnection} from '../../support-channels/model'

/** Newest installation audit evidence is intentionally required. Purged or erased
 * evidence cannot silently turn an old support-channel install into notification consent. */
export const administratorSql=(project:string,user:string)=>`EXISTS(SELECT 1 FROM memberships am
 LEFT JOIN member_roles ar ON ar.project_id=am.project_id AND ar.user_id=am.user_id
 LEFT JOIN project_roles ap ON ap.project_id=ar.project_id AND ap.id=ar.role_key
 WHERE am.project_id=${project} AND am.user_id=${user} AND am.role IN ('owner','admin')
 AND (am.role='owner' OR (ap.id IS NULL AND coalesce(ar.role_key,'admin')='admin') OR
 (ap.base='admin' AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(ap.permissions_json) THEN ap.permissions_json ELSE '[]' END) WHERE value='integrations.install'))))`
export const installationSql=(k='k')=>`EXISTS(SELECT 1 FROM support_channel_connections WHERE id=${k}.connection_id AND project_id=${k}.project_id AND provider='teams' AND ${liveConnection}
 AND ${administratorSql('support_channel_connections.project_id',`(SELECT a.actor_id FROM audit_events a WHERE a.project_id=support_channel_connections.project_id AND a.target_type='support_channel' AND a.target_id=support_channel_connections.id AND a.action='support_channel.connected' ORDER BY a.at DESC,a.rowid DESC LIMIT 1)`)})
 AND ${administratorSql(k+'.project_id',k+'.user_id')}`
export async function connectionAvailable(env:Env,projectId:string){
 return env.DB.prepare(`SELECT k.connection_id FROM teammate_teams_consent k WHERE k.project_id=? AND ${installationSql()}`).bind(projectId).first<{connection_id:string}>()
}
