import type {Env} from '../../platform/env'
const copies='SELECT media_id FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2'
const tickets='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const attachments=`EXISTS(SELECT 1 FROM json_each(actions_json,'$.attachments') WHERE value IN(SELECT id FROM media WHERE project_id=?1 AND conversation_id IN (${tickets}) UNION SELECT media_id FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2))`
// Reusable templates can also contain an operator's literal customer data. The
// same erasure removes those copies, including older immutable snapshots.
const identities=`json_array(source.name,source.email,source.external_id,json_extract(source.metadata_json,'$.provided_name'),json_extract(source.metadata_json,'$.provided_email'))`
const literalTemplate=`macro_versions.project_id=?1 AND EXISTS(SELECT 1 FROM contacts source WHERE source.project_id=?1 AND source.id=?2 AND (
 EXISTS(SELECT 1 FROM json_each(${identities}) identity WHERE length(trim(coalesce(identity.value,'')))>=3 AND (instr(lower(content),lower(identity.value))>0 OR instr(lower(title),lower(identity.value))>0))
 OR EXISTS(SELECT 1 FROM json_tree(actions_json,'$.fields') action WHERE action.type='text' AND action.atom<>'' AND (
 action.atom IN(SELECT value FROM json_each(${identities}))
 OR EXISTS(SELECT 1 FROM json_tree(source.metadata_json,'$.custom_fields') value WHERE value.type='text' AND value.atom=action.atom)
 OR EXISTS(SELECT 1 FROM ticket_field_values f,json_tree(f.value_json) value WHERE f.project_id=?1 AND f.conversation_id IN (${tickets}) AND value.type='text' AND value.atom=action.atom)))
))`
export const macroErasureCount=`(SELECT count(*) FROM macro_drafts WHERE project_id=?1 AND conversation_id IN (${tickets}))+(SELECT count(*) FROM macro_usage WHERE project_id=?1 AND conversation_id IN (${tickets}))+(SELECT count(*) FROM macro_versions WHERE project_id=?1 AND (${attachments} OR (${literalTemplate})))+(SELECT count(*) FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2)`
/** Drafts contain rendered identity and attachment ids; usage has actor/ticket
 * relationships. Literal customer data in templates is redacted as an explicit exception to immutable history. Remove attachment
 * references from every version before canonical media rows are erased. */
export function macroErasureObjectStatements(env:Env,projectId:string,contactId:string){return [env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media',id,object_key FROM media WHERE project_id=?1 AND id IN (${copies})`).bind(projectId,contactId)]}
export function macroErasureStatements(env:Env,projectId:string,contactId:string){return [
 env.DB.prepare(`DELETE FROM macro_drafts WHERE project_id=?1 AND usage_id IN(SELECT u.id FROM macro_usage u JOIN macro_versions ON macro_versions.macro_id=u.macro_id AND macro_versions.version=u.version WHERE u.project_id=?1 AND ${literalTemplate})`).bind(projectId,contactId),
 env.DB.prepare(`UPDATE macro_heads SET archived_at=coalesce(archived_at,0) WHERE macro_id IN(SELECT macro_id FROM macro_versions WHERE ${literalTemplate} AND version=macro_heads.version)`).bind(projectId,contactId),
 env.DB.prepare(`UPDATE macros SET title='Erased reply',content='' WHERE project_id=?1 AND id IN(SELECT macro_id FROM macro_versions WHERE ${literalTemplate} AND version=(SELECT version FROM macro_heads WHERE macro_id=macros.id))`).bind(projectId,contactId),
 env.DB.prepare(`UPDATE macro_versions SET title='Erased reply',content='',actions_json='{}' WHERE ${literalTemplate}`).bind(projectId,contactId),
 env.DB.prepare(`UPDATE macro_drafts SET media_ids_json=coalesce((SELECT json_group_array(value) FROM json_each(macro_drafts.media_ids_json) WHERE value NOT IN (${copies})),'[]') WHERE project_id=?1 AND EXISTS(SELECT 1 FROM json_each(media_ids_json) WHERE value IN (${copies}))`).bind(projectId,contactId),
 env.DB.prepare(`UPDATE macro_versions SET actions_json=json_set(actions_json,'$.attachments',json(coalesce((SELECT json_group_array(value) FROM json_each(macro_versions.actions_json,'$.attachments') WHERE value NOT IN (SELECT id FROM media WHERE project_id=?1 AND conversation_id IN (${tickets}) UNION SELECT media_id FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2)),'[]'))) WHERE project_id=?1 AND EXISTS(SELECT 1 FROM json_each(actions_json,'$.attachments') WHERE value IN (SELECT id FROM media WHERE project_id=?1 AND conversation_id IN (${tickets}) UNION SELECT media_id FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2))`).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM media WHERE project_id=?1 AND id IN (${copies})`).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM macro_drafts WHERE project_id=?1 AND conversation_id IN (${tickets})`).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM macro_usage WHERE project_id=?1 AND conversation_id IN (${tickets})`).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM macro_attachment_copies WHERE project_id=?1 AND (source_contact_id=?2 OR media_id IN(SELECT id FROM media WHERE project_id=?1 AND conversation_id IN (${tickets}) UNION SELECT media_id FROM macro_attachment_copies WHERE project_id=?1 AND source_contact_id=?2))`).bind(projectId,contactId),
 ]}
