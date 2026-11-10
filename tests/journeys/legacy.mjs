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
import {mediaWidgetBundle,asImportedBefore,rewrittenState} from '../helpers/legacy/media-widget.mjs'
import {findDatabase} from '../helpers/upgrade-snapshot.mjs'
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

// K19: imported legacy media resolves to native files under native access rules, and the imported widget looks and
// behaves as the legacy one did; a workspace imported before this change gets the same through the upgrade command.
test('imported storage URLs serve their files to who may read them, the widget keeps its legacy look, team and hours, and the upgrade command brings an earlier import to the same rows',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-legacy-media-')),persist=join(scratch,'state'),root=join(scratch,'package'),deltaRoot=join(scratch,'delta')
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 const options={persist,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name}
 const command=async(script,args)=>JSON.parse((await exec(process.execPath,[script,...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},timeout:120000,maxBuffer:2*1024*1024})).stdout)
 const session=async(rt,token,values)=>rt.execute(`INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES('${createHash('sha256').update(token).digest('hex')}',${values.map(v=>v===null?'NULL':`'${v}'`).join(',')},${Date.now()+3600000});`)
 let runtime
 try{
  runtime=await createRuntime(options);await runtime.close(true);runtime=undefined
  const {bundle,bytes}=await mediaWidgetBundle()
  await writeLegacyPackage(root,bundle,{rowsPerChunk:4})
  const apply=['scripts/import-legacy.mjs','--package',root,'--apply','--persist-to',persist]
  const imported=await command(apply[0],apply.slice(1))
  // The message's own file and the carried images are rewritten; the URL whose file the export did not carry is left and counted.
  assert.ok(imported.mediaUrls.rewritten>=6);assert.equal(imported.mediaUrls.left,1)
  assert.equal(imported.widgetNotReproduced['settings.show_glow.on_ai_typing'],1,'a glow only legacy shows is listed')
  const database=await findDatabase(join(persist,'v3/d1')),fresh=rewrittenState(database)
  const replay=await command(apply[0],apply.slice(1));assert.equal(replay.applied,0);assert.deepEqual(rewrittenState(database),fresh,'a replay changes nothing')
  const earlierState=join(scratch,'earlier');await cp(persist,earlierState,{recursive:true})

  runtime=await createRuntime(options)
  const {call,request}=client(runtime.origin)
  await session(runtime,'media-owner',['u','p','owner',null]);await session(runtime,'media-contact',['c','p','contact','c']);await session(runtime,'media-stranger',['c2','p','contact','c2'])
  const transcript=(await call('/api/conversations/conv/messages',{token:'media-owner',status:200})).data.messages
  const link=transcript.find(m=>m.id==='m-link').content,native='/api/conversations/conv/media/shot'
  assert.equal(link,'Thanks, I can see /api/conversations/conv/media/shot and not https://storage.happytohelp.com/p/conv/gone.png yet.','only the native URL takes the carried file\'s storage URL\'s place; the URL whose file is not carried is kept as written')
  for(const token of ['media-owner','media-contact']){const file=await request(native,{token});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes.shot)}
  assert.equal((await request(native,{token:'media-stranger'})).status,404,'another contact never gets the file');assert.equal((await request(native)).status,401)
  // A published article's image is read with the article, by anyone; a draft's only by the workspace's members.
  const article=(await call('/api/knowledge/public/p/articles/guide',{status:200})).data,image=/\((\/api\/imported-files\/p\/art-img)\)/.exec(article.content)?.[1]
  assert.ok(image);const served=await request(image);assert.equal(served.status,200);assert.deepEqual(Buffer.from(await served.arrayBuffer()),bytes['art-img'])
  assert.equal((await request('/api/imported-files/p/draft-img')).status,404);assert.equal((await request('/api/imported-files/p/draft-img',{token:'media-stranger'})).status,404);assert.equal((await request('/api/imported-files/p/draft-img',{token:'media-owner'})).status,200)
  // The widget on the customer's site: the logo is an absolute URL anyone loads, the team is the workspace, the colours are legacy's and the team is available.
  const widget=(await call('/api/widget/settings?widgetKey=p',{headers:{Origin:'https://widget.example'},status:200})).data
  assert.match(widget.brand.logo_url,/^https?:\/\/[^/]+\/api\/imported-files\/p\/logo-xl$/)
  const logo=await request(new URL(widget.brand.logo_url).pathname);assert.equal(logo.status,200);assert.deepEqual(Buffer.from(await logo.arrayBuffer()),bytes['logo-xl'])
  assert.equal(widget.currentAgent.id,null);assert.equal(widget.currentAgent.name,'Imported project Team');assert.equal(widget.currentAgent.avatar_url,widget.brand.logo_url)
  assert.equal(widget.brand.color,'#d01c1c','the dashboard keeps its colour');assert.equal(widget.settings.theme.button.closed.background,'#484748');assert.equal(widget.settings.theme.input.send.background,'#484748')
  assert.equal(widget.settings.theme.button.open.color,'#cecece');assert.equal(widget.settings.theme.chat.user.background,'#5046e5');assert.equal(widget.settings.text.message.placeholder_message,'Ask the imported team')
  assert.equal(widget.availability.available,true,'a disabled legacy schedule is available with nobody online')
  assert.match(widget.agents.find(agent=>agent.id==='u').avatar_url,/^https?:\/\/[^/]+\/api\/imported-files\/p\/u-avatar$/);assert.equal(widget.ais[0].avatar_url,'https://cdn.happytohelp.com/img/avatars/male-1.png')
  const schedule=(await call('/api/management/projects/p/settings',{token:'media-owner',status:200})).data.data.availability_schedule
  assert.deepEqual(schedule.days,[1,2,3,4,5]);await call('/api/management/projects/p/availability',{token:'media-owner',status:200,body:{is_availability_schedule_enabled:true,availability_schedule:schedule},method:'PUT'})
  await runtime.close(true);runtime=undefined

  // A workspace the importer before this change wrote, whose settings the seed has not changed: the upgrade command gives
  // it exactly what a fresh import writes, once, and a replay of the original package or a later delta then reads it as imported.
  const earlier=await findDatabase(join(earlierState,'v3/d1'))
  await asImportedBefore(earlier,bundle);assert.notDeepEqual(rewrittenState(earlier),fresh)
  const upgrade=state=>command('scripts/legacy-import/upgrade.mjs',['--project','p','--persist-to',state])
  const first=await upgrade(earlierState)
  assert.equal(first.settingsTranslated,1);assert.equal(first.mediaUrls.left,1);assert.ok(first.filesAdded>=4)
  assert.deepEqual(rewrittenState(earlier),fresh,'the upgraded workspace holds what a fresh import writes, import state included')
  const again=await upgrade(earlierState)
  assert.deepEqual(Object.values(again.rowsRewritten),[0,0,0,0,0]);assert.equal(again.filesAdded,0);assert.deepEqual(rewrittenState(earlier),fresh,'a second upgrade changes nothing')
  const replayed=await command(apply[0],[...apply.slice(1,-1),earlierState]);assert.equal(replayed.applied,0);assert.deepEqual(rewrittenState(earlier),fresh,'replaying the original package changes nothing')
  // A later delta's legacy title edit applies to the article the seed has not changed, and its image keeps the native URL.
  const edited={...bundle.tables.articles[0],title:'Guide, revised',updated_at:'2026-02-02T00:00:00.000Z'}
  await writeLegacyPackage(deltaRoot,{...bundle,tables:{...bundle.tables,articles:[edited,...bundle.tables.articles.slice(1)]}},{delta:{since:'2026-02-01T00:00:00.000Z',tables:{articles:[edited]}}})
  const delta=await command('scripts/import-legacy.mjs',['--package',deltaRoot,'--apply','--persist-to',earlierState])
  assert.equal(delta.updated,1);assert.equal(delta.mediaUrls.left,0)
  const revised=rewrittenState(earlier).articles.find(a=>a.id==='article');assert.equal(revised.title,'Guide, revised');assert.equal(revised.content,fresh.articles.find(a=>a.id==='article').content)
  // Where the seed changed the settings since import (the availability save above), the translation leaves them and
  // says so; the logo's URL is still rewritten, and every other row is what a fresh import writes.
  const reset=rewrittenState(database);await asImportedBefore(database,bundle)
  const left=await upgrade(persist)
  assert.equal(left.settingsLeft,1);assert.equal(left.settingsTranslated,0)
  const upgraded=rewrittenState(database),others=state=>({...state,settings:undefined,state:state.state.filter(row=>row.target_table!=='project_settings')})
  assert.deepEqual(others(upgraded),others(reset));assert.match(upgraded.settings[0].settings_json,/"logo_url":"\/api\/imported-files\/p\/logo-xl"/);assert.doesNotMatch(upgraded.settings[0].settings_json,/widget_team_display/)
 }finally{if(runtime)await runtime.close(true);await rm(scratch,{recursive:true,force:true})}
})
