// Exactly the nullable cells introduced by 243; no prior value is invented or replaced.
export function outboundArchiveUpgradeRow(table,row){
 if(table==='conversations'&&row.request_form_id===undefined)row={...row,request_form_id:null};
 if(table==='operator_ticket_commands'&&row.service_notice_id===undefined)row={...row,service_notice_id:null};
 return row;
}
