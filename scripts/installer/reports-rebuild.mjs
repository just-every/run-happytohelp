// Portable restores suspend business triggers. Rebuild these non-authoritative
// projections only after source rows and current triggers have been restored.
export const reportProjectionTables=['reporting_conversations','reporting_workload_items','reporting_workload_keys'];
export const reportProjectionRebuildSql=`
DELETE FROM reporting_workload_items;
DELETE FROM reporting_workload_keys;
DELETE FROM reporting_conversations;
INSERT INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT c.id,c.project_id,c.created_at,c.status_category FROM conversations c
 WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id);
`;
