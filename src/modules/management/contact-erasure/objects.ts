import {contactKeys} from '../../api-integrations/requester-admission'
import {fenceImportErasure,type ErasureIdentity} from '../../move-in/erasure'
import type {Env} from '../../../platform/env'
import {localJobs,media} from './scope'
import {fenceAdmittedIdentity} from './admitted-identity'
import {macroErasureObjectStatements} from '../../macros/erasure'
import {conversationActionErasureStage} from '../../conversation-actions/erasure'
import {emailErasureObjectStatements} from '../../integrations/email-erasure'
import {contactEmails} from './identity'

const R2_DELETE_LIMIT = 1000

/**
 * Stop new writes by the contact, then record every R2 object to remove. The ledger
 * survives a failed request, so a retried erasure deletes the same objects again.
 */
export async function fenceAndStage(env: Env, projectId: string, contactId: string, now: number, identity?:ErasureIdentity) {
  const snapshot=identity??await env.DB.prepare('SELECT email,external_id,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<ErasureIdentity>()??{}
  const apiKeys=await contactKeys(env,projectId,contactId)
  const bound = (sql: string) => env.DB.prepare(sql).bind(projectId, contactId)
  await fenceAdmittedIdentity(env,projectId,contactId,snapshot,[
    ...apiKeys.map(key=>env.DB.prepare('INSERT OR IGNORE INTO api_erased_keys(project_id,digest) VALUES(?,?)').bind(projectId,key.digest)),
    bound(`INSERT OR IGNORE INTO api_erasure_inventory SELECT ?1,?2,
     (SELECT count(*) FROM api_requests WHERE project_id=?1 AND contact_id=?2 AND response_json IS NOT NULL),
     (SELECT count(*) FROM api_appends WHERE project_id=?1 AND contact_id=?2),
     (SELECT count(*) FROM api_notes WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)),
     (SELECT count(*) FROM integration_deliveries WHERE namespace=?1 AND id IN (SELECT i.id FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id WHERE e.project_id=?1 AND e.contact_id=?2)),
     (SELECT count(*) FROM api_requests WHERE project_id=?1 AND contact_id=?2 AND held_id IS NOT NULL AND erased=0)
     WHERE EXISTS(SELECT 1 FROM contacts WHERE project_id=?1 AND id=?2)`),
    bound(conversationActionErasureStage),
    ...macroErasureObjectStatements(env,projectId,contactId),
    env.DB.prepare("UPDATE contacts SET metadata_json=CASE WHEN json_valid(metadata_json) THEN json_set(metadata_json,'$.is_blocked',1,'$.is_deleted',1,'$.is_erasing',1) ELSE json_object('is_blocked',1,'is_deleted',1,'is_erasing',1) END WHERE project_id=?1 AND id=?2").bind(projectId, contactId),
    env.DB.prepare('UPDATE sessions SET revoked_at=coalesce(revoked_at,?3) WHERE project_id=?1 AND contact_id=?2').bind(projectId, contactId, now),
    bound(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media',id,object_key FROM media WHERE ${media}`),
    bound(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'local_attachment',id,storage_key FROM local_attachments WHERE job_id IN (${localJobs})`),
    ...emailErasureObjectStatements(env,projectId,contactId,contactEmails(snapshot)),
  ])
  return fenceImportErasure(env,projectId,contactId)
}

/** Delete staged objects from R2. Deleting an absent key succeeds, so retries are safe. */
export async function deleteStagedObjects(env: Env, projectId: string, contactId: string) {
  let after='',total=0
  for(;;){const rows=(await env.DB.prepare('SELECT object_key FROM contact_erasure_objects WHERE project_id=?1 AND contact_id=?2 AND object_key>?3 UNION SELECT object_key FROM move_in_erasure_objects WHERE project_id=?1 AND contact_id=?2 AND object_key>?3 ORDER BY object_key LIMIT ?4').bind(projectId,contactId,after,R2_DELETE_LIMIT).all<{object_key:string}>()).results
    if(!rows.length)break
    await env.FILES.delete(rows.map(row=>row.object_key));total+=rows.length;after=rows.at(-1)!.object_key
  }
  return total
}
