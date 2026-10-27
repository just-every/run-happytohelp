import assert from 'node:assert/strict'
import {createPortability} from '@runeditrun/rer/modules/portability'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'
import {startApp,applyMigrations,sha} from '../../journeys/kit/app.mjs'

export async function followupRecoveryJourney() {
 const source=await startApp({captureQueue:true,migrate:name=>name<'257_'});let destination
 try {
  const workspace=await source.seedWorkspace('followup-upgrade'),p=workspace.projectId,token=workspace.tokens.owner
  const visitor=(await source.call('/api/identity/widget/session',{headers:{Origin:workspace.allowedOrigin},body:{widgetKey:workspace.widgetKey},status:201})).data
  const conversation=(await source.call('/api/conversations',{token:visitor.token,body:{projectId:p},status:201})).data
  const sent=(await source.call(`/api/conversations/${conversation.id}/messages`,{token,body:{localId:'synthetic-hh-followup-upgrade',content:'I will follow up tomorrow.',expectedRevision:0},status:200})).data.message
  await applyMigrations(source.db,name=>name.startsWith('257_'))
  const base=`/api/ai-support/projects/${p}/conversations/${conversation.id}/obligations`,terms={ownerId:workspace.users.owner,dueAt:Date.now()+3600000}
  const created=(await source.call(base,{token,body:{...terms,messageId:sent.id,quote:'follow up tomorrow',stopCondition:'Customer receives an update'},status:201})).data
  await source.call(base+'/'+created.id+'/accept',{token,body:{...terms,version:1},status:200})
  const before=(await source.call(base,{token,status:200})).data.obligations[0]
  assert.equal(before.quote,'follow up tomorrow','additive upgrade preserves the prior message and its quote')
  const portable=async app=>createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy})
  const transfer=await portable(source),id=await transfer.exports.create();let state
  do {state=await transfer.exports.advance(id,{maxParts:100})}while(state.phase!=='complete')
  const records=(await new Response(await transfer.exports.download(id)).text()).trim().split('\n').map(JSON.parse),parts=records.filter(r=>r.kind==='part')
  destination=await startApp({captureQueue:true})
  const restore=await portable(destination),importId=await restore.imports.create(records[0])
  for(const part of parts)await restore.imports.uploadPart(importId,part.index,part)
  const closing=records.at(-1)
  assert.equal((await restore.imports.finalize(importId,{archiveHash:closing.archiveHash,contentHash:closing.contentHash})).phase,'complete')
  assert.equal((await destination.call(base,{token})).status,401,'archive carries no live session')
  const fresh='synthetic-hh-restored-followup-session',now=Date.now()
  await destination.db.batch([
   destination.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'owner',?)").bind(sha(fresh),workspace.users.owner,p,now+3600000),
   destination.db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(sha(fresh),workspace.users.owner,now)
  ])
  const after=(await destination.call(base,{token:fresh,status:200})).data.obligations[0]
  assert.deepEqual(after,before,'restore retains the same citation, accepted responsibility, due time and history')
  assert.equal((await destination.first('SELECT count(*) n FROM messages')).n,1,'restoring a draft never sends')
  await destination.scheduled();await destination.scheduled()
  assert.equal((await destination.first("SELECT count(*) n FROM notification_inbox WHERE id=?",`followup:${created.id}:2`)).n,1)
 } finally {await destination?.close();await source.close()}
}
