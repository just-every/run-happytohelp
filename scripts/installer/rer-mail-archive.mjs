import {createHash} from 'node:crypto';
// Mail history moves; transport authority and live recipient proofs do not.
export const redactMailGrants=value=>typeof value==='string'?value.replace(/\+r\.([a-f0-9]{32})(?=@)/g,(_match,token)=>'+redacted.'+createHash('sha256').update(token).digest('hex').slice(0,24)).replace(/"token_hash"\s*:\s*"[a-f0-9]{64}"/g,'"token_hash":"redacted"').replace(/(\/api\/integrations\/email\/files\/[^/\s"<>]+\/)[a-f0-9]{32}/g,'$1redacted'):value;
export function rerMailArchiveRow(table,row){
 if(table==='email_reply_grants')return {...row,token_hash:row.token_hash.startsWith('archived:')?row.token_hash:'archived:'+createHash('sha256').update(row.token_hash).digest('hex')};
 if(table==='rer_mailboxes')return {...row,state:'revoked',configured:0,route_active:0,error:'Archived routing history; new authority is required'};
 if(table==='rer_mail_ingress'){
  const metadata=JSON.parse(row.metadata_json);
  return {...row,metadata_json:JSON.stringify({...metadata,envelopeTo:redactMailGrants(metadata.envelopeTo)}),state:row.state==='erased'?'erased':'complete',result_json:row.result_json||JSON.stringify({state:'archived'}),error:null};
 }
 if(table==='email_deliveries'&&row.state==='sending')return {...row,state:'uncertain',error:'Archived send outcome is unknown; never replay'};
 // Routing keys and suspension/recovery receipts may contain recipient grants.
 if(['email_threading_keys','inbound_emails','suspended_emails','email_message_options','inbound_recoveries'].includes(table))return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,redactMailGrants(value)]));
 return row;
}
export async function rerMailArchiveSafety({db,tables}){
 const checks=[];
 if(tables.email_reply_grants)checks.push(db.prepare(`UPDATE "${tables.email_reply_grants}" SET token_hash='archived:'||token_hash WHERE token_hash NOT LIKE 'archived:%'`));
 if(tables.rer_mailboxes)checks.push(db.prepare(`UPDATE "${tables.rer_mailboxes}" SET state='revoked',configured=0,route_active=0,error='Archived routing history; new authority is required'`));
 if(tables.rer_mail_ingress)checks.push(db.prepare(`UPDATE "${tables.rer_mail_ingress}" SET state=CASE WHEN state='erased' THEN state ELSE 'complete' END,result_json=coalesce(result_json,'{"state":"archived"}'),error=NULL`));
 if(checks.length)await db.batch(checks);
 return true;
}
