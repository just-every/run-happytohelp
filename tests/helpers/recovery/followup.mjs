import assert from 'node:assert/strict'
import {unstable_splitSqlQuery} from 'wrangler'
import {finishArchiveRestore} from '../../../scripts/installer/archive-restore.mjs'
import {createPortability} from '@runeditrun/rer/modules/portability'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'
import {startApp,applyMigrations,sha} from '../../journeys/kit/app.mjs'

export async function followupRecoveryJourney() {
 const finish=app=>finishArchiveRestore((_label,sql)=>app.db.batch(unstable_splitSqlQuery(sql).map(statement=>app.db.prepare(statement))))
 const source=await startApp({captureQueue:true,migrate:name=>name<'260_'});let destination,legacyDestination,refused
 try {
  const workspace=await source.seedWorkspace('followup-upgrade'),p=workspace.projectId,token=workspace.tokens.owner
  const visitor=(await source.call('/api/identity/widget/session',{headers:{Origin:workspace.allowedOrigin},body:{widgetKey:workspace.widgetKey},status:201})).data
  const conversation=(await source.call('/api/conversations',{token:visitor.token,body:{projectId:p},status:201})).data
  const sent=(await source.call(`/api/conversations/${conversation.id}/messages`,{token,body:{localId:'synthetic-hh-followup-upgrade',content:'I will follow up tomorrow.',expectedRevision:0},status:200})).data.message
  await applyMigrations(source.db,name=>name>='260_')
  const base=`/api/ai-support/projects/${p}/conversations/${conversation.id}/obligations`,terms={ownerId:workspace.users.owner,dueAt:Date.now()+3600000}
  const privateStop='Call Léa at lea.private@example.test about her medical leave'
  const privateSubject='Léa medical leave follow-up'
  await source.call(`/api/dashboard/projects/${p}/conversations/${conversation.id}`,{token,method:'PUT',body:{subject:privateSubject},status:200})
  const created=(await source.call(base,{token,body:{...terms,messageId:sent.id,quote:'follow up tomorrow',stopCondition:privateStop},status:201})).data
  await source.call(base+'/'+created.id+'/accept',{token,body:{...terms,version:1},status:200})
  await source.call(base,{token,body:{...terms,ownerId:workspace.users.admin,dueAt:terms.dueAt+60000,messageId:sent.id,quote:'follow up tomorrow',stopCondition:privateStop+' reviewed'},status:200})
  const before=(await source.call(base,{token,status:200})).data.obligations[0]
  assert.equal(before.quote,'follow up tomorrow','additive upgrade preserves the prior message and its quote')
  const portable=async app=>createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy})
  const transfer=await portable(source),id=await transfer.exports.create();let state
  do {state=await transfer.exports.advance(id,{maxParts:100})}while(state.phase!=='complete')
  const records=(await new Response(await transfer.exports.download(id)).text()).trim().split('\n').map(JSON.parse),parts=records.filter(r=>r.kind==='part')
  const exportedObligation=parts.flatMap(part=>part.items).find(item=>item.kind==='row'&&item.table==='followup_obligations').row
  assert.equal(exportedObligation.stop_condition,'','export irreversibly removes private stop-condition text')
  assert.ok(!JSON.stringify(records).includes(privateStop),'the complete archive contains no copy of the private stop condition')
  assert.equal((await source.call(base,{token,status:200})).data.obligations[0].stop_condition,privateStop,'export does not erase the live promise')
  destination=await startApp({captureQueue:true})
  const restore=await portable(destination),importId=await restore.imports.create(records[0])
  for(const part of parts)await restore.imports.uploadPart(importId,part.index,part)
  const closing=records.at(-1)
  assert.equal((await restore.imports.finalize(importId,{archiveHash:closing.archiveHash,contentHash:closing.contentHash})).phase,'complete')
  await finish(destination)
  assert.equal((await destination.call(base,{token})).status,401,'archive carries no live session')
  const fresh='synthetic-hh-restored-followup-session',now=Date.now()
  await destination.db.batch([
   destination.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'owner',?)").bind(sha(fresh),workspace.users.owner,p,now+3600000),
   destination.db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(sha(fresh),workspace.users.owner,now)
  ])
  const after=(await destination.call(base,{token:fresh,status:200})).data.obligations[0]
  const safePending={ownerId:workspace.users.admin,dueAt:terms.dueAt+60000,dependencyId:null,stopCondition:''}
  assert.deepEqual(after.pendingTerms,safePending,'restore retains pending responsibility and due time while redacting personal text')
  assert.deepEqual(after,{...before,stop_condition:'',pending_terms_json:JSON.stringify(safePending),pendingTerms:safePending,changes:before.changes.map(change=>({...change,stop_condition:null}))},'restore retains the same citation, accepted responsibility, due time and history')
  await destination.call(base+'/'+created.id+'/accept',{token:fresh,body:{...terms,version:after.version,stopCondition:'Customer receives the restored update'},status:200})
  assert.equal((await destination.call(base,{token:fresh,status:200})).data.obligations[0].stop_condition,'Customer receives the restored update','restored stop conditions can be re-entered and retained')
  assert.equal((await destination.first('SELECT count(*) n FROM messages')).n,1,'restoring a draft never sends')
  await destination.scheduled();await destination.scheduled()
  assert.equal((await destination.first("SELECT count(*) n FROM notification_inbox WHERE id=?",`followup:${created.id}:4`)).n,1)
  // Produce the old exporter format through the same archive door. Its valid
  // digests bind raw personal text, so the receiving policy must erase it.
  const legacy=await createPortability({db:source.db,buckets:{FILES:await source.files},policy:{...archivePolicy,exportRow:(table,row)=>table==='followup_obligations'?row:archivePolicy.exportRow(table,row)}})
  const legacyId=await legacy.exports.create()
  do {state=await legacy.exports.advance(legacyId,{maxParts:100})}while(state.phase!=='complete')
  const legacyRecords=(await new Response(await legacy.exports.download(legacyId)).text()).trim().split('\n').map(JSON.parse)
  assert.ok(JSON.stringify(legacyRecords).includes(privateStop),'the older archive actually carries the private text')
  legacyDestination=await startApp({captureQueue:true})
  const legacyRestore=await portable(legacyDestination),legacyImport=await legacyRestore.imports.create(legacyRecords[0])
  for(const part of legacyRecords.filter(r=>r.kind==='part'))await legacyRestore.imports.uploadPart(legacyImport,part.index,part)
  await legacyRestore.imports.finalize(legacyImport,{archiveHash:legacyRecords.at(-1).archiveHash,contentHash:legacyRecords.at(-1).contentHash})
  await finish(legacyDestination)
  assert.equal((await legacyDestination.first('SELECT stop_condition FROM followup_obligations WHERE id=?',created.id)).stop_condition,'','restore removes private text from an older valid archive')
  await legacyDestination.db.batch([
   legacyDestination.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'owner',?)").bind(sha(fresh),workspace.users.owner,p,now+3600000),
   legacyDestination.db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(sha(fresh),workspace.users.owner,now)
  ])
  await legacyDestination.call(`/api/management/projects/${p}/contacts/${conversation.contact_id}/erase`,{token:fresh,body:{},status:200})
  assert.equal((await legacyDestination.first('SELECT subject FROM conversations WHERE id=?',conversation.id)).subject,'','customer erasure clears the ticket subject')
  assert.equal((await legacyDestination.first('SELECT count(*) n FROM followup_obligations')).n,0)
  assert.equal((await legacyDestination.first('SELECT count(*) n FROM followup_changes')).n,0)
  const erased=await legacyRestore.exports.create()
  do {state=await legacyRestore.exports.advance(erased,{maxParts:100})}while(state.phase!=='complete')
  const erasedArchive=await new Response(await legacyRestore.exports.download(erased)).text()
  assert.ok(!erasedArchive.includes(privateStop)&&!erasedArchive.includes(privateSubject),'an erased ticket exports neither private field')

  // An archive cannot transplant a citation into a different tenant. Refusal
  // occurs before the staged business rows become visible.
  const other=await source.seedWorkspace('followup-foreign')
  await source.db.prepare('UPDATE followup_obligations SET project_id=? WHERE id=?').bind(other.projectId,created.id).run()
  const badId=await transfer.exports.create()
  do {state=await transfer.exports.advance(badId,{maxParts:100})}while(state.phase!=='complete')
  const bad=(await new Response(await transfer.exports.download(badId)).text()).trim().split('\n').map(JSON.parse)
  refused=await startApp({captureQueue:true})
  const rejected=await portable(refused),rejectedId=await rejected.imports.create(bad[0])
  for(const part of bad.filter(r=>r.kind==='part'))await rejected.imports.uploadPart(rejectedId,part.index,part)
  await assert.rejects(()=>rejected.imports.finalize(rejectedId,{archiveHash:bad.at(-1).archiveHash,contentHash:bad.at(-1).contentHash}),/invalid cited relationship/)
  assert.equal((await refused.first('SELECT count(*) n FROM projects')).n,0,'invalid custody restores no tenant data')
 } finally {await refused?.close();await legacyDestination?.close();await destination?.close();await source.close()}
}
