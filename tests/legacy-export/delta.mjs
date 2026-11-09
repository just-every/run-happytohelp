import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {localTarget} from '../../scripts/legacy-import/target.mjs';
import {importPackage} from '../../scripts/legacy-import/import-package.mjs';
import {findDatabase,snapshot,bucketSnapshot} from '../helpers/upgrade-snapshot.mjs';
import {assertRetireSweep} from './retire.mjs';
import {assertResumedSweep,assertCheckRetry} from './resume.mjs';

const uuid=(group,number)=>`${group}000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const work=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events'];

/** After project 1's full import: legacy keeps taking chats, the seed team changes a conversation,
 * legacy retires the project; the operator sweeps everything since the full export's watermark
 * through the public commands, reruns the sweep, and checks it; then the sweep after legacy's retire. */
export async function assertDeltaSweep({admin,run,status,env,output,persist,objectDirectory,projectId,snapshotArgs,fullSnapshot,fullImport}){
  const watermark=JSON.parse(await readFile(join(fullSnapshot,'manifest.json'),'utf8')).source.watermark;
  assert.match(watermark,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,'every export records the legacy clock as its watermark');
  assert.equal(JSON.parse(await readFile(join(fullImport,'manifest.json'),'utf8')).source.watermark,watermark,'the attachments step keeps it');
  const database=await findDatabase(join(persist,'v3/d1'));
  const sql=(query,...args)=>{const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
  const business=()=>Object.fromEntries(Object.entries(snapshot(database)).filter(([table])=>!table.startsWith('legacy_import_')&&!table.startsWith('sqlite_')));
  const workCounts=()=>Object.fromEntries(work.map(table=>[table,sql(`SELECT COUNT(*) n FROM ${table}`)[0].n]));
  const conversation=uuid('40',1),resolved=uuid('41',1),owner=uuid('20',1),participant=uuid('31',1);
  const project=sql('SELECT * FROM projects WHERE id=?',projectId)[0],settings=sql('SELECT * FROM project_settings WHERE project_id=?',projectId)[0];

  // The seed's team assigns the resolved conversation after the import. Its own widget identifies two customers itself:
  // one with the identifier legacy later gives an imported customer, one with the identifier of a customer new in legacy.
  const customer=uuid('30',1),seedHolder=uuid('34',1),seedNewHolder=uuid('34',2),identities=['seed-widget-identity','delta-new-customer'];
  const seedEdit=new DatabaseSync(database);try{
    seedEdit.prepare('UPDATE conversations SET assigned_to=? WHERE id=?').run(owner,resolved);
    const add=seedEdit.prepare('INSERT INTO contacts(id,project_id,name,external_id,created_at) VALUES(?,?,?,?,1)');
    add.run(seedHolder,projectId,'Seed widget visitor',identities[0]);add.run(seedNewHolder,projectId,'Seed widget customer',identities[1]);
  }finally{seedEdit.close();}
  const customerBefore=sql('SELECT * FROM contacts WHERE id=?',customer);
  // A customer legacy holds from before the full export (deleted there too, so the retire leaves her) was erased in the
  // seed: the seed keeps her erased contact and its erasure record, which a delta reads.
  const erased=uuid('36',1),erasedConversation=uuid('45',1),erasedDelegation=uuid('b9',1),erasedNote=uuid('54',1);
  const erasedSeed=new DatabaseSync(database);try{
    erasedSeed.prepare('INSERT INTO contacts(id,project_id,metadata_json,created_at) VALUES(?,?,?,1)').run(erased,projectId,JSON.stringify({is_deleted:1,is_blocked:1,is_erased:1}));
    erasedSeed.prepare('INSERT INTO contact_erasures(project_id,contact_id,erased_by,erased_at,last_erased_at) VALUES(?,?,?,1,1)').run(projectId,erased,owner);
  }finally{erasedSeed.close();}

  // Legacy keeps taking chats and mail, then the project is retired.
  await admin.query("SET time_zone='+00:00'");
  const late=uuid('61',1),reply=uuid('61',2),held=uuid('61',3),newContact=uuid('32',1),newConversation=uuid('43',1),newMessage=uuid('61',4),newMedia=uuid('81',1);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[reply,projectId,conversation,uuid('30',1),'delta-local-reply','A legacy reply after the export']);
  // Committed after the full snapshot began, but stamped before the imported messages, with a
  // delivery id the widget repeated: it follows them rather than renumbering the seed's transcript.
  const [[first]]=await admin.query('SELECT local_id FROM messages WHERE id=?',[uuid('60',10)]);
  await admin.query("INSERT INTO messages(id,project_id,conversation_id,agent_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,'2026-01-01 00:00:00.000',UTC_TIMESTAMP(3))",[late,projectId,conversation,owner,first.local_id,'A late-committed legacy answer']);
  await admin.query('UPDATE conversations SET last_message_id=?,updated_at=UTC_TIMESTAMP() WHERE id=?',[reply,conversation]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[held,projectId,resolved,participant,'delta-local-held','A legacy message in a conversation the seed changed']);
  await admin.query("UPDATE contacts SET name='Taylor Accounts Payable',identifier='delta-accounts-renewed',updated_at=UTC_TIMESTAMP() WHERE id=?",[participant]);
  // Legacy gives an imported customer the identifier the seed's own contact holds (restored before the next sweep).
  const [[original]]=await admin.query("SELECT identifier,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') updated_at FROM contacts WHERE id=?",[customer]);
  await admin.query('UPDATE contacts SET identifier=?,updated_at=UTC_TIMESTAMP() WHERE id=?',[identities[0],customer]);
  await admin.query("INSERT INTO contacts(id,project_id,name,email,identifier,created_at,updated_at) VALUES(?,?,'Riley Newcustomer','riley@delta.example.test','delta-new-customer',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[newContact,projectId]);
  await admin.query('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[newConversation,projectId,newContact]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[newMessage,projectId,newConversation,newContact,'delta-local-new','A new customer asks about refunds']);
  const bytes=Buffer.from('delta attachment bytes\n'),directory=`${projectId}/${newConversation}`;
  await mkdir(join(objectDirectory,directory),{recursive:true});await writeFile(join(objectDirectory,directory,'refund.txt'),bytes);
  await admin.query("INSERT INTO media(id,disk,directory,filename,extension,filename_original,mime_type,aggregate_type,size,url,created_at,updated_at) VALUES(?,'s3',?,'refund','txt','refund.txt','text/plain','document',?,'https://storage.example.test/refund.txt',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[newMedia,directory,bytes.length]);
  await admin.query("INSERT INTO mediables(media_id,mediable_type,mediable_id,tag,`order`) VALUES(?,'App\\\\Models\\\\Message',?,'attachment',0)",[newMedia,newMessage]);
  // The seed's Amazon SES reader took two emails that legacy stored too, with the SES message id as delivery id: a reply in
  // the conversation above, and a new conversation of an existing customer whose only message carries a file.
  const sesReply=uuid('61',5),sesConversation=uuid('43',2),sesMessage=uuid('61',6),sesMedia=uuid('81',2),sesIds=['ses-message-id-0001','ses-message-id-0002'];
  const receipts=new DatabaseSync(database);try{
    const add=receipts.prepare("INSERT INTO legacy_mail_s3_receipts(object_key,ses_message_id,source,size,state,created_at,updated_at) VALUES(?,?,?,100,?,1,1)");
    add.run(`ses/inbound/${sesIds[0]}`,sesIds[0],'ses','complete');add.run(`replay/inbound/${sesIds[1]}`,sesIds[1],'replay','duplicate');
  }finally{receipts.close();}
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[sesReply,projectId,conversation,uuid('30',1),sesIds[0],'An emailed follow-up the seed already took']);
  await admin.query('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[sesConversation,projectId,uuid('30',1)]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[sesMessage,projectId,sesConversation,uuid('30',1),sesIds[1],'A new email the seed already took']);
  const sesBytes=Buffer.from('emailed attachment bytes\n'),sesDirectory=`${projectId}/${sesConversation}`;
  await mkdir(join(objectDirectory,sesDirectory),{recursive:true});await writeFile(join(objectDirectory,sesDirectory,'receipt.txt'),sesBytes);
  await admin.query("INSERT INTO media(id,disk,directory,filename,extension,filename_original,mime_type,aggregate_type,size,url,created_at,updated_at) VALUES(?,'s3',?,'receipt','txt','receipt.txt','text/plain','document',?,'https://storage.example.test/receipt.txt',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[sesMedia,sesDirectory,sesBytes.length]);
  await admin.query("INSERT INTO mediables(media_id,mediable_type,mediable_id,tag,`order`) VALUES(?,'App\\\\Models\\\\Message',?,'attachment',0)",[sesMedia,sesMessage]);
  // Her delegated run (before the watermark: its conversation, delegation and internal note are not carried) gains an
  // uploaded image with its preview, linked to the delegation and to the note; the customer's delegation gains a file too.
  const old='2026-01-15 09:30:00',erasedFile=uuid('82',1),erasedPreview=uuid('82',2),otherFile=uuid('82',3),bucket=uuid('53',1),device=uuid('b2',1);
  await admin.query('INSERT INTO contacts(id,project_id,name,email,identifier,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)',[erased,projectId,'Erin Erased','erin@delta.example.test','delta-erased-customer',old,old,old]);
  await admin.query('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)',[erasedConversation,projectId,erased,old,old]);
  await admin.query('INSERT INTO buckets(id,project_id,conversation_id,is_vectorized,created_at,updated_at) VALUES(?,?,?,0,?,?)',[bucket,projectId,erasedConversation,old,old]);
  await admin.query("INSERT INTO support_delegations(id,project_id,conversation_id,local_agent_device_id,created_by_user_id,request_id,mode,instructions,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'investigate','Check Erin passport upload','completed',?,?)",[erasedDelegation,projectId,erasedConversation,device,owner,uuid('b5',9),old,old]);
  await admin.query("INSERT INTO events(id,conversation_id,bucket_id,agent_id,type,payload,created_at) VALUES(?,?,?,?,'INTERNAL_NOTE',?,?)",[erasedNote,erasedConversation,bucket,owner,JSON.stringify('Delegation result for Erin'),old]);
  const delegationFiles=[[erasedFile,`${projectId}/${erasedConversation}`,'shot','png','erin-passport.png','image/png','image',null,null],[erasedPreview,`${projectId}/${erasedConversation}`,'shot-preview','png','erin-passport.png','image/png','image','preview',erasedFile],
    [otherFile,`${projectId}/${conversation}`,'delegation-notes','txt','morgan-delegation-notes.txt','text/plain','document',null,null]];
  for(const [id,folder,name,extension,original,mime,aggregate,variant,source] of delegationFiles){
    const fileBytes=Buffer.from(`delegation file ${name}\n`);await mkdir(join(objectDirectory,folder),{recursive:true});await writeFile(join(objectDirectory,folder,`${name}.${extension}`),fileBytes);
    await admin.query('INSERT INTO media(id,disk,directory,filename,extension,filename_original,mime_type,aggregate_type,size,variant_name,original_media_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[id,'s3',folder,name,extension,original,mime,aggregate,fileBytes.length,variant,source]);
  }
  for(const [file,type,parent] of [[erasedFile,'SupportDelegation',erasedDelegation],[erasedFile,'Event',erasedNote],[otherFile,'SupportDelegation',uuid('b3',1)]])
    await admin.query("INSERT INTO mediables(media_id,mediable_type,mediable_id,tag,`order`) VALUES(?,?,?,'attachment',0)",[file,`App\\Models\\${type}`,parent]);
  await admin.query("UPDATE projects SET website='https://retired.example.test',deleted_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=?",[projectId]);

  // Export only what changed since the watermark; its attachments step copies only the new file.
  const deltaSnapshot=join(output,'delta-1.snapshot'),deltaImport=join(output,'delta-1.import');
  await assert.rejects(run('scripts/export-legacy.mjs',[...snapshotArgs,'--since',watermark,'--output',join(output,'delta-json')],env),/--chunk-bytes/);
  const exported=JSON.parse(await run('scripts/export-legacy.mjs',[...snapshotArgs,'--chunk-bytes','4096','--since',watermark,'--output',deltaSnapshot],env));
  assert.equal(exported.since,watermark);assert.ok(exported.watermark>watermark,'the delta records the next watermark');
  await run('scripts/export-legacy.mjs',['attachments','--input',deltaSnapshot,'--objects-dir',objectDirectory,'--output',deltaImport]);
  const manifest=JSON.parse(await readFile(join(deltaImport,'manifest.json'),'utf8')),rows=manifest.source.rowCounts;
  assert.equal(rows.messages,6,'only new messages are in the row chunks');assert.equal(rows.conversations,4,'changed conversations and the parents of new messages');
  assert.equal(rows.contacts,3);assert.equal(rows.projects,1);assert.equal(rows.media,5);assert.equal(rows.mediables,5);
  for(const table of ['articles','categories','macros','events','buckets','datasets','insights','charges'])assert.equal(rows[table],0,`${table} rows untouched since the watermark are left out`);
  assert.deepEqual(manifest.objects.map(o=>o.mediaId).sort(),[newMedia,sesMedia,erasedFile,erasedPreview,otherFile].sort(),'only the new files are copied');
  assert.equal(manifest.source.scopedCounts.messages,11,'the whole scope is still read and counted');

  const before=business(),beforeWork=workCounts(),beforeObjects=await bucketSnapshot(join(persist,'v3/r2')),resumeFrom=join(output,'delta-1-before');
  await cp(persist,resumeFrom,{recursive:true});
  const leaseFrom=join(output,'delta-1-lease');await cp(persist,leaseFrom,{recursive:true});
  const check=args=>status('scripts/legacy-import/check.mjs',['delta','--package',deltaImport,'--persist-to',persist,...args]);
  const pre=await check(['--previous-total','0']);
  assert.equal(pre.code,1,'nothing of the delta is journaled before its import');
  const previousTotal=JSON.parse(pre.stdout).projectSourceRows;assert.ok(previousTotal>0);

  const applied=JSON.parse(await run('scripts/import-legacy.mjs',['--package',deltaImport,'--apply','--persist-to',persist]));
  assert.equal(applied.sourceRows,Object.values(rows).reduce((n,c)=>n+c,0));
  assert.ok(applied.appended>=5,'new contact, conversation, messages and file are appended');
  assert.ok(applied.updated>=2,'the changed contact and the refreshed conversation are updated');
  assert.equal(applied.kept,1,'the legacy project row is kept as the seed has it');
  assert.deepEqual(applied.conflicts.map(c=>[c.sourceTable,c.sourceId]).sort(),[['contacts',customer],['contacts',newContact],['conversations',resolved],['messages',held]].sort());
  // An identity another seed contact holds is never applied: the imported customer stays as it is; the new customer
  // arrives without it, with its conversation, message and file; the holders keep theirs; a fresh identity applies.
  const clashOf=id=>applied.conflicts.find(c=>c.sourceId===id).reason;
  assert.match(clashOf(customer),new RegExp(`^unique contacts\\(project_id,external_id\\): held by contacts ${seedHolder}$`));
  assert.match(clashOf(newContact),new RegExp(`^unique contacts\\(project_id,external_id\\): held by contacts ${seedNewHolder}; appended without its identity$`));
  assert.deepEqual(sql('SELECT * FROM contacts WHERE id=?',customer),customerBefore);
  assert.deepEqual(sql('SELECT id,external_id FROM contacts WHERE id IN (?,?,?,?) ORDER BY id',seedHolder,seedNewHolder,newContact,participant),
    [{id:participant,external_id:'delta-accounts-renewed'},{id:newContact,external_id:null},{id:seedHolder,external_id:identities[0]},{id:seedNewHolder,external_id:identities[1]}]);
  assert.deepEqual(sql("SELECT j.status FROM legacy_import_rows j JOIN legacy_import_runs u ON u.id=j.run_id WHERE json_extract(u.source_json,'$.delta')=1 AND j.source_table='contacts' AND j.source_id IN (?,?) ORDER BY j.source_id",customer,newContact).map(r=>r.status),['conflict','mapped']);
  assert.deepEqual(sql("SELECT source_id FROM legacy_import_conflicts WHERE source_table='contacts' ORDER BY 1").map(r=>r.source_id),[customer,newContact]);
  const identityFree=text=>assert.equal(identities.some(value=>text.includes(value)),false,'no identifier value is printed or recorded');
  identityFree(JSON.stringify(applied));identityFree(JSON.stringify(sql('SELECT reason FROM legacy_import_conflicts')));
  for(const c of applied.conflicts)assert.deepEqual(Object.keys(c).sort(),['reason','sourceId','sourceTable','targetKey','targetTable']);
  // Mail the seed's reader took is skipped with its file and its new conversation: counted, journaled, never written or listed.
  assert.equal(applied.skipped,5);
  assert.deepEqual(Object.fromEntries(Object.entries(applied.tables).filter(([,t])=>t.skipped).map(([table,t])=>[table,t.skipped])),{conversations:1,messages:2,media:1,mediables:1});
  assert.deepEqual(sql('SELECT id FROM messages WHERE id IN (?,?)',sesReply,sesMessage),[]);assert.deepEqual(sql('SELECT id FROM conversations WHERE id=?',sesConversation),[]);
  assert.deepEqual(sql('SELECT id FROM media WHERE id=?',sesMedia),[]);assert.equal(sql('SELECT COUNT(*) n FROM messages WHERE local_id IN (?,?)',...sesIds)[0].n,0);
  // Skipped rows keep their digest and no source copy; the one file link is known by its table and status alone.
  const skippedRows=sql("SELECT source_table,source_id,source_json FROM legacy_import_rows WHERE status='skipped' AND target_table IS NULL AND target_key IS NULL ORDER BY 1,2");
  assert.deepEqual(skippedRows.map(r=>r.source_json),skippedRows.map(()=>'{}'),'skipped rows carry no source copy');
  assert.deepEqual(skippedRows.filter(r=>r.source_table!=='mediables').map(r=>[r.source_table,r.source_id]),
    [['conversations',sesConversation],['media',sesMedia],['messages',sesReply],['messages',sesMessage]].sort((x,y)=>x[0].localeCompare(y[0])||x[1].localeCompare(y[1])));
  assert.equal(skippedRows.filter(r=>r.source_table==='mediables').length,1);
  assert.equal(/A legacy message in|Accounts Payable|asks about refunds|delta-local/.test(JSON.stringify(applied.conflicts)),false,'conflicts carry ids and reasons, no content');
  // The erased customer's delegation image, its preview and both its links (to the delegation and to the note) are journaled
  // erased with no copy and their bytes are never uploaded; the other customer's delegation file is archived and uploaded.
  const deltaRows=where=>sql(`SELECT j.source_table,j.source_id,j.source_json,j.status FROM legacy_import_rows j JOIN legacy_import_runs u ON u.id=j.run_id WHERE json_extract(u.source_json,'$.delta')=1 AND ${where} ORDER BY 1,2`);
  const erasedRows=deltaRows("j.status='erased'");
  assert.deepEqual(erasedRows.filter(r=>r.source_table==='media').map(r=>r.source_id),[erasedFile,erasedPreview].sort());
  assert.equal(erasedRows.filter(r=>r.source_table==='mediables').length,2);assert.equal(erasedRows.length,4);
  assert.deepEqual(erasedRows.map(r=>r.source_json),erasedRows.map(()=>'{}'));
  assert.equal(sql("SELECT COUNT(*) n FROM legacy_import_rows WHERE instr(source_json,'erin-passport')>0")[0].n,0,'her file name is journaled nowhere');
  assert.deepEqual(deltaRows(`j.source_table='media' AND j.source_id='${otherFile}'`).map(r=>[r.status,JSON.parse(r.source_json).filename_original]),[['archived_only','morgan-delegation-notes.txt']]);

  // The transcript gains the legacy messages in order after the imported ones, and the conversation follows them.
  const transcript=sql('SELECT id,revision,local_id FROM messages WHERE conversation_id=? ORDER BY revision',conversation);
  assert.deepEqual(transcript.slice(-2).map(m=>m.id),[late,reply]);assert.deepEqual(transcript.map(m=>m.revision),[1,2,3,4,5,6]);
  assert.equal(transcript.find(m=>m.id===late).local_id,`legacy:${late}`,'a repeated delivery id keeps the first message its id');
  assert.deepEqual(sql('SELECT revision,last_message_id FROM conversations WHERE id=?',conversation),[{revision:6,last_message_id:reply}]);
  // The conversation the seed changed keeps its state; legacy's new message is held, not inserted.
  assert.deepEqual(sql('SELECT assigned_to FROM conversations WHERE id=?',resolved),[{assigned_to:owner}]);
  assert.deepEqual(sql('SELECT id FROM messages WHERE id=?',held),[]);
  assert.deepEqual(sql('SELECT name FROM contacts WHERE id=?',participant),[{name:'Taylor Accounts Payable'}]);
  assert.equal(sql('SELECT COUNT(*) n FROM messages WHERE conversation_id=?',newConversation)[0].n,1);
  assert.deepEqual(sql('SELECT message_id FROM media WHERE id=?',newMedia),[{message_id:newMessage}]);
  // Project rows are the seed's: the retired legacy project changes neither its origin, key nor settings.
  assert.deepEqual(sql('SELECT * FROM projects WHERE id=?',projectId),[project]);
  assert.deepEqual(sql('SELECT * FROM project_settings WHERE project_id=?',projectId),[settings]);
  assert.deepEqual(workCounts(),beforeWork,'applying a delta sends, notifies, dispatches and schedules nothing');
  const objects=await bucketSnapshot(join(persist,'v3/r2'));assert.equal(objects.objects.length,beforeObjects.objects.length+2);
  const stored=new Set(objects.objects.map(o=>JSON.parse(o).key)),fileKey=id=>`legacy/projects/${projectId}/media/${id}`;
  assert.deepEqual([erasedFile,erasedPreview,otherFile].map(id=>stored.has(fileKey(id))),[false,false,true],'her files are withheld; the other customer\'s is uploaded');

  // The same delta while an erasure runs, and with its own lease lapsing, each from the state before it.
  await assertDeltaLeases({from:leaseFrom,output,deltaImport,projectId,customer,conversation,reply,late,newMessage,newMedia,otherFile,beforeObjects});

  // Rerunning the same delta changes nothing and lists the same conflicts.
  const after=business(),journal=sql('SELECT COUNT(*) n FROM legacy_import_rows')[0].n;
  const rerun=JSON.parse(await run('scripts/import-legacy.mjs',['--package',deltaImport,'--apply','--persist-to',persist]));
  assert.equal(rerun.replayed,applied.sourceRows);assert.equal(rerun.appended+rerun.updated,0);
  assert.deepEqual(rerun.conflicts.map(c=>c.sourceId).sort(),applied.conflicts.map(c=>c.sourceId).sort());
  assert.deepEqual(business(),after,'a rerun changes no business row');
  assert.equal(sql('SELECT COUNT(*) n FROM legacy_import_rows')[0].n,journal);
  assert.deepEqual(await bucketSnapshot(join(persist,'v3/r2')),objects);
  assert.notDeepEqual(after,before);

  const checked=await check(['--previous-total',String(previousTotal)]);
  assert.equal(checked.code,0,checked.stdout);
  const result=JSON.parse(checked.stdout);
  assert.equal(result.projectSourceRows,previousTotal+result.newRows);assert.ok(result.newRows>=7);
  assert.equal(result.attachments.identical,2);assert.equal(result.attachments.withheld,3);assert.equal(result.attachments.mismatched,0);assert.equal(result.conflicts,4);
  assert.deepEqual(result.conflictRows.map(c=>`${c.sourceTable}:${c.sourceId}:${c.reason}`).sort(),applied.conflicts.map(c=>`${c.sourceTable}:${c.sourceId}:${c.reason}`).sort());
  for(const c of result.conflictRows)assert.deepEqual(Object.keys(c).sort(),['reason','sourceId','sourceTable','targetKey','targetTable']);
  identityFree(checked.stdout);assert.equal(result.retries,0);
  assert.equal(result.skipped,5);assert.deepEqual([result.tables.conversations.skipped,result.tables.messages.skipped,result.tables.media.skipped,result.tables.mediables.skipped],[1,2,1,1]);
  assert.equal((await check(['--previous-total',String(previousTotal+1)])).code,1,'a wrong previous total fails the check');
  // D1 answering "overloaded" is waited out; any other error fails the check at once.
  {const {check:_,at:__,...printed}=result;await assertCheckRetry({persist,deltaImport,previousTotal,expected:printed});}
  // The same sweep, stopped partway from the state before it, resumes with the same command to the same outcome.
  const resumed=await assertResumedSweep({admin,run,status,env,output,objectDirectory,from:resumeFrom,projectId,snapshotArgs,since:watermark});
  // Legacy's customer goes back to how the retire will find it.
  await admin.query('UPDATE contacts SET identifier=?,updated_at=? WHERE id=?',[original.identifier,original.updated_at,customer]);
  // Then legacy is retired and the next sweep, since this delta's watermark, takes the retire's marker.
  const retire=await assertRetireSweep({admin,run,status,env,output,persist,objectDirectory,projectId,snapshotArgs,since:exported.watermark});
  return {rows,applied:{appended:applied.appended,updated:applied.updated,skipped:applied.skipped,conflicts:applied.conflicts.length},checked:{skipped:result.skipped,code:checked.code},resumed,previousTotal,projectSourceRows:result.projectSourceRows,retire};
}

/** A delta never writes while an erasure of its workspace runs. On a copy of the state before the sweep, with the customer's
 * erasure holding her live lease: the delta waits (a progress line, nothing written), and when that erasure is left
 * interrupted (its lease expired, its row kept) the delta completes treating her as erased: every row of hers journaled
 * erased with no copy, none of her words in the seed, her delegation file withheld; the new customer imported as before.
 * On another copy, the delta's own lease lapses after its contacts batch (a temporary trigger, as a stalled process past its
 * expiry): its next batch is refused, it stops non-zero, and the same command completes it. On two more copies the delta
 * runs in process with its R2 binding wrapped at the edge: its lease lapses between its check and an upload, and that
 * upload is removed and recorded nowhere; and the customer's file it uploaded under its live lease stays behind when the
 * lease lapses right after its record, her erasure completes (it cannot see the file) and the rerun removes it. */
async function assertDeltaLeases({from,output,deltaImport,projectId,customer,conversation,reply,late,newMessage,newMedia,otherFile,beforeObjects}){
  const lapse=join(output,'delta-1-lapse');await cp(from,lapse,{recursive:true});
  const upload=join(output,'delta-1-upload'),leftover=join(output,'delta-1-leftover');
  await cp(from,upload,{recursive:true});await cp(from,leftover,{recursive:true});
  const now="CAST(unixepoch('subsec')*1000 AS INTEGER)";
  const apply=state=>{
    const child=spawn(process.execPath,['scripts/import-legacy.mjs','--package',deltaImport,'--apply','--persist-to',state],{env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},stdio:['ignore','pipe','pipe']});
    const result={stdout:'',stderr:'',child};child.stdout.on('data',b=>result.stdout+=b);child.stderr.on('data',b=>result.stderr+=b);
    result.exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});return result;
  };
  try{
    const database=await findDatabase(join(from,'v3/d1'));
    // The running delta holds the same database: these wait for its writes (busy_timeout) rather than fail.
    const open=(file,readOnly=false)=>{const db=new DatabaseSync(file,{readOnly});db.exec('PRAGMA busy_timeout=10000');return db;};
    const sql=(query,...args)=>{const db=open(database,true);try{return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
    const write=query=>{const db=open(database);try{db.exec(query);}finally{db.close();}};
    const runs=()=>sql('SELECT COUNT(*) n FROM legacy_import_runs')[0].n,startRuns=runs();
    write(`INSERT INTO contact_erasure_leases VALUES('${projectId}','${customer}','erasure-request',${now}+600000)`);
    const waiting=apply(from);
    for(const started=Date.now();!/"step":"waiting","for":"erasure","erasures":1/.test(waiting.stderr);){assert.ok(Date.now()-started<60000,waiting.stderr);await new Promise(resolve=>setTimeout(resolve,200));}
    await new Promise(resolve=>setTimeout(resolve,3000));
    assert.equal(runs(),startRuns,'a delta waiting for an erasure writes nothing');assert.deepEqual(sql('SELECT * FROM legacy_delta_leases'),[]);
    write(`UPDATE contact_erasure_leases SET expires_at=${now}-1`);
    assert.equal(await waiting.exit,0,waiting.stderr);
    const done=JSON.parse(waiting.stdout);assert.ok(done.erased>=8,'her rows are journaled erased');
    const deltaRow=(table,id)=>sql("SELECT j.status,j.source_json FROM legacy_import_rows j JOIN legacy_import_runs u ON u.id=j.run_id WHERE json_extract(u.source_json,'$.delta')=1 AND j.source_table=? AND j.source_id=?",table,id);
    for(const [table,id] of [['contacts',customer],['conversations',conversation],['messages',reply],['messages',late],['media',otherFile]])assert.deepEqual(deltaRow(table,id),[{status:'erased',source_json:'{}'}],`${table} ${id}`);
    assert.equal(sql("SELECT COUNT(*) n FROM legacy_import_rows WHERE instr(source_json,'morgan-delegation-notes')>0 OR instr(source_json,'A legacy reply after the export')>0")[0].n,0);
    assert.deepEqual(sql('SELECT id FROM messages WHERE id IN (?,?)',reply,late),[]);
    assert.deepEqual(sql('SELECT conversation_id FROM messages WHERE id=?',newMessage).length,1,'the new customer is imported as before');
    const stored=new Set((await bucketSnapshot(join(from,'v3/r2'))).objects.map(o=>JSON.parse(o).key)),fileKey=id=>`legacy/projects/${projectId}/media/${id}`;
    assert.deepEqual([newMedia,otherFile].map(id=>stored.has(fileKey(id))),[true,false],'her delegation file is withheld');
    assert.equal(stored.size,beforeObjects.objects.length+1);
    assert.deepEqual(sql('SELECT * FROM legacy_delta_leases'),[],'the delta released its lease');
    assert.equal(sql('SELECT COUNT(*) n FROM contact_erasure_leases')[0].n,1,'the interrupted erasure stays pending');

    const lapsed=await findDatabase(join(lapse,'v3/d1')),lapseWrite=query=>{const db=open(lapsed);try{db.exec(query);}finally{db.close();}};
    const journaled=table=>{const db=open(lapsed,true);try{return db.prepare("SELECT COUNT(*) n FROM legacy_import_rows j JOIN legacy_import_runs u ON u.id=j.run_id WHERE json_extract(u.source_json,'$.delta')=1 AND j.source_table=?").get(table).n;}finally{db.close();}};
    lapseWrite("CREATE TRIGGER delta_lease_lapse AFTER INSERT ON legacy_import_rows WHEN NEW.source_table='contacts' BEGIN UPDATE legacy_delta_leases SET expires_at=0; END");
    const stopped=apply(lapse);
    assert.notEqual(await stopped.exit,0);assert.match(stopped.stderr,/delta lease lapsed/);
    assert.ok(journaled('contacts')>0,'the batch before the lapse committed');assert.equal(journaled('messages'),0,'nothing more was written');
    lapseWrite('DROP TRIGGER delta_lease_lapse');
    const again=apply(lapse);assert.equal(await again.exit,0,again.stderr);
    const completed=JSON.parse(again.stdout);assert.ok(completed.replayed>0);assert.ok(journaled('messages')>0);

    // The command's own modules, with the delta's R2 and D1 bindings wrapped in this test only.
    const modules=await importModules(),expire='UPDATE legacy_delta_leases SET expires_at=0';
    const inProcess=async(state,hooks)=>{
      const target=await localTarget(state),real=target.env;
      const wrap=(binding,overrides)=>new Proxy(binding,{get:(object,key)=>overrides[key]??(typeof object[key]==='function'?object[key].bind(object):object[key])});
      const env={DB:wrap(real.DB,{batch:hooks.batch?.(real.DB.batch.bind(real.DB),real)}),FILES:wrap(real.FILES,{put:hooks.put(real.FILES.put.bind(real.FILES),real)})};
      try{return await importPackage(deltaImport,{env},modules);}finally{await target.close();}
    };
    const databases=new Map([[upload,await findDatabase(join(upload,'v3/d1'))],[leftover,await findDatabase(join(leftover,'v3/d1'))]]);
    const recorded=(state,key)=>{const db=open(databases.get(state),true);try{return db.prepare('SELECT run_id FROM legacy_import_objects WHERE object_key=?').all(key).length;}finally{db.close();}};
    const keys=async state=>new Set((await bucketSnapshot(join(state,'v3/r2'))).objects.map(o=>JSON.parse(o).key));

    // Its lease lapses between its check and the upload of the new customer's file (the stall): the upload is removed again.
    let lapses=0;
    await assert.rejects(inProcess(upload,{put:(put,{DB})=>async(key,...rest)=>{if(key===fileKey(newMedia)&&!lapses++)await DB.prepare(expire).run();return put(key,...rest);}}),/delta lease lapsed/);
    assert.equal(lapses,1);assert.equal((await keys(upload)).has(fileKey(newMedia)),false,'the upload after the lapse is removed');
    assert.equal(recorded(upload,fileKey(newMedia)),0,'and recorded nowhere');
    const uploadRerun=apply(upload);assert.equal(await uploadRerun.exit,0,uploadRerun.stderr);
    assert.equal((await keys(upload)).has(fileKey(newMedia)),true);assert.equal(recorded(upload,fileKey(newMedia)),1,'the rerun completes it');

    // Her file is uploaded and recorded under a live lease; the lease lapses right after (the stall) and her erasure completes
    // without seeing it (no media row of hers is journaled yet). The delta stops at its next lease check; its rerun removes it.
    let uploadedHers=false;
    await assert.rejects(inProcess(leftover,{
      put:put=>async(key,...rest)=>{const result=await put(key,...rest);if(key===fileKey(otherFile))uploadedHers=true;return result;},
      batch:(batch,{DB})=>async statements=>{const result=await batch(statements);if(uploadedHers){uploadedHers=false;await DB.prepare(expire).run();}return result;}}),/delta lease lapsed/);
    assert.equal((await keys(leftover)).has(fileKey(otherFile)),true);assert.equal(recorded(leftover,fileKey(otherFile)),1,'her file was uploaded and recorded before the lapse');
    const leftoverDb=databases.get(leftover),leftoverSql=(query,...args)=>{const db=open(leftoverDb);try{return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
    const deltaMedia="SELECT j.status,j.source_json FROM legacy_import_rows j JOIN legacy_import_runs u ON u.id=j.run_id WHERE json_extract(u.source_json,'$.delta')=1 AND j.source_table='media'";
    assert.deepEqual(leftoverSql(deltaMedia),[],'no media row of the delta is journaled yet');
    leftoverSql('INSERT INTO contact_erasures(project_id,contact_id,erased_by,erased_at,last_erased_at) VALUES(?,?,?,1,1) RETURNING contact_id',projectId,customer,uuid('20',1));
    const leftoverRerun=apply(leftover);assert.equal(await leftoverRerun.exit,0,leftoverRerun.stderr);
    const rerunKeys=await keys(leftover);
    assert.equal(rerunKeys.has(fileKey(otherFile)),false,'the rerun removes her file');assert.equal(recorded(leftover,fileKey(otherFile)),0,'and its record');
    assert.deepEqual(leftoverSql(`${deltaMedia} AND j.source_id=?`,otherFile),[{status:'erased',source_json:'{}'}]);
    assert.equal(rerunKeys.has(fileKey(newMedia)),true);assert.equal(recorded(leftover,fileKey(newMedia)),1,'the new customer is imported as before');
    assert.equal(rerunKeys.size,beforeObjects.objects.length+1);
  }finally{for(const state of [from,lapse,upload,leftover])await rm(state,{recursive:true,force:true});}
}

/** The import command's modules, loaded as scripts/import-legacy.mjs loads them (TypeScript sources, extensionless imports). */
async function importModules(){
  registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return next(url.href,context);}return next(specifier,context);}});
  const source=path=>import(new URL(`../../src/modules/legacy-import/${path}.ts`,import.meta.url).href);
  const [importer,delta,plan,lease,erased,mapping,relationships,types]=await Promise.all(['importer','delta','delta-plan','lease','erased','mapping','relationships','types'].map(source));
  return {planImport:importer.planImport,importLegacy:importer.importLegacy,importDelta:delta.importDelta,planDelta:plan.planDelta,takeDeltaLease:lease.takeDeltaLease,readErased:erased.readErased,erasedMediaOf:erased.erasedMediaOf,heldByNativeMedia:erased.heldByNativeMedia,tableOrder:mapping.tableOrder,relationships,types};
}
