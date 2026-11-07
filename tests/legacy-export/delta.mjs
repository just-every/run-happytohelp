import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {findDatabase,snapshot,bucketSnapshot} from '../helpers/upgrade-snapshot.mjs';

const uuid=(group,number)=>`${group}000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const work=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events'];

/** After project 1's full import: legacy keeps taking chats, the seed team changes a conversation,
 * legacy retires the project; the operator sweeps everything since the full export's watermark
 * through the public commands, reruns the sweep, and checks it. */
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

  // The seed's team assigns the resolved conversation after the import.
  const seedEdit=new DatabaseSync(database);try{seedEdit.prepare('UPDATE conversations SET assigned_to=? WHERE id=?').run(owner,resolved);}finally{seedEdit.close();}

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
  await admin.query("UPDATE contacts SET name='Taylor Accounts Payable',updated_at=UTC_TIMESTAMP() WHERE id=?",[participant]);
  await admin.query("INSERT INTO contacts(id,project_id,name,email,identifier,created_at,updated_at) VALUES(?,?,'Riley Newcustomer','riley@delta.example.test','delta-new-customer',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[newContact,projectId]);
  await admin.query('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[newConversation,projectId,newContact]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[newMessage,projectId,newConversation,newContact,'delta-local-new','A new customer asks about refunds']);
  const bytes=Buffer.from('delta attachment bytes\n'),directory=`${projectId}/${newConversation}`;
  await mkdir(join(objectDirectory,directory),{recursive:true});await writeFile(join(objectDirectory,directory,'refund.txt'),bytes);
  await admin.query("INSERT INTO media(id,disk,directory,filename,extension,filename_original,mime_type,aggregate_type,size,url,created_at,updated_at) VALUES(?,'s3',?,'refund','txt','refund.txt','text/plain','document',?,'https://storage.example.test/refund.txt',UTC_TIMESTAMP(),UTC_TIMESTAMP())",[newMedia,directory,bytes.length]);
  await admin.query("INSERT INTO mediables(media_id,mediable_type,mediable_id,tag,`order`) VALUES(?,'App\\\\Models\\\\Message',?,'attachment',0)",[newMedia,newMessage]);
  await admin.query("UPDATE projects SET website='https://retired.example.test',deleted_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=?",[projectId]);

  // Export only what changed since the watermark; its attachments step copies only the new file.
  const deltaSnapshot=join(output,'delta-1.snapshot'),deltaImport=join(output,'delta-1.import');
  await assert.rejects(run('scripts/export-legacy.mjs',[...snapshotArgs,'--since',watermark,'--output',join(output,'delta-json')],env),/--chunk-bytes/);
  const exported=JSON.parse(await run('scripts/export-legacy.mjs',[...snapshotArgs,'--chunk-bytes','4096','--since',watermark,'--output',deltaSnapshot],env));
  assert.equal(exported.since,watermark);assert.ok(exported.watermark>watermark,'the delta records the next watermark');
  await run('scripts/export-legacy.mjs',['attachments','--input',deltaSnapshot,'--objects-dir',objectDirectory,'--output',deltaImport]);
  const manifest=JSON.parse(await readFile(join(deltaImport,'manifest.json'),'utf8')),rows=manifest.source.rowCounts;
  assert.equal(rows.messages,4,'only new messages are in the row chunks');assert.equal(rows.conversations,3,'changed conversations and the parents of new messages');
  assert.equal(rows.contacts,2);assert.equal(rows.projects,1);assert.equal(rows.media,1);assert.equal(rows.mediables,1);
  for(const table of ['articles','categories','macros','events','buckets','datasets','insights','charges'])assert.equal(rows[table],0,`${table} rows untouched since the watermark are left out`);
  assert.deepEqual(manifest.objects.map(o=>o.mediaId),[newMedia],'only the new file is copied');
  assert.equal(manifest.source.scopedCounts.messages,9,'the whole scope is still read and counted');

  const before=business(),beforeWork=workCounts(),beforeObjects=await bucketSnapshot(join(persist,'v3/r2'));
  const check=args=>status('scripts/legacy-import/check.mjs',['delta','--package',deltaImport,'--persist-to',persist,...args]);
  const pre=await check(['--previous-total','0']);
  assert.equal(pre.code,1,'nothing of the delta is journaled before its import');
  const previousTotal=JSON.parse(pre.stdout).projectSourceRows;assert.ok(previousTotal>0);

  const applied=JSON.parse(await run('scripts/import-legacy.mjs',['--package',deltaImport,'--apply','--persist-to',persist]));
  assert.equal(applied.sourceRows,Object.values(rows).reduce((n,c)=>n+c,0));
  assert.ok(applied.appended>=5,'new contact, conversation, messages and file are appended');
  assert.ok(applied.updated>=2,'the changed contact and the refreshed conversation are updated');
  assert.equal(applied.kept,1,'the legacy project row is kept as the seed has it');
  assert.deepEqual(applied.conflicts.map(c=>[c.sourceTable,c.sourceId]).sort(),[['conversations',resolved],['messages',held]].sort());
  for(const c of applied.conflicts)assert.deepEqual(Object.keys(c).sort(),['reason','sourceId','sourceTable','targetKey','targetTable']);
  assert.equal(/A legacy message in|Accounts Payable|asks about refunds|delta-local/.test(JSON.stringify(applied.conflicts)),false,'conflicts carry ids and reasons, no content');

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
  const objects=await bucketSnapshot(join(persist,'v3/r2'));assert.equal(objects.objects.length,beforeObjects.objects.length+1);

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
  assert.equal(result.attachments.identical,1);assert.equal(result.conflicts,2);
  assert.equal((await check(['--previous-total',String(previousTotal+1)])).code,1,'a wrong previous total fails the check');
  return {rows,applied:{appended:applied.appended,updated:applied.updated,conflicts:applied.conflicts.length},previousTotal,projectSourceRows:result.projectSourceRows};
}
