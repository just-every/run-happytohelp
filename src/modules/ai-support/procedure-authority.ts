import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {activeSourceProjectSql} from '../knowledge/public-sources'
export function settingsGuard(c:Context<AppEnv>){
 return {sql:`EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=? LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE s.token_hash=? AND s.actor_id=? AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>? AND ${activeSourceProjectSql('m.project_id')} AND (m.role='owner' OR (m.role='admin' AND mr.role_key IS NULL) OR (pr.base='admin' AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='settings.manage'))))`,args:[c.req.param('projectId')!,c.get('sessionHash'),c.get('actor').id,Date.now()]}
}
