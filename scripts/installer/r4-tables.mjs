/** Stores introduced by R4; older archives remain valid without these rows. */
export const r4Tables=['macro_heads','macro_versions','macro_usage','macro_drafts','macro_attachment_copies','notification_triggers','notification_trigger_claims','notification_preferences','notification_inbox','conversation_note_mentions','conversation_note_media','conversation_merges','partner_forwards','partner_replies','partner_reply_files'];
export const r4RestoreSql=`INSERT OR IGNORE INTO macro_heads(macro_id,version) SELECT id,1 FROM macros;
INSERT OR IGNORE INTO macro_versions(macro_id,project_id,version,title,content,created_by,created_at) SELECT id,project_id,1,title,content,created_by,updated_at FROM macros;`;
/** A restore carries history and editable drafts, never live partner authority or queued mail. */
export function r4ExportRow(table,row){
 if(table==='notification_triggers')return {...row,enabled:0};
 if(table==='notification_inbox')return {...row,email_address:null,state:['pending','awaiting_provider','preparing','sending'].includes(row.state)?'cancelled':row.state};
 if(table==='partner_forwards')return {...row,revoked_at:row.revoked_at??row.created_at,state:['prepared','sending'].includes(row.state)?'cancelled':row.state};
 return row;
}
