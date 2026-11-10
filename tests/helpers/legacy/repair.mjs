import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {legacyBundle} from '../legacy-bundle.mjs'
import {findDatabase} from '../upgrade-snapshot.mjs'
import {createRuntime} from '../emitted-runtime.mjs'

const exec=promisify(execFile)
// Tables the fidelity round's full-import purge covers (src/modules/legacy-import/work-rows.ts). An installation imported
// before that round has their rows; the simulated pre-fix import below keeps them by ignoring the purge's deletes.
const purged=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','context_job_events','lead_jobs','leads','brand_generations','csat_surveys','workflow_events','conversation_resolutions','inbox_visitor_waiting','rer_mail_commands']

/** An installation imported by the importer before it removed its own work rows: the import runs, then a team works in the
 * workspace, then migration 320 is applied (its ledger row removed and the runtime started again, as an upgrade applies it). */
export async function legacyImportRepairJourney(){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-repair-')),persist=join(scratch,'state')
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const options={persist,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name}
 const env={...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'}
 const command=async(script,args)=>JSON.parse((await exec(process.execPath,[script,...args],{env,timeout:120000,maxBuffer:2*1024*1024})).stdout)
 const work=()=>command('scripts/legacy-import/check.mjs',['work','--persist-to',persist]).then(({at,...counts})=>counts)
 const sql=async(query,write=false)=>{const db=new DatabaseSync(await findDatabase(join(persist,'v3/d1')),{readOnly:!write});try{return write?db.exec(query):db.prepare(query).all().map(row=>({...row}))}finally{db.close()}}
 const apply320=async()=>{
  await sql("DELETE FROM d1_migrations WHERE name='320_legacy_import_work_repair.sql'",true)
  const runtime=await createRuntime(options);await runtime.close(true)
  assert.equal((await sql("SELECT count(*) n FROM d1_migrations WHERE name='320_legacy_import_work_repair.sql'"))[0].n,1)
  assert.equal((await sql("SELECT count(*) n FROM sqlite_master WHERE name='legacy_repair_scope'"))[0].n,0,'the migration leaves no scratch table')
 }
 try{
  let runtime=await createRuntime(options);await runtime.close(true)
  const baseline=await work()
  // The workspace: solved conversations with a visitor and an operator message, an open one a visitor waits in, a published article.
  const {bundle}=await legacyBundle(),date='2026-01-01T00:00:00.000Z',later='2026-01-02T00:00:00.000Z',t=bundle.tables
  for(let i=0;i<3;i++){
   t.contacts.push({id:'c'+i,project_id:'p',name:'Customer '+i,identifier:'customer-'+i,created_at:date})
   t.conversations.push({id:'solved'+i,project_id:'p',contact_id:'c'+i,created_at:date,resolved_at:later})
   t.messages.push({id:'sv'+i,project_id:'p',conversation_id:'solved'+i,contact_id:'c'+i,content:'Question',created_at:date,local_id:'sv'+i},{id:'sa'+i,project_id:'p',conversation_id:'solved'+i,agent_id:'u',content:'Answer',created_at:later,local_id:'sa'+i})
  }
  t.conversations.push({id:'open-waiting',project_id:'p',contact_id:'c0',created_at:date})
  t.messages.push({id:'ow',project_id:'p',conversation_id:'open-waiting',contact_id:'c0',content:'Anyone there?',created_at:date,local_id:'ow'})
  const file=join(scratch,'export.json');await writeFile(file,JSON.stringify(bundle))
  // The pre-fix importer, simulated at the database edge: its batch deletes of trigger rows are ignored, the default rule stays
  // published and nothing is marked read.
  await sql(purged.map(table=>`CREATE TRIGGER pre_fix_keep_${table} BEFORE DELETE ON ${table} BEGIN SELECT RAISE(IGNORE); END`).join(';'),true)
  await command('scripts/import-legacy.mjs',['--file',file,'--apply','--persist-to',persist,'--leave-unread','--publish-default-rules'])
  await sql(purged.map(table=>`DROP TRIGGER pre_fix_keep_${table}`).join(';'),true)
  const defect=await work()
  assert.ok(defect.native_integration_events>baseline.native_integration_events&&defect.workflow_events>baseline.workflow_events,'the pre-fix import left integration and workflow events')
  assert.ok((await sql('SELECT count(*) n FROM inbox_visitor_waiting'))[0].n>0,'the import left visitors waiting')
  // The team starts working: a customer is created, a solved conversation is reopened and an article is published.
  await new Promise(resolve=>setTimeout(resolve,200))
  const now=Date.now()
  await sql(`INSERT INTO contacts(id,project_id,name,created_at,is_verified,metadata_json) VALUES('native-contact','p','Native customer',${now},0,'{}');
   UPDATE conversations SET status_id='open',status_category='open',resolved_at=NULL,updated_at=${now} WHERE id='solved1';
   INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('native-article','p','native-guide','Native guide','Help','published',${now});`,true)
  const native=await sql("SELECT event,contact_id,conversation_id,json_extract(body,'$.article_id') article FROM native_integration_events WHERE contact_id='native-contact' OR conversation_id='solved1' AND created_at>="+now+" OR json_extract(body,'$.article_id')='native-article' ORDER BY event")
  assert.deepEqual(native.map(row=>row.event),['article.published','contact.created','conversation.status_changed'])
  const nativeWorkflow=await sql(`SELECT id FROM workflow_events WHERE conversation_id='solved1' AND at>=${now}`)
  assert.equal(nativeWorkflow.length,1)
  const before=await work()
  const survivors=async()=>({
   events:(await sql('SELECT id FROM native_integration_events ORDER BY id')).map(row=>row.id).join(),
   workflow:(await sql('SELECT id FROM workflow_events ORDER BY id')).map(row=>row.id).join()})
  // The upgrade applies 320.
  await apply320()
  const repaired=await work()
  assert.deepEqual(repaired,{...baseline,native_integration_events:baseline.native_integration_events+3,workflow_events:baseline.workflow_events+1},'check work returns to the pre-import counts plus the native activity')
  assert.ok(before.native_integration_events>repaired.native_integration_events)
  assert.deepEqual((await sql("SELECT event FROM native_integration_events ORDER BY event")).map(row=>row.event),['article.published','contact.created','conversation.status_changed'],'the native rows survive')
  assert.deepEqual((await sql("SELECT conversation_id FROM workflow_events")).map(row=>row.conversation_id),['solved1'])
  assert.equal((await sql('SELECT count(*) n FROM inbox_visitor_waiting'))[0].n,0,'imported visitors are history, not a visitor waiting')
  assert.equal((await sql("SELECT count(*) n FROM conversations WHERE id LIKE 'solved%' OR id='open-waiting'"))[0].n,4,'the imported history itself is untouched')
  // A second run changes nothing.
  const once=await survivors()
  await apply320()
  assert.deepEqual(await survivors(),once);assert.deepEqual(await work(),repaired)
 }finally{await rm(scratch,{recursive:true,force:true})}
}
