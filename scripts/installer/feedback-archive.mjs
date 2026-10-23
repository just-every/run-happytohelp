// An archive keeps source history, never a live release credential or pending send approval.
export function feedbackArchiveRow(table,row){
 if(table==='feedback_connections')return {...row,secret_cipher:null};
 if(table==='feedback_sources')return {...row,subscribed:0,preference_message_id:null};
 if(table==='feedback_updates'&&['draft','approved'].includes(row.state))return {...row,state:'cancelled',approved_by:null,approved_at:null};
 return row;
}
