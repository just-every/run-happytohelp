import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {seedLegacy} from './legacy-export/fixture.mjs';
import {assertArtifact,assertAllNativeStores,assertMappedBusinessState} from './legacy-export/assertions.mjs';
import {assertCredentialRefusals} from './legacy-export/refusals.mjs';
import {assertDeltaSweep} from './legacy-export/delta.mjs';
import {assertFullErasure} from './legacy-export/resume.mjs';

// One public-command integration flow, using real MySQL and local D1/R2.
test('project snapshot → attachment bytes → native import → safe replay → delta sweep since the watermark', {timeout:360000}, async () => {
  const output=process.env.LEGACY_TEST_OUTPUT?resolve(process.env.LEGACY_TEST_OUTPUT):await mkdtemp(join(tmpdir(),'h2h-legacy-export-'));
  await mkdir(output,{recursive:true,mode:0o700});
  const database='h2h_export_'+randomBytes(5).toString('hex'),reader='export_'+randomBytes(5).toString('hex');
  const password='fixture-'+randomBytes(12).toString('hex');
  const host=process.env.LEGACY_TEST_MYSQL_HOST||'127.0.0.1',port=Number(process.env.LEGACY_TEST_MYSQL_PORT||3306);
  const admin=await mysql.createConnection({host,port,user:process.env.LEGACY_TEST_MYSQL_USER||'root',password:process.env.LEGACY_TEST_MYSQL_PASSWORD||'',
    ...(process.env.LEGACY_TEST_MYSQL_SOCKET?{socketPath:process.env.LEGACY_TEST_MYSQL_SOCKET}:{})});
  const run=(script,args=[],env={})=>new Promise((resolveRun,reject)=>{
    const child=spawn(process.execPath,[script,...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.once('error',reject);child.once('exit',code=>code===0?resolveRun(stdout):reject(Error(`${script} exited ${code}: ${stdout}\n${stderr}`)));
  });
  const status=(script,args=[])=>new Promise((resolveRun,reject)=>{
    const child=spawn(process.execPath,[script,...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},stdio:['ignore','pipe','inherit']});let stdout='';
    child.stdout.on('data',b=>stdout+=b);child.once('error',reject);child.once('exit',code=>resolveRun({code,stdout}));
  });
  const persist=join(output,'native-state'),objectDirectory=join(output,'source-objects');
  let success=false;
  try{
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${database}\``);
    const fixture=await seedLegacy(admin,{objectDirectory});
    await admin.query(`CREATE USER '${reader}'@'%' IDENTIFIED BY ?`,[password]);
    await admin.query(`GRANT SELECT ON \`${database}\`.* TO '${reader}'@'%'`);
    const env={LEGACY_MYSQL_HOST:host,LEGACY_MYSQL_PORT:String(port),LEGACY_MYSQL_DATABASE:database,LEGACY_MYSQL_USER:reader,LEGACY_MYSQL_PASSWORD:password};
    const readonly=await mysql.createConnection({host,port,database,user:reader,password});
    try{await assert.rejects(readonly.execute('DELETE FROM projects'),/denied/i);}finally{await readonly.end();}
    await run('scripts/migrations.mjs');
    await run('node_modules/wrangler/bin/wrangler.js',['d1','migrations','apply','DB','--local','--persist-to',persist]);
    const empty=join(output,'empty-state');await cp(persist,empty,{recursive:true});
    const results=[],files=[],sources=[];
    for(const [index,projectId] of fixture.projectIds.entries()){
      const snapshot=join(output,`project-${index+1}.snapshot.json`),file=join(output,`project-${index+1}.import.json`);
      const snapshotArgs=['snapshot','--project',projectId,'--revision','fixture-legacy-schema','--ai-model','gpt-5.6-luna','--mail-from-domain','example.test'];
      await run('scripts/export-legacy.mjs',[...snapshotArgs,'--output',snapshot],env);
      const raw=await assertArtifact(snapshot,fixture.secrets);
      sources.push(raw);
      if(index===0)await assertCredentialRefusals({admin,run,env,output,projectId,snapshotArgs,snapshot,objectDirectory});
      assert.equal(raw.tables.ai_logs,undefined,'operational AI request logs are excluded');
      assert.ok(raw.tables.events.every(row=>row.type!=='PAGE_VIEW'),'visitor tracking is excluded');
      assert.equal(raw.tables.projects.length,1);assert.equal(raw.tables.projects[0].id,projectId);
      for(const rows of Object.values(raw.tables))for(const row of rows)if(row.project_id)assert.equal(row.project_id,projectId);
      assert.equal(raw.tables.users.length,2,'owner and this project’s AI only');
      assert.equal(raw.tables.users[0].password,undefined);assert.equal(raw.tables.projects[0].verification_secret,undefined);
      assert.equal(raw.tables.projects[0].ai_balance,'12.500000','decimal remains exact text');
      await run('scripts/export-legacy.mjs',['attachments','--input',snapshot,'--objects-dir',objectDirectory,'--output',file]);
      await assertArtifact(file,fixture.secrets);
      // Exercise the scalable format through the same public doors, then replay
      // into empty state, then use JSON to prove both formats preserve identical state.
      const chunkSnapshot=join(output,`project-${index+1}.snapshot`),chunkImport=join(output,`project-${index+1}.import`);
      await run('scripts/export-legacy.mjs',[...snapshotArgs,'--chunk-bytes','4096','--output',chunkSnapshot],env);
      await run('scripts/export-legacy.mjs',['attachments','--input',chunkSnapshot,'--objects-dir',objectDirectory,'--output',chunkImport]);
      const chunked=JSON.parse(await run('scripts/import-legacy.mjs',['--package',chunkImport,'--apply','--persist-to',persist]));
      const first=JSON.parse(await run('scripts/import-legacy.mjs',['--file',file,'--apply','--persist-to',persist]));
      const replay=JSON.parse(await run('scripts/import-legacy.mjs',['--file',file,'--apply','--persist-to',persist]));
      assert.equal(chunked.sourceRows,first.sourceRows);assert.equal(chunked.mappedRows,first.mappedRows);assert.equal(chunked.objects,index?1:2,'the first company also carries its guide\'s diagram');
      // Each reply's storage URL naming the customer's carried attachment becomes its native URL (and the first company's
      // guide's diagram); the URL of a file the export does not carry is left and counted, by either format.
      for(const summary of [chunked,first])assert.deepEqual(summary.mediaUrls,{rewritten:index?1:2,left:1});
      assert.equal(first.applied,first.sourceRows);assert.equal(replay.applied,0);assert.equal(replay.replayed,first.sourceRows);
      const chunkReplay=JSON.parse(await run('scripts/import-legacy.mjs',['--package',chunkImport,'--apply','--persist-to',persist]));
      assert.equal(chunkReplay.applied,0);assert.equal(chunkReplay.replayed,first.sourceRows);
      results.push({projectId,source:raw.source.rowCounts,first,replay,chunked,chunkReplay});files.push(file);
      if(index===0){
        // Without the legacy MAIL_FROM_DOMAIN the package still imports: sender kept, mailbox held and disabled.
        const deferred=join(output,'deferred.snapshot'),deferredImport=join(output,'deferred.import'),deferredState=join(output,'deferred-state');
        await run('scripts/export-legacy.mjs',['snapshot','--project',projectId,'--revision','fixture-legacy-schema','--ai-model','gpt-5.6-luna','--defer-mail-domain','--chunk-bytes','4096','--output',deferred],env);
        await run('scripts/export-legacy.mjs',['attachments','--input',deferred,'--objects-dir',objectDirectory,'--output',deferredImport]);
        await run('node_modules/wrangler/bin/wrangler.js',['d1','migrations','apply','DB','--local','--persist-to',deferredState]);
        await run('scripts/import-legacy.mjs',['--package',deferredImport,'--apply','--persist-to',deferredState]);
        const {getPlatformProxy}=await import('wrangler');const proxy=await getPlatformProxy({remoteBindings:false,persist:{path:join(deferredState,'v3')}});
        try{
          const email=await proxy.env.DB.prepare('SELECT * FROM email_settings WHERE project_id=?').bind(projectId).first();
          assert.equal(email.from_address,raw.tables.projects[0].email_from_address,'unverified legacy sender is kept');
          assert.equal(email.inbound_address,null,'no inbound address is invented');assert.equal(email.is_enabled,0,'unverified mail stays disabled');
          assert.match((await proxy.env.DB.prepare("SELECT reason FROM legacy_import_holds WHERE source_table='projects'").first()).reason,/not verified/);
        }finally{await proxy.dispose();}
      }
    }
    const {getPlatformProxy}=await import('wrangler');const proxy=await getPlatformProxy({remoteBindings:false,persist:{path:join(persist,'v3')}});
    const native={};
    try{
      const expected={projects:2,users:1,memberships:2,contacts:4,conversations:4,messages:8,conversation_notes:2,media:2,legacy_import_files:1,knowledge_categories:6,knowledge_articles:4,knowledge_article_categories:6,macros:2,project_settings:2,knowledge_datasets:4,knowledge_documents:2,context_insights:4,context_tracked_events:4,local_devices:2,local_grants:2,local_device_settings:2,local_jobs:2,local_events:2,email_settings:2,public_project_aliases:2};
      for(const [table,count] of Object.entries(expected)){const row=await proxy.env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first();native[table]=row.n;assert.equal(row.n,count,table);}
      assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM knowledge_categories WHERE is_published=0').first()).n,2);
      assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM knowledge_articles WHERE status=\'draft\'').first()).n,2);
      assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM messages WHERE content LIKE \'%Internal only%\' OR content LIKE \'Removed duplicate%\'').first()).n,0);
      assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM conversation_notes WHERE content LIKE \'%Internal only.%\'').first()).n,2);
      assert.equal((await proxy.env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE instr(content,'Reset password: https://')>0 AND instr(content,'.example.test/password/reset (never share <redacted>)')>0").first()).n,2,'public links stay; repeated credentials do not');
      assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM contacts WHERE email LIKE \'preferred@%\'').first()).n,2);
      await assertMappedBusinessState(proxy.env,sources,files);
      assert.equal((await proxy.env.DB.prepare("SELECT COUNT(*) n FROM messages m JOIN media f ON f.conversation_id=m.conversation_id WHERE instr(m.content,'Your copy: /api/conversations/'||m.conversation_id||'/media/'||f.id||' (last year')>0").first()).n,2,'each reply links its conversation\'s native file');
      assert.equal((await proxy.env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE instr(content,'https://storage.happytohelp.com/')>0 AND instr(content,'/invoice-2025.txt')>0").first()).n,2,'a URL whose file is not carried is kept');
      // The guide's diagram has the file door; the guide is in an unpublished collection, so nobody outside the workspace gets it.
      const {importedFiles}=await import('../src/modules/legacy-import/file-door.ts'),diagram=await proxy.env.DB.prepare('SELECT project_id,media_id,audience FROM legacy_import_files').first();
      assert.equal(diagram.audience,'article');assert.ok((await proxy.env.DB.prepare('SELECT 1 FROM knowledge_articles WHERE instr(content,?)>0').bind(`/api/imported-files/${diagram.project_id}/${diagram.media_id}`).first()));
      assert.equal((await importedFiles.request(`http://localhost/${diagram.project_id}/${diagram.media_id}`,{},proxy.env)).status,404);
      assert.equal((await proxy.env.DB.prepare("SELECT COUNT(*) n FROM local_devices WHERE worker_ready_at IS NULL AND revoked_at IS NOT NULL").first()).n,2,'imported devices carry no authority');
      assert.equal((await proxy.env.DB.prepare("SELECT COUNT(*) n FROM local_events WHERE json_extract(payload,'$.message')='Reading invoice details'").first()).n,2,'delegation progress text is live');
      await assertAllNativeStores(proxy.env,fixture.secrets,persist);
    }finally{await proxy.dispose();}
    // The second company's full package and an erasure of its customer, from the empty state.
    const fullErasure=await assertFullErasure({output,from:empty,pkg:join(output,'project-2.import'),projectId:fixture.projectIds[1]});
    const delta=await assertDeltaSweep({admin,run,status,env,output,persist,objectDirectory,projectId:fixture.projectIds[0],
      snapshotArgs:['snapshot','--project',fixture.projectIds[0],'--revision','fixture-legacy-schema','--ai-model','gpt-5.6-luna','--mail-from-domain','example.test'],
      fullSnapshot:join(output,'project-1.snapshot'),fullImport:join(output,'project-1.import')});
    await writeFile(join(output,'results.json'),JSON.stringify({fixture:fixture.counts,native,imports:results,files,persist,fullErasure,delta},null,2));
    console.log(JSON.stringify({output,fixture:fixture.counts,native,replayApplied:results.map(r=>r.replay.applied)}));success=true;
  }finally{
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);await admin.query(`DROP USER IF EXISTS '${reader}'@'%'`);await admin.end();
    if(success&&!process.env.LEGACY_TEST_OUTPUT)await rm(output,{recursive:true,force:true});
  }
});
