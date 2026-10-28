import {seedCampaignArchive,assertCampaignArchive} from './feedback/archive.mjs';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {splitSqlStatements} from '../../scripts/delivery/base/sql-statements.mjs';
import {archiveStorage,archiveSnapshot,compareArchive} from './rer-archive.mjs';
import {command} from './rer-command.mjs';

const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Platform applies each file and its SHA-256 ledger row in the same batch.
async function platformDestination(root){
 await execute(process.execPath,['scripts/migrations.mjs'],{cwd:root});
 const directory=join(root,'.generated/migrations');
 await archiveStorage(root,async({DB})=>{
  await DB.prepare('CREATE TABLE rer_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
   const sql=await readFile(join(directory,name),'utf8');
   await DB.batch([DB.prepare('INSERT INTO rer_migrations(name,sha256) VALUES(?,?)').bind(name,hash(sql)),...splitSqlStatements(sql).map(statement=>DB.prepare(statement))]);
  }
 });
}

async function databaseSnapshot(root){return archiveStorage(root,async({DB})=>{
 const schema=(await DB.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY name").all()).results,rows={};
 const tables=schema.filter(item=>item.type==='table');
 for(let offset=0;offset<tables.length;offset+=50){const chunk=tables.slice(offset,offset+50),results=await DB.batch(chunk.map(({name})=>DB.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`)));for(const [index,{name}] of chunk.entries())rows[name]=results[index].results.map(row=>JSON.stringify(row)).sort();}
 return {schema,rows};
});}

export async function platformArchiveJourney(){
 const source=resolve('.'),scratch=await mkdtemp(join(tmpdir(),'h2h-platform-archive-'));
 async function fixture(name,additive=false){
  const root=join(scratch,name);await mkdir(root);
  for(const entry of ['scripts','src','migrations','docs','management','package.json','seed.json','OPERATIONS.json','OPERATIONS.md','ACCEPTANCE.md','rer-setup.json','wrangler.jsonc','deploy.json'])await cp(join(source,entry),join(root,entry),{recursive:true});
  await symlink(join(source,'node_modules'),join(root,'node_modules'),'dir');
  if(additive)await writeFile(join(root,'migrations/9999_archive_addition.sql'),'CREATE TABLE archive_addition(id TEXT PRIMARY KEY,value TEXT);\n');
  return root;
 }
 async function cli(root,args,expected=0){
  const process=command(root,args);
  try{
   const result=await process.result();
   const failures=result.events.filter(event=>event.event==='error');
   console.log(JSON.stringify({command:args[0],fixture:root.slice(scratch.length+1),exit:result.code,errors:failures.map(({code,message})=>({code,message}))}));
   assert.equal(result.code,expected,JSON.stringify(failures));return result;
  }finally{await process.stop();}
 }
 try{
  const original=await fixture('source');await platformDestination(original);
  await archiveStorage(original,async({DB,FILES})=>{
   await DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('archive-project','Archive support','archive-widget','https://example.test',1)").run();
   await DB.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('archive-contact','archive-project','Archive visitor','visitor@example.test',1)").run();
   // Managed mail history travels through the public rer archive, with routing authority revoked.
   await DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('archive-conversation','archive-project','archive-contact',1,'archive-message',1,2)").run();
   await DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('archive-message','archive-project','archive-conversation','synthetic-mail-message','archive-contact','contact','Retained managed mail',1,2)").run();
   await DB.prepare("INSERT INTO rer_mailboxes(project_id,allocation_key,mailbox_id,address,generation,state,configured,route_active,updated_at) VALUES('archive-project','synthetic-allocation','synthetic-mailbox','synthetic-support@mail.example.test',1,'ready',1,1,2)").run();
   await DB.prepare("INSERT INTO email_threading_keys VALUES('archive-project','archive-conversation','message_id','<synthetic-retained@mail.example.test>','managed','synthetic-retained',2)").run();
   await DB.prepare("INSERT INTO email_reply_grants VALUES('synthetic-live-reply-grant','archive-project','archive-conversation','visitor@example.test',2)").run();
   await DB.prepare("INSERT INTO email_deliveries VALUES('synthetic-managed-delivery','archive-project','visitor@example.test','Retained reply','synthetic-intent','sent','<synthetic-receipt@mail.example.test>',NULL,2,2)").run();
   await FILES.put('archive-project/retained.txt','Retained support attachment',{httpMetadata:{contentType:'text/plain'},customMetadata:{purpose:'archive-journey'}});
  });
  await archiveStorage(original,seedCampaignArchive);
  const archive=join(original,'exports/platform.rer');
  await cli(original,['export','--output',archive]);
  const before=await archiveSnapshot(original);
  assert.ok(before.rows.contacts.length && before.objects.length,'the archive contains business rows and file bytes');
  assert.equal((await stat(archive)).mode&0o777,0o600);
  const sourceLedger=await databaseSnapshot(original);
  assert.ok(sourceLedger.rows.rer_migrations);assert.equal(sourceLedger.rows.d1_migrations,undefined,'export never introduces a second ledger');
  for(const kind of ['platform','native']){
   // The archive predates this additive migration. Platform runs it itself;
   // a fresh native destination keeps the existing Wrangler preparation path.
   const root=await fixture(kind,true);
   if(kind==='platform')await platformDestination(root);
   const prior=kind==='platform'?await databaseSnapshot(root):undefined;
   await cli(root,['import','--input',archive,'--yes']);
   compareArchive(before,await archiveSnapshot(root),['archive_addition']);
   await archiveStorage(root,assertCampaignArchive);
   await archiveStorage(root,async({DB})=>{
    const mailbox=await DB.prepare("SELECT state,configured,route_active FROM rer_mailboxes WHERE project_id='archive-project'").first();
    assert.deepEqual(mailbox,{state:'revoked',configured:0,route_active:0});
    assert.ok((await DB.prepare('SELECT token_hash FROM email_reply_grants').first()).token_hash.startsWith('archived:'));
    assert.equal((await DB.prepare('SELECT count(*) n FROM rer_mailbox_outbox').first()).n,0);
    assert.equal((await DB.prepare("SELECT content FROM messages WHERE id='archive-message'").first()).content,'Retained managed mail');
   });
   const restoredLedger=await databaseSnapshot(root);
   if(kind==='platform')assert.deepEqual(restoredLedger.rows.rer_migrations,prior.rows.rer_migrations,'import preserves Platform history');
   assert.ok(restoredLedger.rows[kind==='platform'?'rer_migrations':'d1_migrations']);
   assert.equal(restoredLedger.rows[kind==='platform'?'d1_migrations':'rer_migrations'],undefined);
   await cli(root,['export','--output','exports/roundtrip.rer']);
   compareArchive(before,await archiveSnapshot(root),['archive_addition']);
  }
  // Refusals happen before snapshot capture, schema preparation or transfer.
  const root=await fixture('refusals');await platformDestination(root);
  const names=(await readdir(join(root,'.generated/migrations'))).filter(name=>name.endsWith('.sql')).sort(),last=names.at(-1);
  const row=await archiveStorage(root,({DB})=>DB.prepare('SELECT * FROM rer_migrations WHERE name=?').bind(last).first());
  async function refuse(reason){
   const before=await databaseSnapshot(root),objects=await archiveSnapshot(root);
   const output=join(root,'exports/refused.rer');
   for(const args of [['export','--output',output],['import','--input',archive,'--yes']]){
    const result=await cli(root,args,4);
    assert.match(result.events.find(event=>event.event==='error').message,reason);
    assert.deepEqual(await databaseSnapshot(root),before,'a refused operation changes no schema or row, including snapshots and ledgers');
    compareArchive(objects,await archiveSnapshot(root));
    await assert.rejects(stat(output),{code:'ENOENT'});
   }
  }
  await archiveStorage(root,({DB})=>DB.prepare('DELETE FROM rer_migrations WHERE name=?').bind(last).run());
  await refuse(new RegExp('migration_ledger:unapplied:'+last.replaceAll('.','\\.')));
  await archiveStorage(root,async({DB})=>{
   await DB.prepare('INSERT INTO rer_migrations(name,sha256,applied_at) VALUES(?,?,?)').bind(row.name,row.sha256,row.applied_at).run();
   await DB.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)').run();
  });
  await refuse(/migration_ledger:multiple:rer_migrations/);
  await archiveStorage(root,async({DB})=>{
   await DB.prepare('DROP TABLE d1_migrations').run();
   await DB.prepare('UPDATE rer_migrations SET sha256=? WHERE name=?').bind(hash('changed migration bytes'),last).run();
  });
  await refuse(/migration_ledger:unknown:/);
  console.log('Platform archive journey passed: Platform export; older archive into Platform and native destinations; row/file equality; ledger custody; native re-export; missing, multiple and mismatched ledger refusals with no write.');
 }finally{await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
