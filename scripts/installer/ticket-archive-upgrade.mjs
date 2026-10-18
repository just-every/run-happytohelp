const statuses='[{"id":"new","name":"New"},{"id":"open","name":"Open"},{"id":"pending","name":"Pending"},{"id":"on_hold","name":"On-hold"},{"id":"solved","name":"Solved"},{"id":"closed","name":"Closed"}]';
/** Trigger-free restore leaves newly introduced default status rows empty.
 * Existing archives already carry these definitions and remain byte-identical. */
export const ticketRestoreSql=`INSERT OR IGNORE INTO ticket_statuses(project_id,id,name,category,is_default,active,updated_at) SELECT p.id,json_extract(s.value,'$.id'),json_extract(s.value,'$.name'),json_extract(s.value,'$.id'),1,1,p.created_at FROM projects p CROSS JOIN json_each('${statuses}') s;
UPDATE conversations SET channel='email' WHERE ticket_source='rer' AND ticket_version=0 AND EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=conversations.project_id AND e.conversation_id=conversations.id);`;
