import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {livePortalContact} from '../portal/identity'
import type {EmailAuthority} from '../integrations/email-authority'

/** Recheck the preview, requester, explicit preference and current operator role
 * inside the transaction that claims the email, including outbox recovery. */
export async function serviceNoticeEmailAuthority(env:Env,projectId:string,conversationId:string,localId:string):Promise<EmailAuthority|undefined>{
 const row=await env.DB.prepare(`SELECT command.actor_id,command.service_notice_id,ct.id,ct.email,ct.metadata_json,m.role,mr.role_key,pr.updated_at,notice.created_at
 FROM operator_ticket_commands command JOIN conversations c ON c.id=command.conversation_id AND c.project_id=command.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id
 LEFT JOIN operator_service_notices notice ON notice.id=command.service_notice_id AND notice.project_id=command.project_id AND notice.actor_id=command.actor_id
 LEFT JOIN memberships m ON m.project_id=command.project_id AND m.user_id=command.actor_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key
 WHERE command.project_id=? AND command.conversation_id=? AND command.local_id=? AND command.service_notice_id IS NOT NULL`).bind(projectId,conversationId,localId).first<any>()
 if(!row)return
 const access=await memberAccess(env.DB,projectId,row.actor_id)
 if(!access?.permissions.has('conversations.reply'))throw new HTTPException(403,{message:'Service notice operator authority was revoked'})
 return {sql:`EXISTS(SELECT 1 FROM operator_service_notices n JOIN json_each(n.plan_json,'$.recipients') recipient JOIN contacts ct ON ct.id=json_extract(recipient.value,'$.id') AND ct.project_id=n.project_id JOIN memberships m ON m.project_id=n.project_id AND m.user_id=n.actor_id WHERE n.id=? AND n.project_id=? AND n.actor_id=? AND n.created_at>? AND ct.id=? AND ct.email=json_extract(recipient.value,'$.email') AND ct.metadata_json=json_extract(recipient.value,'$.metadata_json') AND ${livePortalContact()} AND json_extract(ct.metadata_json,'$.portal_notification_emails')=1 AND EXISTS(SELECT 1 FROM portal_preferences preference WHERE preference.project_id=ct.project_id AND preference.contact_id=ct.id AND preference.update_emails=1) AND m.role=? AND (SELECT role_key FROM member_roles WHERE project_id=m.project_id AND user_id=m.user_id) IS ? AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=m.project_id AND mr.user_id=m.user_id) IS ?)`,params:[row.service_notice_id,projectId,row.actor_id,Date.now()-15*60000,row.id,row.role,row.role_key??null,row.updated_at??null]}
}
