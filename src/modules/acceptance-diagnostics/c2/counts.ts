/** These are project totals, including contact-role messages rather than all human messages. */
export async function projectCounts(db:D1Database,projectId:string){
 return db.prepare(`SELECT
 (SELECT count(*) FROM conversations WHERE project_id=?1) conversations,
 (SELECT count(*) FROM messages WHERE project_id=?1) messages,
 (SELECT count(*) FROM messages WHERE project_id=?1 AND actor_role='contact') customerMessages,
 (SELECT count(*) FROM inbound_emails WHERE project_id=?1) inboundEmails,
 (SELECT count(*) FROM suspended_emails WHERE project_id=?1) suspended,
 (SELECT count(*) FROM email_reply_grants WHERE project_id=?1) replyGrants,
 (SELECT count(*) FROM email_deliveries WHERE project_id=?1) deliveries,
 (SELECT count(*) FROM contacts WHERE project_id=?1) contacts,
 (SELECT count(*) FROM knowledge_reply_blocks WHERE project_id=?1) replyBlocks,
 (SELECT count(*) FROM knowledge_index_dirty WHERE project_id=?1) indexDirty,
 (SELECT count(*) FROM knowledge_shingles WHERE project_id=?1) shingles,
 (SELECT count(*) FROM knowledge_articles WHERE project_id=?1) articles,
 (SELECT count(*) FROM knowledge_articles WHERE project_id=?1 AND status='published') published
 `).bind(projectId).first()
}
