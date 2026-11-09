import assert from 'node:assert/strict'

// The inbox's derived state (migrations 313 and 314) equals a fresh computation from the rows it derives from:
// one entry per inbox conversation with its sort key, flags, company, ticket columns and tags, tallies that count
// exactly those entries, and one unread row per member and unread entry of the member's workspace.
const keys='project_id,group_id,assigned_to,unresolved,counts_open,ai,ai_profile,snoozed'
const fieldKeys=keys+',priority,status_category,channel,status_id'
const details='status_id,subject,brand_id,requester_id,submitter_id,submitter_type,created_at,updated_at,ticket_version'
const entryColumns=`conversation_id,project_id,contact_id,company_id,assigned_to,group_id,status_category,priority,channel,${details},sort_at,unresolved,counts_open,ai,ai_profile,snoozed,contact_revision,tags_key`
// A visitor has written here since the assistant last did (migration 314), from the messages themselves; outside auto
// that releases an assisted conversation to the team's normal views.
const waiting=`EXISTS(SELECT 1 FROM messages vm JOIN message_authorship va ON va.message_id=vm.id AND va.kind='visitor' WHERE vm.conversation_id=c.id AND NOT EXISTS(SELECT 1 FROM move_in_message_sources ims WHERE ims.message_id=vm.id) AND vm.revision>COALESCE((SELECT MAX(am.revision) FROM messages am WHERE am.conversation_id=c.id AND am.actor_role='ai'),0))`
const released=`${waiting} AND COALESCE((SELECT json_extract(settings_json,'$.ai_reply_mode') FROM project_settings WHERE project_id=c.project_id),'auto')<>'auto'`
const recomputed=`SELECT c.id conversation_id,c.project_id,c.contact_id,(SELECT cc.company_id FROM contact_companies cc WHERE cc.project_id=c.project_id AND cc.contact_id=c.contact_id) company_id,c.assigned_to,c.group_id,c.status_category,c.priority,c.channel,${details.split(',').map(column=>'c.'+column).join(',')},
 coalesce((SELECT lm.created_at FROM messages lm WHERE lm.id=c.last_message_id),c.updated_at) sort_at,c.resolved_at IS NULL unresolved,COALESCE(c.resolved_at,0)=0 counts_open,
 EXISTS(SELECT 1 FROM conversation_ai ca WHERE ca.conversation_id=c.id AND ca.ai_id IS NOT NULL) AND NOT (${released}) ai,EXISTS(SELECT 1 FROM conversation_ai ca JOIN ai_profiles ap ON ap.id=ca.ai_id WHERE ca.conversation_id=c.id) AND NOT (${released}) ai_profile,
 EXISTS(SELECT 1 FROM workflow_schedules ws WHERE ws.conversation_id=c.id AND ws.kind='snooze' AND ws.state='pending') snoozed,
 (SELECT max(msg.revision) FROM messages msg WHERE msg.conversation_id=c.id AND msg.actor_role='contact' AND NOT EXISTS(SELECT 1 FROM move_in_message_sources ims WHERE ims.message_id=msg.id)) contact_revision,
 (SELECT json_group_array(tag_id) FROM (SELECT ct.tag_id FROM conversation_tags ct WHERE ct.project_id=c.project_id AND ct.conversation_id=c.id ORDER BY ct.tag_id)) tags_key
 FROM conversations c WHERE (EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=c.id) OR EXISTS(SELECT 1 FROM conversation_notes inn WHERE inn.conversation_id=c.id)) AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL) ORDER BY c.id`
const unreadColumns='user_id,conversation_id,project_id,group_id,assigned_to,sort_at,unresolved,counts_open,ai,snoozed'
const unread=`SELECT m.user_id,${unreadColumns.split(',').slice(1).map(column=>'e.'+column).join(',')} FROM inbox_entries e JOIN memberships m ON m.project_id=e.project_id
 WHERE e.contact_revision IS NOT NULL AND e.contact_revision>coalesce((SELECT r.revision FROM conversation_reads r WHERE r.conversation_id=e.conversation_id AND r.user_id=m.user_id),0) ORDER BY m.user_id,e.conversation_id`
const grouped=(list,alias='')=>list.split(',').map(key=>alias+key).join(',')

export async function assertInboxDerived(all,label){
 assert.deepEqual(await all('SELECT conversation_id,project_id FROM inbox_visitor_waiting ORDER BY conversation_id'),await all(`SELECT c.id conversation_id,c.project_id FROM conversations c WHERE ${waiting} ORDER BY c.id`),label+': the conversations whose visitor waits')
 assert.deepEqual(await all(`SELECT ${entryColumns} FROM inbox_entries ORDER BY conversation_id`),await all(recomputed),label+': one inbox entry per inbox conversation, current')
 assert.deepEqual(await all(`SELECT ${keys},total FROM inbox_tallies WHERE total<>0 ORDER BY ${keys}`),await all(`SELECT ${keys},count(*) total FROM inbox_entries GROUP BY ${keys} ORDER BY ${keys}`),label+': inbox tallies')
 assert.deepEqual(await all(`SELECT tag_id,${fieldKeys},total FROM inbox_tag_tallies WHERE total<>0 ORDER BY tag_id,${fieldKeys}`),await all(`SELECT ct.tag_id,${grouped(fieldKeys,'e.')},count(*) total FROM inbox_entries e JOIN conversation_tags ct ON ct.conversation_id=e.conversation_id AND ct.project_id=e.project_id GROUP BY ct.tag_id,${grouped(fieldKeys,'e.')} ORDER BY ct.tag_id,${grouped(fieldKeys,'e.')}`),label+': inbox tag tallies')
 assert.deepEqual(await all(`SELECT ${fieldKeys},total FROM inbox_field_tallies WHERE total<>0 ORDER BY ${fieldKeys}`),await all(`SELECT ${fieldKeys},count(*) total FROM inbox_entries GROUP BY ${fieldKeys} ORDER BY ${fieldKeys}`),label+': inbox field tallies')
 assert.deepEqual(await all(`SELECT ${unreadColumns} FROM inbox_unread ORDER BY user_id,conversation_id`),await all(unread),label+': each member\'s unread inbox conversations')
}
