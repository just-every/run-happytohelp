// Phone ciphertext is configuration-bound; archives retain customer/history links,
// never provider execution credentials or replayable pending voice commands.
export function voiceArchiveRow(table,row){
 if(table==='voice_numbers')return {...row,token_cipher:null,webhook_hash:null,enabled:0};
 if(table==='voice_identities')return {...row,phone_cipher:null};
 if(table==='voice_calls')return {...row,remote_cipher:null,recording_cipher:null};
 if(table==='voice_commands'&&row.state==='sending')return {...row,state:'uncertain'};
 return row;
}
export async function voiceArchiveSafety({db,tables}){
 const q=n=>'"'+tables[n].replaceAll('"','""')+'"',checks=[];
 if(tables.voice_calls&&tables.voice_numbers&&tables.conversations)checks.push(`SELECT 1 FROM ${q('voice_calls')} v LEFT JOIN ${q('voice_numbers')} n ON n.id=v.number_id AND n.project_id=v.project_id LEFT JOIN ${q('conversations')} c ON c.id=v.conversation_id AND c.project_id=v.project_id AND c.contact_id=v.contact_id WHERE n.id IS NULL OR c.id IS NULL LIMIT 1`);
 if(tables.voice_identities&&tables.contacts)checks.push(`SELECT 1 FROM ${q('voice_identities')} v LEFT JOIN ${q('contacts')} c ON c.id=v.contact_id AND c.project_id=v.project_id WHERE c.id IS NULL LIMIT 1`);
 if(checks.length&&(await db.batch(checks.map(sql=>db.prepare(sql)))).some(r=>r.results.length))throw Error('Voice archive contains a cross-workspace relationship');
 for(const table of ['voice_numbers','voice_identities','voice_calls','voice_commands'])if(tables[table]){
  const set=table==='voice_numbers'?'token_cipher=NULL,webhook_hash=NULL,enabled=0':table==='voice_identities'?'phone_cipher=NULL':table==='voice_calls'?'remote_cipher=NULL,recording_cipher=NULL':"state=CASE WHEN state='sending' THEN 'uncertain' ELSE state END";
  await db.prepare(`UPDATE ${q(table)} SET ${set}`).run();
 }
}
