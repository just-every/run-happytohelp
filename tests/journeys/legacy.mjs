import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {artifactRuntime} from '../helpers/independent-artifact.mjs'
import {readArtifact} from '../helpers/artifact-payloads.mjs'
import {legacyBundle} from '../helpers/legacy-bundle.mjs'

// The owner's import command, followed by the shipped Worker's real read and
// erasure doors. No importer implementation is called by this journey.
test('a legacy owner imports, replays, reads retained history and money, then erases a customer without resurrecting them', {timeout:240000}, async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-command-'))
 const {bundle,media}=await legacyBundle(),file=join(scratch,'support.json')
 const runtime=await artifactRuntime(await readArtifact('delivery-artifact/happytohelp-worker-artifact.json'),{directory:join(scratch,'install'),start:false,port:12631})
 const execute=promisify(execFile),script=resolve('scripts/import-legacy.mjs')
 const invoke=async(input,args=[])=>JSON.parse((await execute(process.execPath,[script,'--file',input,...args],{cwd:runtime.directory,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,CI:'1',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},timeout:120000})).stdout)
 const apply=input=>invoke(input,['--apply','--persist-to',join(runtime.directory,'.wrangler/state')])
 const inspect=sql=>runtime.withStorage(async store=>(await store.inspect({sql})).results)
 const token='synthetic-legacy-owner'
 const call=(path,options={})=>fetch(runtime.origin+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}})
 try{
  await writeFile(file,JSON.stringify(bundle))
  const plan=await invoke(file);assert.ok(plan.id)
  assert.deepEqual(await inspect('SELECT id FROM projects'),[],'planning stores no customer data')
  const first=await apply(file),again=await apply(file)
  assert.ok(first.applied>0);assert.equal(again.applied,0);assert.equal(again.replayed,first.applied)
  const changed=structuredClone(bundle);changed.tables.messages[1].content='Changed historical source'
  const conflict=join(scratch,'conflict.json');await writeFile(conflict,JSON.stringify(changed))
  await assert.rejects(apply(conflict),/Existing data conflict/)
  const broken=structuredClone(bundle);broken.objects[0].sha256='0'.repeat(64)
  const corrupt=join(scratch,'corrupt.json');await writeFile(corrupt,JSON.stringify(broken))
  await assert.rejects(apply(corrupt),/digest mismatch/)
  // Imported financial and interrupted work is retained history, never live authority.
  assert.equal((await inspect("SELECT amount_minor FROM billing_ledger WHERE id='charge'"))[0].amount_minor,bundle.tables.charges[0].amount_minor)
  for(const [table,column,id] of [['billing_operations','state','bill-op'],['ai_generations','state','gen'],['training_runs','status','run']])assert.equal((await inspect(`SELECT ${column} AS state FROM ${table} WHERE id='${id}'`))[0].state,'uncertain')
  assert.equal((await inspect("SELECT status FROM local_jobs WHERE id='job'"))[0].status,'revoked')
  const hash=createHash('sha256').update(token).digest('hex')
  await runtime.withStorage(async store=>{
   await store.inspect({sql:"INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'u','p','owner',?)",values:[hash,Date.now()+3600000]})
   await store.inspect({sql:"INSERT INTO session_factors VALUES(?,'u','password',?)",values:[hash,Date.now()]})
  })
  await runtime.start()
  assert.equal((await call('/api/identity/login',{method:'POST',body:JSON.stringify({email:'import@example.com',password:'synthetic-retained-only-legacy-hash'})})).status,401)
  const response=await call('/api/conversations/conv/messages');assert.equal(response.status,200)
  const transcript=await response.json();assert.deepEqual(transcript.messages.map(row=>[row.id,row.content]),bundle.tables.messages.map(row=>[row.id,row.content]))
  const attachment=transcript.messages[0].media[0],download=await call(`/api/conversations/conv/media/${attachment.id}`)
  assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),media)
  const knowledge=await call('/api/knowledge/p/articles');assert.equal(knowledge.status,200)
  assert.ok((await knowledge.json()).some(row=>row.id==='article'&&row.status==='published'))
  const erased=await call('/api/management/projects/p/contacts/c/erase',{method:'POST',body:'{}'})
  assert.equal(erased.status,200,await erased.clone().text())
  assert.equal((await call(`/api/conversations/conv/media/${attachment.id}`)).status,404)
  await runtime.close()
  const tombstone=await inspect("SELECT * FROM contacts WHERE id='c'")
  assert.equal(tombstone.length,1);assert.equal(tombstone[0].name,null);assert.equal(tombstone[0].email,null);assert.equal(JSON.parse(tombstone[0].metadata_json).is_erased,1)
  await apply(file)
  assert.deepEqual(await inspect("SELECT * FROM contacts WHERE id='c'"),tombstone,'replaying an old export cannot restore erased customer fields')
  assert.ok((await inspect("SELECT source_json FROM legacy_import_rows WHERE source_table='contacts' AND source_id='c'")).every(row=>!row.source_json.includes('Customer')))
 }finally{await runtime.close();await rm(scratch,{recursive:true,force:true})}
})
