export function supportChannelArchiveRow(table,row){
 if(table==='support_channel_connections')return {...row,token_cipher:null,signing_cipher:null,verify_hash:'',revoked_at:row.revoked_at??row.created_at};
 if(table==='support_channel_threads')return {...row,opted_out:1,template_consent:0};
 if(table==='support_channel_actions'&&row.state==='sending')return {...row,state:'uncertain'};
 if(table==='support_channel_sends'&&row.state==='sending')return {...row,state:'uncertain',error_code:'restored_pending_send'};
 return row;
}
export async function supportChannelArchiveSafety({db,tables}){
 const q=n=>'"'+tables[n].replaceAll('"','""')+'"',checks=[];
 if(tables.support_channel_connections)checks.push(`SELECT 1 FROM ${q('support_channel_connections')} WHERE token_cipher IS NOT NULL OR signing_cipher IS NOT NULL OR verify_hash<>'' OR revoked_at IS NULL LIMIT 1`);
 // Older channel archives retain their data, but never reconstitute consent.
 if(tables.support_channel_threads)await db.prepare(`UPDATE ${q('support_channel_threads')} SET opted_out=1,template_consent=0`).run();
 if(tables.support_channel_threads&&tables.support_channel_connections&&tables.conversations&&tables.contacts)checks.push(`SELECT 1 FROM ${q('support_channel_threads')} t LEFT JOIN ${q('support_channel_connections')} x ON x.id=t.connection_id AND x.project_id=t.project_id LEFT JOIN ${q('conversations')} c ON c.id=t.conversation_id AND c.project_id=t.project_id AND c.contact_id=t.contact_id LEFT JOIN ${q('contacts')} p ON p.id=t.contact_id AND p.project_id=t.project_id WHERE x.id IS NULL OR c.id IS NULL OR p.id IS NULL LIMIT 1`);
 if(checks.length&&(await db.batch(checks.map(s=>db.prepare(s)))).some(r=>r.results.length))throw Error('Support channel archive contains live authority or a cross-workspace relationship');
}
