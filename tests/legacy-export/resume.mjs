import assert from 'node:assert/strict';
import {cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {findDatabase,snapshot,snapshotTable,bucketSnapshot} from '../helpers/upgrade-snapshot.mjs';
import {checkDelta} from '../../scripts/legacy-import/checks/delta.mjs';
import {localTarget} from '../../scripts/legacy-import/target.mjs';

const uuid=(group,number)=>`${group}000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
// The seed's ticket triggers record each write with a random id at the time it ran; two imports compare on the rest of the record.
const stamped={ticket_history:['project_id','conversation_id','actor_id','actor_type','source','changes_json'],audit_events:['project_id','category','action','outcome','actor_type','actor_id','source','target_type','target_id','purpose']};
const business=database=>{
  const tables=Object.fromEntries(Object.entries(snapshot(database)).filter(([table])=>!table.startsWith('legacy_import_')&&!table.startsWith('sqlite_')));
  const db=new DatabaseSync(database,{readOnly:true});try{for(const [table,columns] of Object.entries(stamped))tables[table]=snapshotTable(db,table,columns);}finally{db.close();}
  return tables;
};
// Two imports store the same bytes under their own blob ids and upload times; the objects, metadata and bytes must match.
const objectsOf=async state=>{const {objects,blobs}=await bucketSnapshot(join(state,'v3/r2'));return {objects:objects.map(o=>{const {key,size,etag,custom_metadata}=JSON.parse(o);return {key,size,etag,custom_metadata};}),blobs};};
const read=(database,query,...args)=>{const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
const write=(database,query)=>{const db=new DatabaseSync(database);try{db.exec(query);}finally{db.close();}};

/** `check.mjs delta` through checkDelta, with the local target's D1 answering once as D1 does under load (a fake at
 * the D1 edge only): an "overloaded" answer is waited out and the check's result is the CLI's; another error fails at once. */
export async function assertCheckRetry({persist,deltaImport,previousTotal,expected}){
  for(const [message,retried] of [['D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window',true],['D1_ERROR: no such table: legacy_import_runs',false]]){
    const target=await localTarget(persist);let answered=0;
    const DB={prepare:sql=>{const statement=target.env.DB.prepare(sql);return {bind:(...args)=>{const bound=statement.bind(...args);return {all:async()=>{if(!answered++)throw Error(message);return bound.all();}};}};}};
    try{
      const started=Date.now(),checking=checkDelta({env:{DB,FILES:target.env.FILES}},deltaImport,{previousTotal});
      if(!retried){await assert.rejects(checking,/no such table/);assert.equal(answered,1,'another error is not retried');continue;}
      const result=await checking;
      assert.ok(Date.now()-started>=2000,'the first retry waits past a moment');assert.equal(result.retries,1);
      assert.deepEqual({...result,retries:0},expected,'the retried check reads what the CLI printed');
    }finally{await target.close();}
  }
}

/** A delta sweep stopped partway resumes with the same command and package: from the state before the sweep, one copy
 * imports it uninterrupted; another is stopped by a refused row in the second batch of its contacts chunk (a temporary
 * trigger), as the live stop was, and is then run again. Both end the same, nothing is journaled twice and a rerun changes nothing. */
export async function assertResumedSweep({admin,run,status,env,output,objectDirectory,from,projectId,snapshotArgs,since}){
  // Legacy takes 105 more customers, so one contacts chunk of a larger package holds more than one 100-row batch.
  const customers=Array.from({length:105},(_,i)=>uuid('35',i+1));
  await admin.query('INSERT INTO contacts(id,project_id,name,identifier,created_at) VALUES ?',[customers.map((id,i)=>[id,projectId,`Resume customer ${i+1}`,'',`2026-01-01 00:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}`])]);
  await admin.query('UPDATE contacts SET updated_at=UTC_TIMESTAMP() WHERE id IN (?)',[customers]);
  const exported=join(output,'resume.snapshot'),pkg=join(output,'resume.import');
  try{
    await run('scripts/export-legacy.mjs',[...snapshotArgs,'--chunk-bytes','4194304','--since',since,'--output',exported],env);
    await run('scripts/export-legacy.mjs',['attachments','--input',exported,'--objects-dir',objectDirectory,'--output',pkg]);
  }finally{await admin.query('DELETE FROM contacts WHERE id IN (?)',[customers]);}
  const whole=join(output,'resume-whole'),stopped=join(output,'resume-stopped');
  await cp(from,whole,{recursive:true});await cp(from,stopped,{recursive:true});
  try{
    const args=state=>['--package',pkg,'--apply','--persist-to',state];
    const uninterrupted=JSON.parse(await run('scripts/import-legacy.mjs',args(whole)));
    const wholeDb=await findDatabase(join(whole,'v3/d1')),stoppedDb=await findDatabase(join(stopped,'v3/d1'));
    const digest=uninterrupted.manifestSha256,ofPackage="(id='legacy-package:'||?1 OR json_extract(source_json,'$.package')=?1)";
    const packageRuns=database=>read(database,`SELECT id,state FROM legacy_import_runs WHERE ${ofPackage} ORDER BY id`,digest);
    const journaled=database=>read(database,`SELECT COUNT(*) n FROM legacy_import_rows WHERE run_id IN (SELECT id FROM legacy_import_runs WHERE ${ofPackage})`,digest)[0].n;
    const contactsRun=database=>read(database,`SELECT r.state,COUNT(j.source_id) journaled FROM legacy_import_runs r LEFT JOIN legacy_import_rows j ON j.run_id=r.id WHERE json_extract(r.source_json,'$.table')='contacts' AND json_extract(r.source_json,'$.package')=? GROUP BY r.id`,digest);

    write(stoppedDb,`CREATE TRIGGER resume_fixture_refusal BEFORE INSERT ON contacts WHEN NEW.id='${customers.at(-1)}' BEGIN SELECT RAISE(ABORT,'refused by the resume fixture'); END`);
    const failed=await status('scripts/import-legacy.mjs',args(stopped));
    assert.notEqual(failed.code,0,'the refused batch stops the import');
    const [contacts]=contactsRun(stoppedDb);
    assert.deepEqual(contacts,{state:'running',journaled:100},'the chunk\'s first batch committed');
    const states=packageRuns(stoppedDb).map(r=>r.state),committed=journaled(stoppedDb);
    assert.ok(states.includes('complete')&&states.filter(s=>s==='running').length===2,'earlier chunks complete; the contacts chunk and the package running');
    assert.ok(packageRuns(stoppedDb).length<packageRuns(wholeDb).length,'later chunks never started');
    write(stoppedDb,'DROP TRIGGER resume_fixture_refusal');

    const resumed=JSON.parse(await run('scripts/import-legacy.mjs',args(stopped)));
    assert.equal(resumed.replayed,committed);assert.equal(resumed.sourceRows,uninterrupted.sourceRows);
    assert.deepEqual(resumed.conflicts.map(c=>JSON.stringify(c)).sort(),uninterrupted.conflicts.map(c=>JSON.stringify(c)).sort());
    assert.deepEqual(packageRuns(stoppedDb),packageRuns(wholeDb),'the same runs');assert.ok(packageRuns(stoppedDb).every(r=>r.state==='complete'),'every run of the package is complete');
    assert.deepEqual(read(stoppedDb,'SELECT source_table,source_id FROM legacy_import_rows WHERE run_id IN (SELECT id FROM legacy_import_runs WHERE json_extract(source_json,\'$.package\')=?) GROUP BY 1,2 HAVING COUNT(*)>1',uninterrupted.manifestSha256),[],'no source row is journaled twice');
    const journal=database=>read(database,'SELECT COUNT(*) n FROM legacy_import_rows')[0].n;
    assert.deepEqual(business(stoppedDb),business(wholeDb),'the resumed sweep leaves the business rows of an uninterrupted one');
    assert.deepEqual(await objectsOf(stopped),await objectsOf(whole));assert.equal(journal(stoppedDb),journal(wholeDb));
    assert.equal(read(stoppedDb,'SELECT COUNT(*) n FROM contacts WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(customers))[0].n,customers.length);

    const settled={business:business(stoppedDb),objects:await objectsOf(stopped),journal:journal(stoppedDb)};
    const rerun=JSON.parse(await run('scripts/import-legacy.mjs',args(stopped)));
    assert.equal(rerun.replayed,rerun.sourceRows);assert.equal(rerun.appended+rerun.updated,0);
    assert.deepEqual({business:business(stoppedDb),objects:await objectsOf(stopped),journal:journal(stoppedDb)},settled,'a rerun after completion changes nothing');
    return {sourceRows:uninterrupted.sourceRows,runs:packageRuns(stoppedDb).length,runsAtStop:states.length,replayed:resumed.replayed};
  }finally{await rm(whole,{recursive:true,force:true});await rm(stopped,{recursive:true,force:true});await rm(from,{recursive:true,force:true});}
}

/** A full package and an erasure of a contact in its workspace. From the empty state, one copy imports the second company's
 * package uninterrupted. On another its first run stops at the conversations chunk (a temporary trigger, as a lost
 * connection stops it), after it uploaded every file and wrote the contacts; then the customer's erasure holds her live
 * lease: the rerun waits and writes nothing. When that erasure is left interrupted (its lease expired, its row kept) the
 * rerun completes treating her as erased: each pending row of hers journaled as erasure leaves it (no copy, status erased,
 * the mapped target the uninterrupted import journaled), none of her canonical or search rows written, her file removed from
 * R2 with its record; everything else as the uninterrupted import has it. A replay changes nothing. */
export async function assertFullErasure({output,from,pkg,projectId}){
  const contact=uuid('30',2),conversation=uuid('40',2),media=uuid('80',2),fileKey=`legacy/projects/${projectId}/media/${media}`;
  const now="CAST(unixepoch('subsec')*1000 AS INTEGER)";
  const whole=join(output,'full-whole'),stopped=join(output,'full-stopped');
  await cp(from,whole,{recursive:true});await cp(from,stopped,{recursive:true});
  const command=state=>{
    const child=spawn(process.execPath,['scripts/import-legacy.mjs','--package',pkg,'--apply','--persist-to',state],{env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},stdio:['ignore','pipe','pipe']});
    const result={stdout:'',stderr:''};child.stdout.on('data',b=>result.stdout+=b);child.stderr.on('data',b=>result.stderr+=b);
    result.exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});return result;
  };
  try{
    const done=command(whole);assert.equal(await done.exit,0,done.stderr);
    const uninterrupted=JSON.parse(done.stdout);assert.equal(uninterrupted.erased,0);
    const wholeDb=await findDatabase(join(whole,'v3/d1')),stoppedDb=await findDatabase(join(stopped,'v3/d1'));
    const busy=(database,query,...args)=>{const db=new DatabaseSync(database,{readOnly:true});try{db.exec('PRAGMA busy_timeout=10000');return db.prepare(query).all(...args).map(row=>({...row}));}finally{db.close();}};
    const journal=database=>busy(database,'SELECT source_table,source_id,row_digest,source_json,target_table,target_key,status FROM legacy_import_rows ORDER BY 1,2');
    const keys=async state=>(await objectsOf(state)).objects.map(o=>o.key).sort();

    write(stoppedDb,"CREATE TRIGGER full_fixture_stop BEFORE INSERT ON legacy_import_rows WHEN NEW.source_table='conversations' BEGIN SELECT RAISE(ABORT,'stopped by the full-package fixture'); END");
    const first=command(stopped);assert.notEqual(await first.exit,0);assert.match(first.stderr,/stopped by the full-package fixture/);
    write(stoppedDb,'DROP TRIGGER full_fixture_stop');
    assert.deepEqual(read(stoppedDb,"SELECT status FROM legacy_import_rows WHERE source_table='contacts' AND source_id=?",contact),[{status:'mapped'}],'her contact was imported before the stop');
    assert.deepEqual(await keys(stopped),[fileKey],'every file was uploaded before the stop');
    const atStop=journal(stoppedDb);

    write(stoppedDb,`INSERT INTO contact_erasure_leases VALUES('${projectId}','${contact}','erasure-request',${now}+600000)`);
    const rerun=command(stopped);
    for(const started=Date.now();!/"step":"waiting","for":"erasure","erasures":1/.test(rerun.stderr);){assert.ok(Date.now()-started<60000,rerun.stderr);await new Promise(resolve=>setTimeout(resolve,200));}
    await new Promise(resolve=>setTimeout(resolve,3000));
    assert.deepEqual(journal(stoppedDb),atStop,'a full import waiting for an erasure writes nothing');assert.deepEqual(busy(stoppedDb,'SELECT * FROM legacy_delta_leases'),[]);
    write(stoppedDb,`UPDATE contact_erasure_leases SET expires_at=${now}-1`);
    assert.equal(await rerun.exit,0,rerun.stderr);
    const completed=JSON.parse(rerun.stdout);assert.equal(completed.objectsRemoved,1);assert.equal(completed.replayed,atStop.length);
    assert.match(rerun.stderr,/"step":"erased","contacts":1,"objects":1/);

    // Her pending rows: journaled as erasure leaves them, against the targets the uninterrupted import mapped them to.
    const wholeRows=new Map(journal(wholeDb).map(row=>[`${row.source_table}:${row.source_id}`,row])),rows=journal(stoppedDb),erased=rows.filter(row=>row.status==='erased');
    assert.equal(completed.erased,erased.length);assert.equal(rows.length,wholeRows.size);
    for(const ids of [['conversations',conversation],['messages',uuid('60',20)],['media',media],['events',uuid('51',2)],['support_delegations',uuid('b3',2)],['conversation_participants',uuid('42',2)]])
      assert.ok(erased.some(row=>row.source_table===ids[0]&&row.source_id===ids[1]),ids.join(':'));
    for(const row of erased){
      const original=wholeRows.get(`${row.source_table}:${row.source_id}`);assert.equal(row.source_json,'{}');
      assert.deepEqual([row.row_digest,row.target_table,row.target_key],[original.row_digest,original.target_table,original.target_key],`${row.source_table}:${row.source_id}`);
    }
    // Everyone else's rows are journaled exactly as the uninterrupted import journaled them.
    for(const row of rows.filter(row=>row.status!=='erased'))assert.deepEqual(row,wholeRows.get(`${row.source_table}:${row.source_id}`));
    // None of her canonical or search rows, words or file names; every other canonical row as the uninterrupted import wrote it.
    const theirs={conversations:'id=?1',messages:'conversation_id=?1',media:'conversation_id=?1',conversation_notes:'conversation_id=?1',conversation_buckets:'conversation_id=?1',conversation_participants:'conversation_id=?1',conversation_ai:'conversation_id=?1',local_jobs:'conversation_id=?1',local_events:'job_id IN (SELECT id FROM local_jobs WHERE conversation_id=?1)',context_tracked_events:"json_extract(payload,'$.conversation_id')=?1",reporting_legacy_conversations:'conversation_id=?1'};
    for(const [table,where] of Object.entries(theirs)){
      assert.ok(read(wholeDb,`SELECT COUNT(*) n FROM ${table} WHERE ${where}`,conversation)[0].n>0||['conversation_ai'].includes(table),`the uninterrupted import wrote ${table} of hers`);
      assert.deepEqual(read(stoppedDb,`SELECT COUNT(*) n FROM ${table} WHERE ${where}`,conversation),[{n:0}],`none of her ${table}`);
      assert.equal(read(stoppedDb,`SELECT COUNT(*) n FROM ${table}`)[0].n,read(wholeDb,`SELECT COUNT(*) n FROM ${table} WHERE NOT (${where})`,conversation)[0].n,`every other ${table} row`);
    }
    assert.deepEqual(read(stoppedDb,"SELECT COUNT(*) n FROM inbox_message_search WHERE inbox_message_search MATCH 'explain OR invoice'"),[{n:0}],'none of her words is searchable');
    assert.ok(read(wholeDb,"SELECT COUNT(*) n FROM inbox_message_search WHERE inbox_message_search MATCH 'explain OR invoice'")[0].n>0);
    assert.equal(read(stoppedDb,"SELECT COUNT(*) n FROM legacy_import_rows WHERE instr(source_json,'-invoice.txt')>0 OR instr(source_json,'Inspect this invoice')>0")[0].n,0,'her file name and words are journaled nowhere');
    const others=business(wholeDb),settledBusiness=business(stoppedDb);
    for(const table of ['projects','users','memberships','contacts','knowledge_categories','macros','project_settings','email_settings'])assert.deepEqual(settledBusiness[table],others[table],table);
    // Each install mints its own knowledge incarnation; the imported columns agree.
    const articles=database=>{const db=new DatabaseSync(database,{readOnly:true});try{return snapshotTable(db,'knowledge_articles',others.knowledge_articles.columns.filter(column=>column!=='source_incarnation'));}finally{db.close();}};
    assert.deepEqual(articles(stoppedDb),articles(wholeDb),'knowledge_articles');
    assert.deepEqual(await keys(stopped),[],'her file is removed from R2');assert.deepEqual(read(stoppedDb,'SELECT * FROM legacy_import_objects WHERE object_key=?',fileKey),[],'with its record');
    assert.deepEqual(await keys(whole),[fileKey]);

    const settled={business:settledBusiness,objects:await objectsOf(stopped),journal:journal(stoppedDb)};
    const replay=command(stopped);assert.equal(await replay.exit,0,replay.stderr);
    const replayed=JSON.parse(replay.stdout);assert.equal(replayed.applied,0);assert.equal(replayed.replayed,rows.length);assert.equal(replayed.objectsRemoved,0);
    assert.deepEqual({business:business(stoppedDb),objects:await objectsOf(stopped),journal:journal(stoppedDb)},settled,'a replay changes nothing');
    return {sourceRows:uninterrupted.sourceRows,erased:erased.length,replayed:completed.replayed};
  }finally{for(const state of [whole,stopped,from])await rm(state,{recursive:true,force:true});}
}
