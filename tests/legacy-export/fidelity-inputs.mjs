import {DatabaseSync} from 'node:sqlite'
import {findDatabase,bucketSnapshot} from '../helpers/upgrade-snapshot.mjs'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {writeFile,readFile,cp,access} from 'node:fs/promises'

/** Deliberate source-shape choices and malformed transports; all commands are
 * the public exporter/importer, and refusal happens before a native apply. */
export async function fidelityInputs({admin,run,env,output,projectId,snapshotArgs,file,empty}){
 const [[project]]=await admin.execute('SELECT website FROM projects WHERE id=?',[projectId])
 await admin.execute('UPDATE projects SET website=NULL WHERE id=?',[projectId])
 try{
  const missing=join(output,'missing-origin.json')
  await run('scripts/export-legacy.mjs',[...snapshotArgs,'--output',missing],env)
  await assert.rejects(run('scripts/import-legacy.mjs',['--file',missing]),/origin|website|URL/i)
 }finally{await admin.execute('UPDATE projects SET website=? WHERE id=?',[project.website,projectId])}
 const withoutModel=snapshotArgs.filter((arg,i)=>arg!=='--ai-model'&&snapshotArgs[i-1]!=='--ai-model')
 await assert.rejects(run('scripts/export-legacy.mjs',[...withoutModel,'--output',join(output,'missing-model.json')],env),/explicit --ai-model/)
 const withoutMail=snapshotArgs.filter((arg,i)=>arg!=='--mail-from-domain'&&snapshotArgs[i-1]!=='--mail-from-domain')
 await assert.rejects(run('scripts/export-legacy.mjs',[...withoutMail,'--output',join(output,'missing-mail.json')],env),/explicit --mail-from-domain/)
 const raw=JSON.parse(await readFile(file,'utf8')),reversed={...raw,tables:{...raw.tables,mediables:[...raw.tables.mediables].reverse()}}
 const reverseFile=join(output,'reversed-pivots.json');await writeFile(reverseFile,JSON.stringify(reversed))
 const original=JSON.parse(await run('scripts/import-legacy.mjs',['--file',file])),reverse=JSON.parse(await run('scripts/import-legacy.mjs',['--file',reverseFile]))
 assert.deepEqual(reverse.fieldDispositions,original.fieldDispositions,'pivot input order never changes field outcomes')
 assert.deepEqual(reverse.holds,original.holds,'pivot input order never changes privacy/link holds')
 assert.ok(original.holds.some(h=>h.includes('macros.created_by_id is unknown')),'CLI holds unknown source author rather than abort or invent account')
 assert.ok(original.holds.some(h=>h.includes('additional or deleted message association')),'every unrepresented source link is named')
 assert.ok(original.holds.some(h=>h.includes('private event/delegation association')),'private shared file is held')
 const refusedState=join(output,'refused-state');await cp(empty,refusedState,{recursive:true})
 const database=await findDatabase(join(refusedState,'v3/d1')),counts=()=>{
  const db=new DatabaseSync(database,{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all().map(({name})=>[name,db.prepare('SELECT count(*) n FROM "'+name+'"').get().n]))}finally{db.close()}
 },before=counts()
 const objects=async()=>{try{await access(join(refusedState,'v3/r2'))}catch{return {objects:[],blobs:[]}}return bucketSnapshot(join(refusedState,'v3/r2'))},beforeObjects=await objects()
 for(const [name,mutate,error] of [
  ['missing-parent',b=>{b.tables.messages[0].conversation_id='00000000-0000-4000-8000-000000000099'},/Missing legacy source parent/],
  ['category-cycle',b=>{b.tables.categories[0].parent_id=b.tables.categories[1].id;b.tables.categories[1].parent_id=b.tables.categories[0].id},/Category parent cycle/],
  ['foreign-tenant',b=>{b.tables.conversations[0].project_id='00000000-0000-4000-8000-000000000088'},/Missing legacy source parent|Cross-project/],
  ['damaged-bytes',b=>{b.objects[0].sha256='0'.repeat(64)},/Object digest mismatch/],
  ['invalid-manual-flag',b=>{b.tables.ais[0].is_enabled='not-a-boolean'},/Invalid legacy boolean/]
 ]){
  const invalid=structuredClone(raw);mutate(invalid);const path=join(output,name+'.json');await writeFile(path,JSON.stringify(invalid))
  await assert.rejects(run('scripts/import-legacy.mjs',['--file',path,'--apply','--persist-to',refusedState]),error)
  assert.deepEqual(counts(),before,name+' refusal leaves every durable table unchanged')
  assert.deepEqual(await objects(),beforeObjects,name+' refusal leaves every R2 object, index entry and blob digest unchanged')
 }
 const manual=structuredClone(raw);manual.tables.ais[0].is_enabled='false';manual.tables.ais[0].is_animated='0'
 const manualPath=join(output,'manual-flags.json');await writeFile(manualPath,JSON.stringify(manual))
 await run('scripts/import-legacy.mjs',['--file',manualPath,'--apply','--persist-to',refusedState])
 {const db=new DatabaseSync(database,{readOnly:true});try{const flags=db.prepare('SELECT is_enabled,is_animated FROM ai_profiles WHERE id=?').get(manual.tables.ais[0].id);assert.deepEqual({...flags},{is_enabled:0,is_animated:0},'manual string flags normalize consistently; ordinary SQL export remains numeric')}finally{db.close()}}
 // Source soft-deletion controls are SQL mutations, not invented native flags.
 const contactId=raw.tables.contacts[0].id
 for(const scope of ['contact','project']){
  const table=scope==='contact'?'contacts':'projects',id=scope==='contact'?contactId:projectId
  await admin.execute(`UPDATE \`${table}\` SET deleted_at=? WHERE id=?`,['2026-11-17 00:00:00',id])
  try{
   const snapshot=join(output,'deleted-'+scope+'.json'),artifact=join(output,'deleted-'+scope+'-import.json')
   await run('scripts/export-legacy.mjs',[...snapshotArgs,'--output',snapshot],env)
   const source=JSON.parse(await readFile(snapshot,'utf8'))
   // The same writer enriches and supplies all attachment bytes.
   await run('scripts/export-legacy.mjs',['attachments','--input',snapshot,'--objects-dir',join(output,'source-objects'),'--output',artifact])
   const plan=JSON.parse(await run('scripts/import-legacy.mjs',['--file',artifact]))
   for(const row of source.tables.conversations.filter(c=>scope==='project'||c.contact_id===contactId))assert.ok(plan.archivedOnly.includes('conversations:'+row.id),'deleted parent suppresses native descendants')
   if(scope==='project')for(const row of source.tables.articles)assert.ok(plan.archivedOnly.includes('articles:'+row.id))
   const state=join(output,'deleted-'+scope+'-state');await cp(empty,state,{recursive:true})
   await run('scripts/import-legacy.mjs',['--file',artifact,'--apply','--persist-to',state])
   const db=new DatabaseSync(await findDatabase(join(state,'v3/d1')),{readOnly:true})
   try{
    for(const row of source.tables.conversations.filter(c=>scope==='project'||c.contact_id===contactId)){
     assert.equal(db.prepare('SELECT count(*) n FROM conversations WHERE id=?').get(row.id).n,0)
     for(const table of ['messages','conversation_notes'])assert.equal(db.prepare('SELECT count(*) n FROM '+table+' WHERE conversation_id=?').get(row.id).n,0)
    }
    if(scope==='project')for(const table of ['projects','contacts','conversations','messages','conversation_notes','knowledge_articles','knowledge_categories','media','local_jobs','local_events'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0,'deleted project suppresses native '+table)
    else for(const table of ['context_collectors','context_insights'])assert.equal(db.prepare('SELECT count(*) n FROM '+table+' WHERE subject_id=?').get(contactId).n,0,'deleted contact suppresses context descendants')
    assert.ok(db.prepare('SELECT count(*) n FROM legacy_import_rows').get().n>0,'deleted source rows retain private custody')
   }finally{db.close()}
  }finally{await admin.execute(`UPDATE \`${table}\` SET deleted_at=NULL WHERE id=?`,[id])}
 }
 return {nullOrigin:'refused',missingModel:'refused',missingMailChoice:'refused',pivotPermutations:'identical decisions',nullMacro:'explicit CLI hold',sourcePrivacyLinks:'held',invalidApplyEffects:'every durable table and R2 object/index/blob digest unchanged',deletedParents:'SQL contact/project plans and real applies suppress native descendants while retaining private source custody'}
}
