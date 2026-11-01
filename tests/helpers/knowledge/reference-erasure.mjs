import assert from 'node:assert/strict'
import {createPortability} from '@runeditrun/rer/modules/portability'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'
import {knowledgeApp} from './app.mjs'
import {startApp} from '../../journeys/kit/app.mjs'
import {openaiStream,openaiToolCall} from '../openai-stream.mjs'
import {execFileSync} from 'node:child_process'
import {writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'

/** Owner erasure, followed by the native archive engine and documented SQL backup. */
export async function referenceErasure(){
 const k=await knowledgeApp(),{app,p,call}=k
 let destination
 try{
  await app.presenceAwayOff(p)
  const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Account recovery',audience:'selected'},status:201})).data.id
  const body='The recovery desk records the customer profile https://customer.example.test/profiles/erasure-reader inside the protected account ledger before the designated coordinator approves the next identity inspection.'
  await call(`/api/knowledge/${p}/articles`,{body:{title:'Recovery ledger',content:body,categoryIds:[category],status:'published'},status:201})
  const customers=[]
  for(const name of ['erase','retain']){
   const customer=(await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p'},headers:{Origin:'https://example.com'},status:201})).data
   const ticket=(await app.call('/api/conversations',{token:customer.token,body:{projectId:p},status:201})).data
   await app.call(`/api/conversations/${ticket.id}/messages`,{token:customer.token,body:{localId:name,content:body,expectedRevision:0},status:200})
   const blocks=await app.sql('SELECT * FROM knowledge_reply_blocks WHERE project_id=? AND author_contact_id=?',p,customer.contactId)
   assert.ok(blocks.length,'a customer copy is canonicalised with its own-word provenance')
   customers.push({...customer,blocks})
  }
  const [erased,retained]=customers,ids=erased.blocks.map(row=>row.id),fingerprints=erased.blocks.map(row=>row.fingerprint)
  // Give the generation one unrelated permitted source. Its attempted copied
  // answer is refused, and every generated copy still belongs to that attempt
  // for erasure even though it has no customer-author visibility exception.
  await call(`/api/knowledge/${p}/articles`,{body:{title:'Ordinary recovery guidance',content:'Ordinary recovery guidance is available to every customer.',status:'published'},status:201})
  let turn=0
  k.provider=()=>++turn===1?openaiToolCall('search_knowledge',{query:'Ordinary recovery guidance'},'erasure-public'):openaiStream(body)
  await app.configure({OPENAI_API_KEY:'erasure-model-network-fixture'})
  const assistant=(await call(`/api/management/projects/${p}/ais`,{body:{name:'Recovery assistant',role:'support',prompt:'Help with recovery using read-only knowledge.',model:'gpt-5.6-luna',is_enabled:true},status:201})).data.data
  const ticket=(await app.first('SELECT id FROM conversations WHERE project_id=? AND contact_id=?',p,erased.contactId)).id
  await call(`/api/dashboard/projects/${p}/conversations/${ticket}/actions`,{body:{action:'assignAi',data:{ai_id:assistant.id}},status:200})
  await k.drain()
  const generated=await app.sql('SELECT b.* FROM knowledge_reply_blocks b JOIN ai_generations g ON g.id=b.generation_id AND g.project_id=b.project_id WHERE g.project_id=? AND g.conversation_id=?',p,ticket)
  assert.ok(generated.some(row=>row.kind==='copy'&&!row.author_contact_id),'generated copies retain generation custody without author authority: '+JSON.stringify({turn,generations:await app.sql('SELECT state FROM ai_generations WHERE project_id=? AND conversation_id=?',p,ticket),kinds:generated.map(row=>row.kind)}))
  assert.equal((await app.first('SELECT state FROM ai_generations WHERE project_id=? AND conversation_id=?',p,ticket)).state,'superseded')
  await call(`/api/management/projects/${p}/contacts/${erased.contactId}/erase`,{body:{},status:200})
  const surviving=await app.sql('SELECT * FROM knowledge_reply_blocks WHERE project_id=?',p)
  assert.ok(!surviving.some(row=>generated.some(before=>before.id===row.id||before.fingerprint===row.fingerprint)),'erasure deletes generated copies and their fingerprints too')
  assert.deepEqual(surviving.filter(row=>row.author_contact_id===retained.contactId),retained.blocks,'another customer keeps their own words and provenance')

  // Snapshot the three real D1 stores needed to inspect this erasure in the
  // documented SQL backup; other business stores are unchanged by sanitation.
  const insert=(table,row)=>'INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.values(row).map(value=>value===null?'NULL':typeof value==='number'?value:"'"+String(value).replaceAll("'","''")+"'").join(',')+');'
  const statements=[]
  for(const table of ['contacts','contact_erasures','knowledge_reply_blocks']){
   statements.push((await app.first('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?',table)).sql+';')
   statements.push(...(await app.sql('SELECT * FROM '+table)).map(row=>insert(table,row)))
  }
  // Older backups can retain pre-erasure blocks beside a current erasure fence.
  // Inspect those too without reintroducing erased data into the live database.
  const dump=statements.join('\n')
  const source=join(app.directory,'raw.sql'),backup=join(app.directory,'sanitized.sql')
  await writeFile(source,dump+'\n'+erased.blocks.filter(row=>!surviving.some(live=>live.id===row.id)).map(row=>insert('knowledge_reply_blocks',row)).join('\n'))
  execFileSync('python3',[resolve('scripts/independent/delegation-backup.py'),source,backup])
  const sanitized=await readFile(backup,'utf8')
  const backupRows=JSON.parse(execFileSync('python3',['-c',"import sqlite3,sys,json; db=sqlite3.connect(':memory:'); db.executescript(open(sys.argv[1]).read()); print(json.dumps([row[0] for row in db.execute('SELECT fingerprint FROM knowledge_reply_blocks')]))",backup],{encoding:'utf8'}))

  const transfer=await createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy}),id=await transfer.exports.create()
  let status;do{status=await transfer.exports.advance(id,{maxParts:100})}while(status.phase!=='complete')
  const bytes=await new Response(await transfer.exports.download(id)).text(),records=bytes.trim().split('\n').map(JSON.parse),parts=records.filter(row=>row.kind==='part')
  const exported=parts.flatMap(part=>part.items).filter(row=>row.kind==='row'&&row.table==='knowledge_reply_blocks').map(item=>item.row)
  destination=await startApp({captureQueue:true})
  let legacyRestore
  const restorePolicy={...archivePolicy,validateStaged:async input=>{
   // Prior exporter fixture: retain an authored row beside an erased contact's
   // metadata at the native import's existing staged-validation boundary.
   const table=input.tables.knowledge_reply_blocks
   for(const row of erased.blocks)await input.db.prepare(insert('"'+table+'"',row)).run()
   await archivePolicy.validateStaged(input)
   legacyRestore=(await input.db.prepare('SELECT fingerprint FROM "'+table+'"').all()).results.filter(row=>fingerprints.includes(row.fingerprint)).length
   return true
  }}
  const restored=await createPortability({db:destination.db,buckets:{FILES:await destination.files},policy:restorePolicy}),importId=await restored.imports.create(records[0])
  for(const part of parts)await restored.imports.uploadPart(importId,part.index,part)
  const closing=records.at(-1);assert.equal((await restored.imports.finalize(importId,{archiveHash:closing.archiveHash,contentHash:closing.contentHash})).phase,'complete')
  const restoredRows=await destination.sql('SELECT * FROM knowledge_reply_blocks WHERE project_id=?',p)
  const personal=rows=>rows.filter(row=>ids.includes(row.id)||fingerprints.includes(row.fingerprint)).length
  const observations={live:personal(surviving),backup:backupRows.filter(value=>fingerprints.includes(value)).length,export:personal(exported),restore:personal(restoredRows),legacyRestore}
  console.log(JSON.stringify({knowledgeErasure:observations,authoredBlocks:erased.blocks.length,retainedBlocks:retained.blocks.length}))
  assert.deepEqual(observations,{live:0,backup:0,export:0,restore:0,legacyRestore:0},'erasure leaves neither personal payload nor recomputable fingerprint')
  for(const fingerprint of fingerprints)assert.ok(!sanitized.includes(fingerprint))
  assert.ok(exported.some(row=>row.author_contact_id===retained.contactId),'native export preserves a live author')
  assert.ok(restoredRows.some(row=>row.author_contact_id===retained.contactId),'native restore preserves a live author')
 }finally{await destination?.close();await k.close()}
}
