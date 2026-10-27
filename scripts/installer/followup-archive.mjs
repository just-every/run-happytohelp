// Free-text stop conditions can contain personal data. Portable copies keep
// custody and accepted terms, but never retain a second copy of this text.
export function followupArchiveRow(table,row) {
 return table==='followup_obligations'?{...row,stop_condition:'',pending_terms_json:null}:table==='followup_changes'?{...row,stop_condition:null}:row;
}
// Obligations retain their cited source and human acceptance history. They do
// not carry a send grant; a restored internal reminder still requires membership.
export async function followupArchiveSafety({db,tables}) {
 const q=name=>'"'+tables[name].replaceAll('"','""')+'"';
 if(!tables.followup_obligations)return true;
 const checks=[`SELECT 1 FROM ${q('followup_obligations')} o
 LEFT JOIN ${q('conversations')} c ON c.id=o.conversation_id AND c.project_id=o.project_id
 LEFT JOIN ${q('messages')} m ON m.id=o.message_id AND m.conversation_id=o.conversation_id AND m.project_id=o.project_id
 LEFT JOIN ${q('escalation_issues')} i ON i.id=o.dependency_id AND i.project_id=o.project_id
 WHERE c.id IS NULL OR m.id IS NULL OR o.quote_start<0 OR o.quote_end<=o.quote_start OR o.quote_end>length(m.content)
 OR (o.dependency_id IS NOT NULL AND (i.id IS NULL OR NOT EXISTS(SELECT 1 FROM ${q('escalation_links')} l WHERE l.project_id=o.project_id AND l.conversation_id=o.conversation_id AND l.issue_id=o.dependency_id))) LIMIT 1`];
 if(tables.followup_changes)checks.push(`SELECT 1 FROM ${q('followup_changes')} h LEFT JOIN ${q('followup_obligations')} o ON o.id=h.obligation_id WHERE o.id IS NULL OR h.version>o.version LIMIT 1`);
 const results=await db.batch(checks.map(sql=>db.prepare(sql)));
 if(results.some(result=>result.results.length))throw Error('Follow-up archive contains an invalid cited relationship');
 return true;
}
