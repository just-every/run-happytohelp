import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {legacyCustodyJourney} from '../helpers/legacy/custody.mjs'
import {legacyBundle} from '../helpers/legacy-bundle.mjs'
import {writeLegacyPackage} from '../helpers/legacy-package.mjs'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {client} from './kit/http.mjs'
const exec=promisify(execFile)

// A migration operator uses the documented command, then the native application.
test('a legacy package is reviewed, imported and replayed through its command; the native owner reads retained transcripts, files and knowledge while old execution authority stays inert',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-command-')),persist=join(scratch,'state')
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const options={persist,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name}
 let runtime
 try{
  runtime=await createRuntime(options);await runtime.close(true);runtime=undefined
  const {bundle,media}=await legacyBundle(),root=join(scratch,'package'),file=join(scratch,'export.json')
  await writeFile(file,JSON.stringify(bundle))
  await writeLegacyPackage(root,bundle,{rowsPerChunk:3})
  const command=async(args,ok=true)=>{
   const run=()=>exec(process.execPath,['scripts/import-legacy.mjs',...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},timeout:120000,maxBuffer:2*1024*1024})
   if(!ok){await assert.rejects(run);return}
   return JSON.parse((await run()).stdout)
  }
  const plan=await command(['--file',file]);assert.ok(plan)
  const args=['--file',file,'--apply','--persist-to',persist]
  const applied=await command(args),repeat=await command(args)
  assert.ok(applied.applied>0);assert.equal(repeat.applied,0);assert.equal(repeat.replayed,applied.applied)
  const damaged=join(scratch,'damaged');await cp(root,damaged,{recursive:true})
  const chunk=join(damaged,'rows-000000.json')
  await writeFile(chunk,(await readFile(chunk,'utf8'))+' ')
  await command(['--package',damaged,'--apply','--persist-to',persist],false)
  runtime=await createRuntime(options)
  const {call,request}=client(runtime.origin)
  assert.equal((await call('/api/identity/login',{body:{email:'import@example.com',password:'synthetic-retained-only-legacy-hash'}})).status,401)
  const token='synthetic-legacy-owner',hash=createHash('sha256').update(token).digest('hex')
  await runtime.execute(`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES('${hash}','u','p','owner',${Date.now()+3600000});`)
  const transcript=(await call('/api/conversations/conv/messages',{token,status:200})).data
  assert.deepEqual(transcript.messages.map(m=>[m.id,m.content]),[['m1','Prior message'],['m2','Prior answer']])
  const attachment=transcript.messages[0].media[0],download=await request(`/api/conversations/conv/media/${attachment.id}`,{token})
  assert.equal(download.status,200);assert.equal(await download.text(),media.toString())
  const inbox=(await call('/api/dashboard/projects/p/conversations?view=all',{token,status:200})).data.data
  assert.ok(inbox.some(row=>row.id==='conv'))
  const state=await runtime.execute("SELECT state FROM ai_generations WHERE id='gen'; SELECT status FROM training_runs WHERE id='run'; SELECT state FROM billing_operations WHERE id='bill-op'; SELECT status FROM local_jobs WHERE id='job'; SELECT amount_minor FROM billing_ledger WHERE id='charge';")
  assert.match(state,/uncertain/);assert.match(state,/revoked/);assert.match(state,/123/)
  const articles=await call('/api/knowledge/p/articles',{token,status:200})
  assert.ok(articles.data.some(article=>article.id==='article'))
  assert.equal((await call('/api/identity/setup')).data.available,false)
 }finally{if(runtime)await runtime.close(true);await rm(scratch,{recursive:true,force:true})}
 await legacyCustodyJourney()
})
