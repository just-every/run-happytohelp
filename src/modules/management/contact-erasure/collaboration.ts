import type {Env} from '../../../platform/env'
import {macroErasureCount,macroErasureStatements} from '../../macros/erasure'
import {notificationErasureStatements} from '../../integrations/triggers/erasure'
import {collaborationErasureSql,collaborationMediaErasureSql} from '../../collaboration/erasure'
import {conversationActionErasureCount,conversationActionErasureStatements} from '../../conversation-actions/erasure'
const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
/** R4 records are included in the existing ticket-record erasure count. */
export const collaborationRecordsCount=`(${macroErasureCount})+(${conversationActionErasureCount})
 +(SELECT count(*) FROM notification_inbox WHERE project_id=?1 AND conversation_id IN (${owned}))
 +(SELECT count(*) FROM notification_trigger_claims WHERE project_id=?1 AND outcome_json<>'{}' AND conversation_id IN (${owned}))
 +(SELECT count(*) FROM conversation_note_mentions WHERE note_id IN (SELECT id FROM conversation_notes WHERE conversation_id IN (${owned})))
 +(SELECT count(*) FROM conversation_note_media WHERE note_id IN (SELECT id FROM conversation_notes WHERE conversation_id IN (${owned})))
 +(SELECT count(*) FROM conversation_followers WHERE conversation_id IN (${owned}))`
export function collaborationRecordsStatements(env:Env,projectId:string,contactId:string){return [
 ...macroErasureStatements(env,projectId,contactId),
 ...notificationErasureStatements(env,projectId,contactId),
 env.DB.prepare(collaborationErasureSql).bind(projectId,contactId),
 env.DB.prepare(collaborationMediaErasureSql).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM conversation_followers WHERE conversation_id IN (${owned})`).bind(projectId,contactId),
 ...conversationActionErasureStatements(env,projectId,contactId),
]}
