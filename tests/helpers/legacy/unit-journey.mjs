import '../legacy-bundle.mjs'
import assert from 'node:assert/strict'
import {doorFixture} from './door-fixture.mjs'
import {prepareLegacyUnits,compileLegacyUnits} from '../../../src/modules/legacy-import/door/units.ts'
import {legacyUnitDependencies} from '../../../src/modules/legacy-import/door/unit-dependencies.ts'
import {decodeLegacy} from '../../../src/modules/legacy-import/door/format.ts'
import {prepareLegacy,recordKey} from '../../../src/modules/legacy-import/door/bridge.ts'
import {packageUpload} from '../../../src/modules/import-kit/src/door/package.ts'
import {uploadRow} from '../../../src/modules/import-kit/src/door/uploads.ts'

const limits={maxBytes:16*1024*1024,maxRecords:100000,maxRecordBytes:1024*1024}
export function unitFixture(email,options={}){
 return doorFixture(email,{...options,mutate(tables){
  const first=tables.conversations[0]
  tables.conversations.push({...first,id:'legacy-second-conversation'})
  tables.messages.push({...tables.messages[0],id:'legacy-second-message',conversation_id:'legacy-second-conversation',local_id:'second-delivery'})
  tables.article_categories=[{id:'legacy-article-category',article_id:'legacy-article',category_id:'legacy-category'}]
  tables.legacy_archive??=[{id:'archive-only',project_id:first.project_id,description:'Retained historical custody'}]
  tables.contacts.push({id:'legacy-deleted',project_id:first.project_id,name:'Deleted historical contact',created_at:first.created_at,deleted_at:first.created_at})
  options.mutate?.(tables)
 }})
}
export async function legacyUnitJourney({h,project,ownerId,email,installation,uploadId,fixture,transfer}){
 const request={options:{database:h.db,limits,package:{formats:['happytohelp-legacy-chunks-v1'],maxBytes:limits.maxBytes,maxSegments:8}},access:{installationId:installation,namespace:'happytohelp-legacy',maxBytes:2*1024*1024,maxChunks:32,maxRecords:limits.maxRecords}}
 const open=async id=>packageUpload(request,await uploadRow(request,id)),upload=await open(uploadId),before=await h.snapshot(),outbound=h.outbound,queued=h.queued.length
 const first=await prepareLegacyUnits(h.db,upload,project,ownerId,limits),repeat=await prepareLegacyUnits(h.db,upload,project,ownerId,limits)
 assert.deepEqual(repeat,first,'pure preparation repeats exact membership, dependencies, byte totals and fingerprints')
 assert.deepEqual(await h.snapshot(),before,'decoder, native preparation and compiler produce no database effects or success receipt')
 const unitFor=(compiled,kind,id)=>compiled.units.find(entry=>entry.unit.records.some(record=>record.kind===kind&&record.sourceId===id))
 const contact=unitFor(first,'contacts','legacy-contact'),conversation=unitFor(first,'conversations','legacy-conversation'),second=unitFor(first,'conversations','legacy-second-conversation'),article=unitFor(first,'articles','legacy-article')
 assert.notEqual(conversation.unit.id,second.unit.id);assert.ok(conversation.unit.dependsOn.includes(contact.unit.id));assert.ok(second.unit.dependsOn.includes(contact.unit.id))
 for(const [kind,id] of [['messages','legacy-message'],['messages','legacy-answer'],['media','legacy-media'],['mediables','join'],['legacy-object','legacy-media']])assert.equal(unitFor(first,kind,id).unit.id,conversation.unit.id)
 assert.equal(unitFor(first,'article_categories','legacy-article-category').unit.id,article.unit.id)
 assert.ok(article.native.some(row=>row.table==='knowledge_article_publications'))
 assert.equal(first.totals.source,fixture.sourceCount)
 const identities=first.units.flatMap(entry=>entry.unit.records.map(record=>recordKey(record.kind,record.sourceId))),native=first.units.flatMap(entry=>entry.native),files=first.units.flatMap(entry=>entry.unit.files),aliases=first.units.flatMap(entry=>entry.unit.aliases)
 assert.equal(new Set(identities).size,first.totals.source);assert.equal(new Set(native.map(row=>recordKey(row.table,row.key))).size,native.length)
 assert.equal(new Set(files.map(file=>file.path)).size,upload.files.length);assert.equal(files.length,upload.files.length)
 assert.equal(new Set(aliases.map(row=>recordKey(row.kind,row.sourceId))).size,aliases.length)
 assert.ok(aliases.some(alias=>alias.role==='context'));assert.ok(aliases.some(alias=>alias.role==='archive'&&alias.sourceId==='legacy-deleted'));assert.ok(aliases.some(alias=>alias.role==='metadata'))
 assert.equal(first.totals.storedBytes,upload.files.reduce((n,file)=>n+file.bytes,0));assert.equal(first.totals.logicalBytes,first.totals.storedBytes)
 assert.equal(first.totals.contextBytes,fixture.manifest.context.reduce((n,part)=>n+part.bytes,0));assert.equal(first.totals.blobBytes,fixture.bytes.length)
 assert.equal(native.filter(row=>row.table==='legacy_door_blob_chunks').length,Math.max(1,Math.ceil(fixture.bytes.length/65536)))
 assert.equal(native.filter(row=>row.table==='legacy_door_targets').length,native.length/2)
 assert.equal(first.totals.nativeBytes,native.reduce((n,row)=>n+row.storedBytes,0))
 const seen=new Set();for(const {unit} of first.units){assert.ok(unit.dependsOn.every(id=>seen.has(id)));seen.add(unit.id)}
 const decoded=await decodeLegacy(upload,limits.maxRecords),prepared=await prepareLegacy(h.db,decoded,project,ownerId,limits.maxRecords),dependencies=await legacyUnitDependencies(h.db,prepared,decoded,project,ownerId)
 assert.throws(()=>compileLegacyUnits(prepared,decoded,dependencies,upload.files,{...limits,maxRecords:2}),error=>error.code==='legacy_indivisible_unit_exceeds_limit')
 assert.throws(()=>compileLegacyUnits(prepared,decoded,{...dependencies,edges:[...dependencies.edges,{from:identities[0],to:'foreign-primary',atomic:false,evidence:{}}]},upload.files,limits),error=>error.code==='legacy_work_unit_unsupported')
 const a=recordKey('contacts','legacy-contact'),b=recordKey('contacts','legacy-peer')
 assert.throws(()=>compileLegacyUnits(prepared,decoded,{...dependencies,edges:[...dependencies.edges,{from:a,to:b,atomic:false,evidence:{}},{from:b,to:a,atomic:false,evidence:{}}]},upload.files,limits),error=>error.code==='legacy_work_unit_unsupported')
 assert.deepEqual(await h.snapshot(),before)
 const changed=unitFixture(email,{mutate:tables=>{tables.conversations.find(row=>row.id==='legacy-second-conversation').contact_id='legacy-peer'}}),changedUpload=await transfer(changed,{},false),afterTransfer=await h.snapshot(),relation=await prepareLegacyUnits(h.db,await open(changedUpload.uploadId),project,ownerId,limits)
 assert.notEqual(unitFor(relation,'conversations','legacy-second-conversation').unit.relationshipsHash,second.unit.relationshipsHash);assert.notDeepEqual(unitFor(relation,'conversations','legacy-second-conversation').unit.dependsOn,second.unit.dependsOn)
 assert.deepEqual(unitFor(relation,'contacts','legacy-peer').native,unitFor(first,'contacts','legacy-peer').native)
 assert.deepEqual(await h.snapshot(),afterTransfer)
 const changedBytes=Buffer.from(fixture.bytes);changedBytes[0]^=1
 const bytesFixture=unitFixture(email,{objectBytes:changedBytes}),byteUpload=await transfer(bytesFixture,{},false),beforeBytes=await h.snapshot(),bytes=await prepareLegacyUnits(h.db,await open(byteUpload.uploadId),project,ownerId,limits)
 assert.equal(unitFor(bytes,'legacy-object','legacy-media').unit.id,conversation.unit.id)
 assert.notEqual(unitFor(bytes,'legacy-object','legacy-media').projectionHash,conversation.projectionHash);assert.notEqual(unitFor(bytes,'legacy-object','legacy-media').fingerprint,conversation.fingerprint)
 assert.deepEqual(await h.snapshot(),beforeBytes)
 for(const mutate of [tables=>{tables.conversations[0].contact_id='missing-contact'},tables=>{tables.messages[0].project_id='foreign-project'}]){
  const bad=unitFixture(email,{large:false,mutate}),id=await transfer(bad,{},false),beforeRefusal=await h.snapshot()
  const badUpload=await open(id.uploadId)
  await assert.rejects(()=>prepareLegacyUnits(h.db,badUpload,project,ownerId,limits))
  assert.deepEqual(await h.snapshot(),beforeRefusal)
 }
 assert.equal(h.outbound,outbound);assert.equal(h.queued.length,queued)
 console.log('Legacy work units POINT1/POINT2: deterministic closures/dependencies, exact physical rows/files/aliases/readable bytes, relationship/byte drift, refusal and zero preparation effects')
 return first
}
