// An archive keeps source history, never a live release credential or pending send approval.
export function feedbackArchiveRow(table,row){
 if(table==='feedback_penny_connections')return {...row,token_cipher:null};
 if(table==='feedback_handoffs'&&row.state==='sending')return {...row,state:'uncertain'};
 if(table==='feedback_connections')return {...row,secret_cipher:null};
 if(table==='feedback_sources')return {...row,subscribed:0,preference_message_id:null};
 if(table==='feedback_updates'&&['draft','approved'].includes(row.state))return {...row,state:'cancelled',approved_by:null,approved_at:null};
 return row;
}

/** Validate staged custody before an archive is permitted to mutate the destination. */
export async function feedbackArchiveSafety({db,tables}){
 const q=name=>'"'+tables[name].replaceAll('"','""')+'"',checks=[]
 if(tables.feedback_sources&&tables.conversations&&tables.contacts&&tables.messages){
 checks.push(`SELECT 1 FROM ${q('feedback_sources')} s LEFT JOIN ${q('conversations')} c ON c.id=s.conversation_id AND c.project_id=s.project_id AND c.contact_id=s.contact_id LEFT JOIN ${q('contacts')} ct ON ct.id=s.contact_id AND ct.project_id=s.project_id LEFT JOIN ${q('messages')} m ON m.id=s.message_id AND m.project_id=s.project_id AND m.conversation_id=s.conversation_id WHERE c.id IS NULL OR ct.id IS NULL OR m.id IS NULL OR coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)=1 OR coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)=1 OR m.erased_at IS NOT NULL LIMIT 1`)
 if(tables.companies)checks.push(`SELECT 1 FROM ${q('feedback_sources')} s LEFT JOIN ${q('companies')} co ON co.id=s.account_id AND co.project_id=s.project_id WHERE s.account_id IS NOT NULL AND co.id IS NULL LIMIT 1`)
 }
 if(tables.feedback_updates&&tables.feedback_sources&&tables.feedback_release_events)checks.push(`SELECT 1 FROM ${q('feedback_updates')} u LEFT JOIN ${q('feedback_sources')} s ON s.id=u.source_id AND s.project_id=u.project_id LEFT JOIN ${q('feedback_release_events')} r ON r.id=u.release_id AND r.project_id=u.project_id WHERE s.id IS NULL OR r.id IS NULL LIMIT 1`)
 if(tables.feedback_handoffs&&tables.feedback_sources)checks.push(`SELECT 1 FROM ${q('feedback_handoffs')} h LEFT JOIN ${q('feedback_sources')} s ON s.id=h.source_id AND s.project_id=h.project_id WHERE s.id IS NULL LIMIT 1`)
 if(tables.feedback_penny_requesters&&tables.contacts)checks.push(`SELECT 1 FROM ${q('feedback_penny_requesters')} r LEFT JOIN ${q('contacts')} c ON c.id=r.contact_id AND c.project_id=r.project_id WHERE c.id IS NULL OR coalesce(json_extract(c.metadata_json,'$.is_erased'),0)=1 LIMIT 1`)
 for(const table of ['assurance_profiles','assurance_evidence','feedback_connections','feedback_penny_connections','feedback_release_events'])if(tables[table]&&tables.projects)checks.push(`SELECT 1 FROM ${q(table)} r LEFT JOIN ${q('projects')} p ON p.id=r.project_id WHERE p.id IS NULL LIMIT 1`)
 if(checks.length){const results=await db.batch(checks.map(sql=>db.prepare(sql)));if(results.some(result=>result.results.length))throw Error('Feedback or assurance archive contains an invalid tenant or erased source relationship')}
}
