import {customerArchiveStagedSafety} from './customer-archive-policy.mjs';
export function escalationArchiveRow(table,row){
 if(['escalation_connections','escalation_teams_connections'].includes(table))return {...row,token_cipher:null,webhook_cipher:null};
 if(table==='escalation_operations'&&row.state==='sending')return {...row,state:'uncertain'};
 return row;
}
export async function escalationArchiveSafety(context){
 const {db,tables}=context,q=name=>'"'+tables[name].replaceAll('"','""')+'"',checks=[];
 if(tables.escalation_issues&&tables.escalation_connections)checks.push(`SELECT 1 FROM ${q('escalation_issues')} i LEFT JOIN ${q('escalation_connections')} c ON c.id=i.connection_id AND c.project_id=i.project_id AND c.provider=i.provider WHERE c.id IS NULL LIMIT 1`);
 for(const child of ['escalation_links','escalation_drafts'])if(tables[child]&&tables.escalation_issues&&tables.conversations)checks.push(`SELECT 1 FROM ${q(child)} l LEFT JOIN ${q('escalation_issues')} i ON i.id=l.issue_id AND i.project_id=l.project_id LEFT JOIN ${q('conversations')} c ON c.id=l.conversation_id AND c.project_id=l.project_id WHERE i.id IS NULL OR c.id IS NULL LIMIT 1`);
 for(const child of ['escalation_operations','escalation_handoffs'])if(tables[child]&&tables.conversations)checks.push(`SELECT 1 FROM ${q(child)} l LEFT JOIN ${q('conversations')} c ON c.id=l.conversation_id AND c.project_id=l.project_id WHERE c.id IS NULL LIMIT 1`);
 if(checks.length){const results=await db.batch(checks.map(sql=>db.prepare(sql)));if(results.some(r=>r.results.length))throw Error('Escalation archive contains a cross-workspace relationship');}
 return customerArchiveStagedSafety(context);
}
