import assert from 'node:assert/strict'
import {createPortability} from '@runeditrun/rer/modules/portability'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'
import {managedInstallation} from './rer-mail.mjs'
import {mime} from './rer-edge.mjs'
import {startApp} from '../../journeys/kit/app.mjs'

async function portable(app){
 return createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy})
}
export async function rerMailArchiveJourney(){
 const i=await managedInstallation('archive'),{app,owner,assigned}=i
 let destination
 try{
  const incoming=await i.ingress(mime({id:'synthetic-portable-mail'})),conversationId=incoming.data.conversationId
  const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',conversationId)
  const upload=await app.ok(`/api/conversations/${conversationId}/media`,{token:owner.token,raw:true,body:Buffer.from('Portable attachment bytes'),headers:{'Content-Type':'text/plain','X-Filename':'portable.txt'}})
  const reply=await app.ok(`/api/conversations/${conversationId}/messages`,{token:owner.token,body:{localId:'synthetic-portable-reply',content:'Your retained answer',expectedRevision:head.revision,expectedLastMessageId:head.last_message_id,mediaIds:[upload.id]}});await app.scheduled()
  const outgoing=i.edge.sends.find(row=>row.payload.text.includes('Your retained answer')).payload
  await i.ingress(mime({id:'synthetic-portable-followup',headers:`In-Reply-To: ${[...i.edge.ledger.values()].at(-1).messageId}\r\n`}),{deliveryId:'synthetic-portable-followup',envelopeTo:outgoing.replyTo,verdict:'unproven'})
  const originalGrant=(await app.first('SELECT token_hash FROM email_reply_grants LIMIT 1')).token_hash
  const transfer=await portable(app),id=await transfer.exports.create();let status
  do{status=await transfer.exports.advance(id,{maxParts:100})}while(status.phase!=='complete')
  const bytes=await new Response(await transfer.exports.download(id)).text(),records=bytes.trim().split('\n').map(line=>JSON.parse(line)),manifest=records[0],parts=records.filter(row=>row.kind==='part'),rows=parts.flatMap(part=>part.items).filter(row=>row.kind==='row')
  assert.ok(rows.some(row=>row.table==='messages'&&row.row.content==='Your retained answer'))
  assert.ok(rows.some(row=>row.table==='email_threading_keys'&&row.row.key_value.includes('@mail.example.test>')))
  assert.ok(rows.some(row=>row.table==='rer_mailboxes'&&row.row.address===assigned.RER_MAIL_ADDRESS&&row.row.state==='revoked'&&!row.row.route_active))
  assert.ok(rows.some(row=>row.table==='email_deliveries'&&row.row.provider_id?.includes('@mail.example.test>')))
  assert.ok(manifest.excludedTables.includes('rer_mailbox_outbox'));assert.ok(!rows.some(row=>row.table==='rer_mailbox_outbox'))
  assert.ok(!bytes.includes(assigned.MAIL_API_KEY)&&!bytes.includes(assigned.RER_MAIL_INGRESS_KEY)&&!bytes.includes(originalGrant)&&!bytes.includes(outgoing.replyTo))
  assert.ok(rows.filter(row=>row.table==='email_reply_grants').every(row=>row.row.token_hash.startsWith('archived:')))
  const objectItems=parts.flatMap(part=>part.items).filter(row=>row.kind==='object');assert.ok(objectItems.some(row=>Buffer.from(row.data,'base64').toString()==='Portable attachment bytes'))
  destination=await startApp({captureQueue:true});const restored=await portable(destination),importId=await restored.imports.create(manifest)
  for(const part of parts)await restored.imports.uploadPart(importId,part.index,part)
  const closing=records.at(-1);const result=await restored.imports.finalize(importId,{archiveHash:closing.archiveHash,contentHash:closing.contentHash});assert.equal(result.phase,'complete')
  assert.equal((await destination.first('SELECT count(*) n FROM rer_mailbox_outbox')).n,0)
  assert.equal((await destination.first('SELECT count(*) n FROM rer_mailboxes WHERE route_active<>0 OR configured<>0 OR state<>?', 'revoked')).n,0)
  assert.equal((await destination.first("SELECT count(*) n FROM email_reply_grants WHERE token_hash NOT LIKE 'archived:%'")).n,0)
  assert.equal((await destination.first('SELECT content FROM messages WHERE id=?',reply.message.id)).content,'Your retained answer')
  // New private MIME stores participate in native contact erasure and keep the
  // delivery tombstone, so an old signed retry cannot resurrect erased content.
  const contact=await app.first('SELECT contact_id FROM conversations WHERE id=?',conversationId),rawKeys=(await app.sql('SELECT object_key FROM rer_mail_raw_objects')).map(row=>row.object_key)
  await app.ok(`/api/management/projects/${owner.projectId}/contacts/${contact.contact_id}/erase`,{token:owner.token,body:{}})
  for(const key of rawKeys)assert.equal(await (await app.files).get(key),null)
  assert.equal((await i.ingress(mime({id:'synthetic-portable-mail'}))).data.state,'erased')
  assert.equal((await app.first('SELECT count(*) n FROM rer_mail_raw_objects')).n,0)
 }finally{await destination?.close();await i.close()}
}
