import assert from 'node:assert/strict';
import {cp} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {findDatabase,snapshot,bucketSnapshot} from '../helpers/upgrade-snapshot.mjs';

const uuid=(group,number)=>`${group}000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const work=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events'];

/** After the first sweep: legacy deletes one customer, resolves a conversation and is retired (the
 * project and every live contact soft-deleted with one marker time); customers keep writing to it.
 * The seed has a survey cycle on the resolved conversation and a Move in fence on a conversation id
 * the sweep appends. The sweep after the retire is imported with --retire-marker. */
export async function assertRetireSweep({admin,run,status,env,output,persist,objectDirectory,projectId,snapshotArgs,since}){
  const database=await findDatabase(join(persist,'v3/d1'));
  const sql=(query,...args)=>{const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
  const write=(query,...args)=>{const db=new DatabaseSync(database);try{db.prepare(query).run(...args);}finally{db.close();}};
  const business=()=>Object.fromEntries(Object.entries(snapshot(database)).filter(([table])=>!table.startsWith('legacy_import_')&&!table.startsWith('sqlite_')));
  const workCounts=()=>Object.fromEntries(work.map(table=>[table,sql(`SELECT COUNT(*) n FROM ${table}`)[0].n]));
  const customer=uuid('30',1),accounts=uuid('31',1),deleted=uuid('32',1),conversation=uuid('40',1),deletedConversation=uuid('43',1),owner=uuid('20',1);
  const arrival=uuid('62',1),newConversation=uuid('44',1),newMessage=uuid('62',2),afterDelete=uuid('62',3);

  // The seed's team edits a customer the retire will mark; a widget hand-off opened a survey cycle on
  // the conversation legacy resolves; a Move in holds a fence on the conversation id the sweep appends.
  write("UPDATE contacts SET name='Morgan (seed edit)' WHERE id=?",customer);
  write('INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,1,1,revision,created_at FROM conversations WHERE id=?',conversation);
  write('INSERT INTO move_in_native_fences(project_id,conversation_id) VALUES(?,?)',projectId,newConversation);

  // Legacy: one customer deleted a minute before the retire, a reply in their conversation, another
  // customer's change, a resolution, then the retire's two statements with one marker, then arrivals.
  await admin.query("SET time_zone='+00:00'");
  const [[clock]]=await admin.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') marker,DATE_FORMAT(UTC_TIMESTAMP()-INTERVAL 1 MINUTE,'%Y-%m-%d %H:%i:%s') earlier");
  const marker=clock.marker;
  await admin.query('UPDATE contacts SET deleted_at=?,updated_at=? WHERE id=?',[clock.earlier,clock.earlier,deleted]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,agent_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[afterDelete,projectId,deletedConversation,owner,'retire-local-deleted','A reply to a deleted customer']);
  await admin.query("UPDATE contacts SET name='Taylor Payables',updated_at=UTC_TIMESTAMP() WHERE id=?",[accounts]);
  await admin.query('UPDATE conversations SET resolved_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=?',[conversation]);
  // The first sweep's fixture soft-deleted the project; undo it so the retire runs exactly as recorded.
  await admin.query('UPDATE projects SET deleted_at=NULL WHERE id=?',[projectId]);
  const [retiredProject]=await admin.query('UPDATE projects SET deleted_at=? WHERE id=? AND deleted_at IS NULL',[marker,projectId]);
  const [retiredContacts]=await admin.query('UPDATE contacts SET deleted_at=? WHERE project_id=? AND deleted_at IS NULL',[marker,projectId]);
  assert.equal(retiredProject.affectedRows,1);assert.equal(retiredContacts.affectedRows,2,'the retire marks every live contact');
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[arrival,projectId,conversation,customer,'retire-local-arrival','A customer writes after the retire']);
  await admin.query('UPDATE conversations SET last_message_id=? WHERE id=?',[arrival,conversation]);
  await admin.query('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[newConversation,projectId,accounts]);
  await admin.query('INSERT INTO messages(id,project_id,conversation_id,contact_id,local_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',[newMessage,projectId,newConversation,accounts,'retire-local-new','A new conversation after the retire']);

  const deltaSnapshot=join(output,'delta-2.snapshot'),deltaImport=join(output,'delta-2.import');
  await run('scripts/export-legacy.mjs',[...snapshotArgs,'--chunk-bytes','4096','--since',since,'--output',deltaSnapshot],env);
  await run('scripts/export-legacy.mjs',['attachments','--input',deltaSnapshot,'--objects-dir',objectDirectory,'--output',deltaImport]);
  const importArgs=['--package',deltaImport,'--apply','--persist-to',persist];

  // A malformed marker, the marker with a single-file export or with a full package: refused before any read or write.
  const runs=()=>sql('SELECT COUNT(*) n FROM legacy_import_runs')[0].n,untouched=business(),untouchedRuns=runs();
  for(const args of [[...importArgs,'--retire-marker','2026-13-01 00:00:00'],[...importArgs,'--retire-marker',marker.replace(' ','T')],
    ['--file',join(output,'project-1.import.json'),'--apply','--persist-to',persist,'--retire-marker',marker],
    ['--package',join(output,'project-1.import'),'--apply','--persist-to',persist,'--retire-marker',marker]])
    assert.notEqual((await status('scripts/import-legacy.mjs',args)).code,0,args.join(' '));
  assert.equal(runs(),untouchedRuns,'no run row');assert.deepEqual(business(),untouched,'no business row');

  // Without the marker the retire hides the sweep: every marked customer is a conflict and their new message is left out.
  const unmarked=join(output,'unmarked-state');await cp(persist,unmarked,{recursive:true});
  const plain=JSON.parse(await run('scripts/import-legacy.mjs',['--package',deltaImport,'--apply','--persist-to',unmarked]));
  for(const id of [customer,accounts])assert.ok(plain.conflicts.some(c=>c.sourceTable==='contacts'&&c.sourceId===id),'a marked customer is listed without the marker');
  assert.ok(!plain.ignoredRetireMarker);
  {const db=new DatabaseSync(await findDatabase(join(unmarked,'v3/d1')),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE id=?').get(arrival).n,0);}finally{db.close();}}

  const check=args=>status('scripts/legacy-import/check.mjs',['delta','--package',deltaImport,'--persist-to',persist,...args]);
  const previousTotal=JSON.parse((await check(['--previous-total','0'])).stdout).projectSourceRows;
  const resolutions=sql('SELECT COUNT(*) n FROM conversation_resolutions')[0].n,beforeWork=workCounts(),before=business();
  const project=sql('SELECT * FROM projects WHERE id=?',projectId),settings=sql('SELECT * FROM project_settings WHERE project_id=?',projectId);
  const applied=JSON.parse(await run('scripts/import-legacy.mjs',[...importArgs,'--retire-marker',marker]));
  assert.equal(applied.ignoredRetireMarker,2,'every contact row carrying the marker');assert.equal(applied.tables.contacts.ignoredRetireMarker,2);
  const listed=new Set(applied.conflicts.map(c=>`${c.sourceTable}:${c.sourceId}`));
  assert.equal(listed.has(`contacts:${customer}`)||listed.has(`contacts:${accounts}`),false,'a marked customer is not a conflict');
  assert.ok(applied.conflicts.some(c=>c.sourceTable==='contacts'&&c.sourceId===deleted&&c.reason==='deleted in legacy; the seed keeps its row'),'a customer deleted at another time is still listed');
  assert.ok(applied.updated>=2,'the conversation and the changed marked customer are updated');
  // Arrivals after the retire import live; the seed's own edit of a marked customer stays.
  assert.deepEqual(sql('SELECT name FROM contacts WHERE id=?',customer),[{name:'Morgan (seed edit)'}]);
  assert.deepEqual(sql('SELECT name FROM contacts WHERE id=?',accounts),[{name:'Taylor Payables'}]);
  assert.deepEqual(sql('SELECT last_message_id,resolved_at IS NOT NULL resolved FROM conversations WHERE id=?',conversation),[{last_message_id:arrival,resolved:1}]);
  assert.deepEqual(sql('SELECT id FROM messages WHERE id IN (?,?,?) ORDER BY id',arrival,newMessage,afterDelete),[{id:arrival},{id:newMessage}].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual(sql("SELECT status FROM legacy_import_rows WHERE source_table='messages' AND source_id=?",afterDelete),[{status:'archived_only'}],'the deleted customer\'s conversation stays archive-only');
  assert.deepEqual(sql('SELECT * FROM projects WHERE id=?',projectId),project,'the workspace and its settings stay as the seed has them');assert.deepEqual(sql('SELECT * FROM project_settings WHERE project_id=?',projectId),settings);
  // Nothing automatic reaches a customer: no resolution (no survey), no work; the Move in fence stays and the batch's own are gone.
  assert.equal(sql('SELECT COUNT(*) n FROM conversation_resolutions')[0].n,resolutions,'a delta resolution offers no survey');
  assert.deepEqual(workCounts(),beforeWork);
  assert.deepEqual(sql('SELECT project_id,conversation_id FROM move_in_native_fences'),[{project_id:projectId,conversation_id:newConversation}]);

  // An exact rerun with the same marker changes nothing; the check passes.
  const after=business(),journal=sql('SELECT COUNT(*) n FROM legacy_import_rows')[0].n,objects=await bucketSnapshot(join(persist,'v3/r2'));
  const rerun=JSON.parse(await run('scripts/import-legacy.mjs',[...importArgs,'--retire-marker',marker]));
  assert.equal(rerun.replayed,applied.sourceRows);assert.equal(rerun.appended+rerun.updated,0);assert.equal(rerun.ignoredRetireMarker,2);
  assert.deepEqual(business(),after);assert.equal(sql('SELECT COUNT(*) n FROM legacy_import_rows')[0].n,journal);
  assert.deepEqual(await bucketSnapshot(join(persist,'v3/r2')),objects);assert.notDeepEqual(after,before);
  const checked=await check(['--previous-total',String(previousTotal)]);
  assert.equal(checked.code,0,checked.stdout);
  write('DELETE FROM move_in_native_fences WHERE project_id=? AND conversation_id=?',projectId,newConversation);
  return {marker,ignoredRetireMarker:applied.ignoredRetireMarker,appended:applied.appended,updated:applied.updated,conflicts:applied.conflicts.length,projectSourceRows:JSON.parse(checked.stdout).projectSourceRows};
}
