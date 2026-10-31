import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {legacyBundle} from '../legacy-bundle.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
import {findDatabase,snapshot,snapshotTable,bucketSnapshot} from '../upgrade-snapshot.mjs'
import {createRuntime} from '../emitted-runtime.mjs'
import {client} from '../../journeys/kit/http.mjs'

const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
// Real commands and emitted HTTP routes do all product writes. SQLite is only an
// independent readback oracle, plus auth fixtures and a storage-outage trigger.
export async function legacyCustodyJourney(){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-custody-')),base=join(scratch,'base')
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const options={databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name}
 let runtime
 try{
  runtime=await createRuntime({...options,persist:base});await runtime.close(true);runtime=undefined
  const {bundle,media,date}=await legacyBundle()
  bundle.tables.contacts[0].name='Custody Customer';bundle.tables.contacts[0].email='custody@example.test'
  for(const [id,role] of [['admin','ADMIN'],['agent','AGENT']]){
   bundle.tables.users.push({id,name:id,email:id+'@example.test',created_at:date})
   bundle.tables.project_users.push({id:'member-'+id,project_id:'p',user_id:id,role})
  }
  const amounts=[['decimal-small','0.29',29],['decimal-negative','-1.01',-101],['decimal-large','90071992547409.91',9007199254740991]]
  for(const [id,amount] of amounts)bundle.tables.charges.push({id,project_id:'p',amount,currency:'usd',created_at:date})
  bundle.tables.charges.push({id:'pending-charge',project_id:'p',amount_minor:29,status:'pending',currency:'usd',created_at:date})
  bundle.tables.ai_usages=[{id:'precise-cost',project_id:'p',cost:'0.000000000000000123',created_at:date}]
  const root=join(scratch,'package'),{bundle:exported}=await writeLegacyPackage(root,bundle,{rowsPerChunk:1})
  const file=join(scratch,'export.json');await writeFile(file,JSON.stringify(bundle))
  const networkLog=join(scratch,'network.jsonl');await writeFile(networkLog,'')
  const command=async(persist,{fail,inline=false}={})=>{
   try{
    const {stdout}=await exec(process.execPath,['--import',resolve('tests/helpers/legacy/network-edge.mjs'),'scripts/import-legacy.mjs',...(inline?['--file',file]:['--package',root]),'--apply','--persist-to',persist],{
     env:{...process.env,H2H_LEGACY_NETWORK_LOG:networkLog,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'},timeout:180000,maxBuffer:4*1024*1024})
    assert.equal(fail,undefined,'the guarded command must refuse this input');return JSON.parse(stdout)
   }catch(error){if(!fail)throw error;assert.match(error.stderr||'',fail);return error}
   finally{assert.equal(await readFile(networkLog,'utf8'),'','no external network attempt, even if caught by the importer')}
  }
  const state=join(scratch,'resumed'),clean=join(scratch,'clean'),conflict=join(scratch,'conflict')
  for(const persist of [state,clean,conflict])await cp(base,persist,{recursive:true})
  const database=async persist=>findDatabase(join(persist,'v3/d1'))
  const sql=async(persist,query,write=false)=>{
   const db=new DatabaseSync(await database(persist),{readOnly:!write})
   try{return write?db.exec(query):db.prepare(query).all().map(row=>({...row}))}finally{db.close()}
  }
  const business=async persist=>{
   const all=snapshot(await database(persist))
   return Object.fromEntries(Object.entries(all).filter(([table])=>!table.startsWith('legacy_import_')&&!table.startsWith('sqlite_')&&!table.startsWith('_cf_')))
  }
  // An accepted monetary row may never be rounded to a different minor unit.
  const unsafe=structuredClone(bundle)
  unsafe.tables.charges.push({id:'unsafe-minor',project_id:'p',amount_minor:'9007199254740993',currency:'usd',created_at:date})
  const untouched=await business(conflict),untouchedObjects=await bucketSnapshot(join(conflict,'v3/r2'))
  await writeFile(file,JSON.stringify(unsafe))
  await command(conflict,{inline:true,fail:/Currency minor amount exceeds exact safe range/})
  assert.deepEqual(await business(conflict),untouched);assert.deepEqual(await bucketSnapshot(join(conflict,'v3/r2')),untouchedObjects)
  await writeFile(file,JSON.stringify(bundle))
  const fresh=await command(clean)
  // A late financial conflict must be discovered before any canonical or R2 write.
  const seed=async(table,row)=>sql(conflict,`INSERT INTO ${table}(${Object.keys(row).map(key=>'"'+key+'"').join(',')}) VALUES(${Object.values(row).map(value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'").join(',')})`,true)
  await seed('projects',(await sql(clean,"SELECT * FROM projects WHERE id='p'"))[0])
  await seed('billing_ledger',{...(await sql(clean,"SELECT * FROM billing_ledger WHERE id='decimal-small'"))[0],amount_minor:30})
  const before=await business(conflict),objectsBefore=await bucketSnapshot(join(conflict,'v3/r2'))
  await command(conflict,{fail:/Existing data conflict billing_ledger:decimal-small column amount_minor; no rows overwritten/})
  assert.deepEqual(await business(conflict),before,'conflict leaves every business table unchanged')
  assert.deepEqual(await bucketSnapshot(join(conflict,'v3/r2')),objectsBefore,'conflict leaves no attachment partially applied')
  assert.deepEqual(await sql(conflict,'SELECT * FROM legacy_import_rows'),[])
  await command(conflict,{inline:true,fail:/Existing data conflict billing_ledger:decimal-small column amount_minor; no rows overwritten/})
  assert.deepEqual(await business(conflict),before,'single-file conflicts also apply nothing')
  assert.deepEqual(await bucketSnapshot(join(conflict,'v3/r2')),objectsBefore)

  // Fail a real D1 transaction after earlier chunks have durably committed.
  await sql(state,"CREATE TRIGGER custody_outage BEFORE INSERT ON legacy_import_rows WHEN NEW.source_id='m2' BEGIN SELECT RAISE(ABORT,'synthetic custody interruption'); END",true)
  await command(state,{fail:/synthetic custody interruption/})
  const partial=await sql(state,'SELECT source_table,source_id,row_digest FROM legacy_import_rows ORDER BY source_table,source_id')
  assert.ok(partial.length>0);assert.equal(partial.some(row=>row.source_id==='m2'),false)
  await sql(state,'DROP TRIGGER custody_outage',true)
  const resumed=await command(state)
  assert.ok(resumed.replayed>0);assert.ok(resumed.applied>0)
  assert.equal(resumed.applied+resumed.replayed,fresh.applied)
  assert.equal(fresh.applied,Object.values(exported.tables).reduce((n,rows)=>n+rows.length,0))
  const resumedState=await business(state),freshState=await business(clean)
  const targets=new Set((await sql(state,"SELECT DISTINCT target_table FROM legacy_import_rows WHERE target_table IS NOT NULL")).flatMap(row=>row.target_table.split(',')))
  // Independent installs mint their own native article incarnation, audit/outbox
  // IDs and default-rule timestamps. The imported business columns must agree;
  // every table's cardinality agrees, and same-install repeat below is byte-exact.
  const imported=async(persist,table)=>{
   const db=new DatabaseSync(await database(persist),{readOnly:true})
   try{return snapshotTable(db,table,resumedState[table].columns.filter(column=>column!=='source_incarnation'))}finally{db.close()}
  }
  for(const table of targets)assert.deepEqual(await imported(state,table),await imported(clean,table),table+' converges exactly')
  assert.deepEqual(Object.fromEntries(Object.entries(resumedState).map(([table,data])=>[table,data.rowCount])),Object.fromEntries(Object.entries(freshState).map(([table,data])=>[table,data.rowCount])))
  const complete=await business(state),journal=await sql(state,'SELECT source_table,source_id,row_digest FROM legacy_import_rows ORDER BY source_table,source_id')
  for(const row of partial)assert.ok(journal.some(next=>JSON.stringify(next)===JSON.stringify(row)))
  assert.equal(journal.length,fresh.applied,'one journal row per source row')
  const repeated=await command(state)
  assert.equal(repeated.applied,0);assert.equal(repeated.replayed,fresh.applied)
  assert.deepEqual(await business(state),complete,'repeat duplicates no canonical row')

  // Identity, permissions, decimal strings, safe integer minor units and media hash.
  assert.deepEqual(await sql(state,'SELECT user_id,role FROM memberships ORDER BY user_id'),[{user_id:'admin',role:'admin'},{user_id:'agent',role:'operator'},{user_id:'u',role:'owner'}])
  for(const [id,amount,minor] of amounts){
   assert.deepEqual(await sql(state,`SELECT amount_minor,currency FROM billing_ledger WHERE id='${id}'`),[{amount_minor:minor,currency:'usd'}])
   const archived=await sql(state,`SELECT source_json FROM legacy_import_rows WHERE source_table='charges' AND source_id='${id}'`)
   assert.equal(JSON.parse(archived[0].source_json).amount,amount,'exact decimal spelling retained')
  }
  assert.equal((await sql(state,"SELECT cost_decimal FROM billing_usage_history WHERE id='precise-cost'"))[0].cost_decimal,'0.000000000000000123')
  const financial=await sql(state,'SELECT * FROM billing_ledger ORDER BY id'),holds=await sql(state,'SELECT source_table,source_id,reason FROM legacy_import_holds ORDER BY source_table,source_id')
  for(const [table,id] of [['charges','pending-charge'],['local_agent_grants','grant'],['local_agent_devices','device'],['support_delegations','job'],['support_delegations','job-queued']])assert.ok(holds.some(row=>row.source_table===table&&row.source_id===id),table+':'+id)
  assert.deepEqual(await sql(state,"SELECT state FROM billing_operations WHERE id='pending-charge'"),[{state:'uncertain'}])
  assert.deepEqual(await sql(state,'SELECT token_hash,revoked_at IS NOT NULL revoked FROM local_grants'),[{token_hash:null,revoked:1}])
  assert.equal((await sql(state,'SELECT count(*) n FROM credentials'))[0].n,0)
  assert.equal((await sql(state,'SELECT count(*) n FROM sessions'))[0].n,0)
  assert.equal((await sql(state,"SELECT count(*) n FROM knowledge_documents WHERE content LIKE '%DRAFT MUST NOT LEAK%' OR content LIKE '%UNPUBLISHED REFRESH CANDIDATE%'"))[0].n,0)
  assert.deepEqual(await sql(state,"SELECT id,status FROM knowledge_articles WHERE id='article'"),[{id:'article',status:'published'}])
  // Historical money has only archive tables: no balance/payment authority appears.
  assert.deepEqual(await sql(state,"SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%payment%' OR name LIKE '%balance%')"),[])
  assert.deepEqual(await sql(state,"SELECT object_key,sha256 FROM legacy_import_objects ORDER BY object_key"),[{object_key:'legacy/file',sha256:sha(media)}])
  const token='synthetic-custody-owner',hash=sha(token)
  await sql(state,`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES('${hash}','u','p','owner',${Date.now()+3600000}); INSERT INTO session_factors VALUES('${hash}','u','password',${Date.now()});`,true)
  runtime=await createRuntime({...options,persist:state})
  const {call,request}=client(runtime.origin)
  const transcript=(await call('/api/conversations/conv/messages',{token,status:200})).data
  assert.deepEqual(transcript.messages.map(row=>[row.id,row.content]),[['m1','Prior message'],['m2','Prior answer']])
  const download=await request('/api/conversations/conv/media/file',{token})
  assert.equal(download.status,200);assert.equal(sha(Buffer.from(await download.arrayBuffer())),sha(media))
  assert.equal((await call('/api/identity/login',{body:{email:'import@example.com',password:'synthetic-retained-only-legacy-hash'}})).status,401)
  const erased=await call('/api/management/projects/p/contacts/c/erase',{token,body:{},status:200})
  assert.equal(erased.data.data.runs,1)
  assert.equal((await request('/api/conversations/conv/media/file',{token})).status,404)
  await runtime.close(true);runtime=undefined
  const erasedJournal=await sql(state,'SELECT source_table,source_id,row_digest,source_json FROM legacy_import_rows ORDER BY source_table,source_id')
  const personal=new Set(['contacts','conversations','buckets','messages','media','notes','conversation_participants','context_subjects','context_profiles','ai_generations','support_delegations','support_delegation_events'])
  const redacted=erasedJournal.filter(row=>personal.has(row.source_table))
  assert.equal(redacted.length,Object.entries(exported.tables).filter(([table])=>personal.has(table)).reduce((n,[,rows])=>n+rows.length,0));assert.ok(redacted.length>=10)
  for(const row of redacted)assert.equal(row.source_json,'{}',row.source_table+':'+row.source_id)
  assert.deepEqual(erasedJournal.map(({source_json,...row})=>row),journal,'all row digests remain')
  const tombstone=await sql(state,'SELECT * FROM contact_erasures')
  assert.equal(tombstone.length,1);assert.equal(tombstone[0].contact_id,'c');assert.equal(tombstone[0].erased_by,'u')
  assert.equal(/Custody Customer|custody@example|Prior message|Prior answer|Private note/.test(JSON.stringify(tombstone)),false)
  assert.deepEqual(await sql(state,"SELECT name,email,external_id FROM contacts WHERE id='c'"),[{name:null,email:null,external_id:null}])
  assert.ok((await sql(state,'SELECT content FROM messages')).every(row=>row.content===''))
  assert.deepEqual(await sql(state,'SELECT metadata_json FROM conversation_buckets'),[{metadata_json:'{}'}])
  for(const table of ['media','conversation_notes','context_profiles'])assert.deepEqual(await sql(state,'SELECT * FROM '+table),[])
  const erasedState=await business(state),erasedObjects=await bucketSnapshot(join(state,'v3/r2'))
  assert.deepEqual(erasedObjects.objects,[])
  const replay=await command(state)
  assert.equal(replay.applied,0);assert.equal(replay.replayed,fresh.applied)
  assert.deepEqual(await business(state),erasedState,'replay restores no native personal row')
  assert.deepEqual(await sql(state,'SELECT source_table,source_id,row_digest,source_json FROM legacy_import_rows ORDER BY source_table,source_id'),erasedJournal,'replay restores no verbatim archive copy')
  assert.deepEqual(await sql(state,'SELECT * FROM contact_erasures'),tombstone,'one opaque tombstone remains')
  assert.deepEqual(await bucketSnapshot(join(state,'v3/r2')),erasedObjects,'replay restores no erased attachment')
  assert.deepEqual(await sql(state,'SELECT * FROM billing_ledger ORDER BY id'),financial,'erasure and replay leave historical money immutable')
  assert.deepEqual(await sql(state,'SELECT source_table,source_id,reason FROM legacy_import_holds ORDER BY source_table,source_id'),holds)

  // The other documented door has its own object-upload path and journal ID.
  const inline=join(scratch,'inline');await cp(base,inline,{recursive:true})
  const inlineApplied=await command(inline,{inline:true})
  const inlineHolds=await sql(inline,'SELECT source_table,source_id FROM legacy_import_holds')
  for(const [table,id] of [['ai_generations','gen'],['ai_attempts','attempt'],['training_runs','run'],['training_cases','case'],['billing_operations','bill-op']])assert.ok(inlineHolds.some(row=>row.source_table===table&&row.source_id===id),table+':'+id)
  assert.deepEqual(await sql(inline,"SELECT state FROM billing_operations WHERE id='bill-op'"),[{state:'uncertain'}])
  assert.equal((await sql(inline,'SELECT count(*) n FROM credentials'))[0].n,0)
  const inlineDigests=await sql(inline,'SELECT source_table,source_id,row_digest FROM legacy_import_rows ORDER BY source_table,source_id')
  await sql(inline,`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES('${hash}','u','p','owner',${Date.now()+3600000}); INSERT INTO session_factors VALUES('${hash}','u','password',${Date.now()});`,true)
  runtime=await createRuntime({...options,persist:inline})
  const inlineClient=client(runtime.origin)
  assert.equal((await inlineClient.call('/api/identity/login',{body:{email:'import@example.com',password:'synthetic-retained-only-legacy-hash'}})).status,401)
  assert.equal((await inlineClient.call('/api/management/projects/p/contacts/c/erase',{token,body:{},status:200})).data.data.runs,1)
  await runtime.close(true);runtime=undefined
  const inlineErased=await business(inline),inlineArchive=await sql(inline,'SELECT source_table,source_id,row_digest,source_json FROM legacy_import_rows ORDER BY source_table,source_id'),inlineObjects=await bucketSnapshot(join(inline,'v3/r2'))
  for(const row of inlineArchive.filter(row=>personal.has(row.source_table)))assert.equal(row.source_json,'{}',row.source_table+':'+row.source_id)
  assert.deepEqual(inlineArchive.map(({source_json,...row})=>row),inlineDigests)
  const inlineReplay=await command(inline,{inline:true})
  assert.equal(inlineReplay.applied,0);assert.equal(inlineReplay.replayed,inlineApplied.applied)
  assert.deepEqual(await business(inline),inlineErased,'single-file replay restores no personal row or extra tombstone')
  assert.deepEqual(await sql(inline,'SELECT source_table,source_id,row_digest,source_json FROM legacy_import_rows ORDER BY source_table,source_id'),inlineArchive)
  assert.deepEqual(await bucketSnapshot(join(inline,'v3/r2')),inlineObjects,'single-file replay restores no attachment')
 }finally{if(runtime)await runtime.close(true);await rm(scratch,{recursive:true,force:true})}
}
