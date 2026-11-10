/** What a full import leaves besides the rows it maps: imported history is history, never the team's work queue.
 *
 * - **Default rules.** Every new workspace is born with the published default time rule "Close solved tickets after 4
 *   days" (migration 152, `workflow_project_close_default`). A legacy workspace never had it, and with thousands of
 *   imported solved conversations its first scheduler run would close them (closed is final). The rule of each workspace
 *   this batch inserts is put back to a draft with no published version; the owner publishes it from the workflow page
 *   when they want it. `publishDefaultRules` keeps it published as a new workspace has it.
 * - **Reads.** Unread is per member (`conversation_reads`, migration 313's `inbox_unread`). Each conversation this batch
 *   inserts is marked read, up to its last message, for every member the workspace has at that point (members are
 *   imported before conversations). `leaveUnread` leaves them as a native conversation would be: unread until opened.
 *   Delta sweeps never mark anything read: what legacy took after the export is work. */
export const defaultRuleId=(projectId:string)=>`workflow:auto-close:${projectId}`

export function importedHistoryStatements(db:D1Database,{projects,conversations,publishDefaultRules=false,leaveUnread=false}:{projects:string[];conversations:string[];publishDefaultRules?:boolean;leaveUnread?:boolean}){
 const statements:D1PreparedStatement[]=[]
 if(projects.length&&!publishDefaultRules){
  const rules=JSON.stringify(projects.map(defaultRuleId))
  statements.push(
   db.prepare("DELETE FROM workflow_rule_versions WHERE rule_id IN (SELECT r.id FROM workflow_rules r WHERE r.id IN (SELECT value FROM json_each(?)) AND r.owner_id='system' AND r.state='published' AND r.published_version=1)").bind(rules),
   db.prepare("UPDATE workflow_rules SET state='draft',published_version=0 WHERE id IN (SELECT value FROM json_each(?)) AND owner_id='system' AND state='published' AND published_version=1").bind(rules))
 }
 if(conversations.length&&!leaveUnread)statements.push(db.prepare('INSERT OR IGNORE INTO conversation_reads(conversation_id,user_id,revision) SELECT c.id,m.user_id,c.revision FROM conversations c JOIN memberships m ON m.project_id=c.project_id WHERE c.id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(conversations)))
 return statements
}
