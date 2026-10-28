export function businessArchiveRow(table,row){
 if(table==='business_connections')return {...row,token_cipher:null,version:row.version+1};
 if(table==='business_links')return {...row,context_json:null,fetched_at:null,error:'Reconnect and refresh provider after restore'};
 if(table==='business_actions'&&['prepared','approved','sending'].includes(row.state))return {...row,state:row.state==='sending'?'uncertain':'cancelled'};
 return row;
}
export async function businessArchiveSafety({db,tables}){
 const q=name=>'"'+tables[name].replaceAll('"','""')+'"',checks=[];
 for(const table of ['business_links','business_actions'])if(tables[table]&&tables.business_connections&&tables.conversations)checks.push(`SELECT 1 FROM ${q(table)} b LEFT JOIN ${q('business_connections')} bc ON bc.id=b.connection_id AND bc.project_id=b.project_id LEFT JOIN ${q('conversations')} cv ON cv.id=b.conversation_id AND cv.project_id=b.project_id WHERE bc.id IS NULL OR cv.id IS NULL LIMIT 1`);
 if(checks.length&&(await db.batch(checks.map(sql=>db.prepare(sql)))).some(r=>r.results.length))throw Error('Business archive contains a cross-workspace relationship');
}
