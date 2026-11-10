import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {legacyCustodyJourney} from '../helpers/legacy/custody.mjs'
import {legacyImportRepairJourney} from '../helpers/legacy/repair.mjs'
import {legacyBundle} from '../helpers/legacy-bundle.mjs'
import {writeLegacyPackage} from '../helpers/legacy-package.mjs'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {client} from './kit/http.mjs'
import {legacyMarker,legacySql} from '../helpers/cutover/oracle.mjs'
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
  // Imported knowledge is indexed by the command, so the first workspace request does no index rebuild.
  assert.ok(applied.knowledgeIndex.sources>0);assert.equal(applied.knowledgeIndex.pending,0);assert.deepEqual(repeat.knowledgeIndex,{sources:0,pending:0})
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
  // The Cutover page's legacy count and last sweep (migration 318's derived sets) equal the journal recomputed after the real import.
  const sweep=(await call('/api/move-in/projects/p/cutover',{token,status:200})).data.data.sources.find(source=>source.id==='legacy').counts
  const recomputed=await runtime.execute(`SELECT 'cutover-oracle:'||imported||':'||coalesce(swept,'') v FROM (${legacySql.replaceAll('?1',"'p'").replaceAll('?2',`'${legacyMarker}'`)})`)
  const [,imported,swept]=/cutover-oracle:(\d+):(\d*)/.exec(recomputed)
  assert.ok(Number(imported)>0&&swept,'the import journaled its conversations and completed')
  assert.deepEqual(sweep,{imported:Number(imported),lastSweep:{at:new Date(Number(swept)).toISOString()}})
  assert.ok(inbox.some(row=>row.id==='conv'))
  const state=await runtime.execute("SELECT state FROM ai_generations WHERE id='gen'; SELECT status FROM training_runs WHERE id='run'; SELECT state FROM billing_operations WHERE id='bill-op'; SELECT status FROM local_jobs WHERE id='job'; SELECT amount_minor FROM billing_ledger WHERE id='charge';")
  assert.match(state,/uncertain/);assert.match(state,/revoked/);assert.match(state,/123/)
  // The imported owner opens the workspace and creates another one.
  assert.equal((await call('/api/management/bootstrap?projectId=p',{token,status:200})).data.project.id,'p')
  assert.equal((await call('/api/management/projects',{token,status:201,body:{name:'Imported owner email',allowed_origin:'https://widget.example'}})).data.name,'Imported owner email')
  const articles=await call('/api/knowledge/p/articles',{token,status:200})
  assert.ok(articles.data.some(article=>article.id==='article'))
  assert.equal((await call('/api/identity/setup')).data.available,false)
 }finally{if(runtime)await runtime.close(true);await rm(scratch,{recursive:true,force:true})}
 await legacyCustodyJourney()
})

// A full import is history, not the team's work queue (hh-import-fidelity-1): it leaves no trigger-written work rows and no
// published auto-close rule, its authorless messages are the workspace speaking, and its conversations open read.
test('a full legacy import leaves the work counts unchanged and the default rule a draft, authorless texts are system, history opens read; each can be opted back in',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-history-')),persist=join(scratch,'state'),optIn=join(scratch,'opt-in')
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const options={persist,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name}
 let runtime
 const command=async(script,args)=>JSON.parse((await exec(process.execPath,[script,...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},timeout:120000,maxBuffer:2*1024*1024})).stdout)
 const work=state=>command('scripts/legacy-import/check.mjs',['work','--persist-to',state])
 const rule=async(call,token)=>(await call('/api/dashboard/projects/p/workflow-rules',{token,status:200})).data.rules.find(row=>row.name==='Close solved tickets after 4 days')
 const owner=async(rt)=>{const token='synthetic-history-owner';await rt.execute(`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES('${createHash('sha256').update(token).digest('hex')}','u','p','owner',${Date.now()+3600000});`);return token}
 try{
  runtime=await createRuntime(options);await runtime.close(true);runtime=undefined
  await cp(persist,optIn,{recursive:true})
  // Two members, a solved conversation with a visitor message and an automatic away text, and an open one a visitor is waiting in.
  const {bundle}=await legacyBundle(),date='2026-01-01T00:00:00.000Z',t=bundle.tables
  t.users.push({id:'u2',name:'Second member',email:'second@example.com',created_at:date});t.project_users.push({id:'membership2',project_id:'p',user_id:'u2',role:'agent'})
  t.conversations.push({id:'solved-away',project_id:'p',contact_id:'c',created_at:date,resolved_at:date},{id:'open-waiting',project_id:'p',contact_id:'c',created_at:date})
  t.messages.push({id:'away-visitor',project_id:'p',conversation_id:'solved-away',contact_id:'c',content:'Hello',created_at:date,local_id:'away-1'},{id:'away-text',project_id:'p',conversation_id:'solved-away',content:'We are away',created_at:date,local_id:'away-2'},
   {id:'waiting-visitor',project_id:'p',conversation_id:'open-waiting',contact_id:'c',content:'Anyone there?',created_at:date,local_id:'waiting-1'},{id:'waiting-human',project_id:'p',conversation_id:'open-waiting',agent_id:'u',content:'Looking',created_at:date,local_id:'waiting-2'},{id:'waiting-visitor-2',project_id:'p',conversation_id:'open-waiting',contact_id:'c',content:'Thanks',created_at:date,local_id:'waiting-3'})
  const file=join(scratch,'export.json');await writeFile(file,JSON.stringify(bundle))
  const baseline=await work(persist);delete baseline.at
  await command('scripts/import-legacy.mjs',['--file',file,'--apply','--persist-to',persist])
  await command('scripts/import-legacy.mjs',['--file',file,'--apply','--persist-to',optIn,'--leave-unread','--publish-default-rules'])
  // F1: the import's own triggers added integration events and workflow journal rows (contacts, solved conversations, a published article); none remain.
  const after=await work(persist);delete after.at
  assert.deepEqual(after,baseline,'a full import leaves every check work count unchanged')
  assert.deepEqual(await work(optIn).then(row=>row.native_integration_events+row.workflow_events),0,'the opted-in import leaves no work rows either')
  runtime=await createRuntime(options)
  let {call}=client(runtime.origin),token=await owner(runtime)
  // F4: history opens read for every member, the waiting conversation included.
  assert.equal((await call('/api/dashboard/projects/p/conversations/counts',{token,status:200})).data.data.unread,0)
  assert.match(await runtime.execute("SELECT count(*) unread FROM inbox_unread"),/"unread": 0/)
  // F2: the authorless text is the workspace speaking, not an operator; authorship is written where it is known.
  const messages=await runtime.execute("SELECT m.id,m.actor_role,a.kind FROM messages m LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.id IN ('away-visitor','away-text','waiting-human') ORDER BY m.id")
  for(const [id,role,kind] of [['away-text','system','unknown'],['away-visitor','contact','visitor'],['waiting-human','operator','human']])assert.match(messages.replace(/\s+/g,' '),new RegExp(`"id": "${id}", "actor_role": "${role}", "kind": "${kind}"`))
  // Imported visitors are history, not a visitor waiting for the team.
  assert.match(await runtime.execute("SELECT count(*) waiting FROM inbox_visitor_waiting"),/"waiting": 0/)
  // F1: the default rule is a draft, so no scheduler run closes the imported solved conversations; the owner publishes it when they choose.
  const draft=await rule(call,token);assert.equal(draft.state,'draft');assert.equal(draft.version,0)
  assert.equal((await call(`/api/dashboard/projects/p/workflow-rules/${draft.id}/publish`,{token,status:200,body:{}})).data.rule.state,'published')
  await runtime.close(true)
  // The switches: history left unread, and the default rule published, as a new workspace has it.
  runtime=await createRuntime({...options,persist:optIn});({call}=client(runtime.origin));token=await owner(runtime)
  assert.ok((await call('/api/dashboard/projects/p/conversations/counts',{token,status:200})).data.data.unread>0,'--leave-unread leaves the imported conversations unread')
  assert.equal((await rule(call,token)).state,'published','--publish-default-rules keeps the default rule published')
 }finally{if(runtime)await runtime.close(true);await rm(scratch,{recursive:true,force:true})}
})

// An installation imported before the fidelity round keeps the import's trigger-written work rows; migration 320 removes exactly those
// (by the import's journal and run windows) and leaves what the team did afterwards, and a second run changes nothing.
test('migration 320 removes the work rows a pre-fidelity full import left and keeps the native activity after it',legacyImportRepairJourney)
