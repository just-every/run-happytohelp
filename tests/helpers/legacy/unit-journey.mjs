import '../legacy-bundle.mjs'
import assert from 'node:assert/strict'
import {doorFixture} from './door-fixture.mjs'
import {createHash} from 'node:crypto'
const {canonicalJson}=await import('../../../src/modules/import-kit/src/provenance/identity.ts')
const {keys,quote}=await import('../../../src/modules/legacy-import/door/schema.ts')
const {prepareLegacyUnits,compileLegacyUnits}=await import('../../../src/modules/legacy-import/door/units.ts')
const {legacyUnitDependencies}=await import('../../../src/modules/legacy-import/door/unit-dependencies.ts')
const {decodeLegacy}=await import('../../../src/modules/legacy-import/door/format.ts')
const {prepareLegacy,recordKey}=await import('../../../src/modules/legacy-import/door/bridge.ts')
const {packageUpload}=await import('../../../src/modules/import-kit/src/door/package.ts')
const {uploadRow}=await import('../../../src/modules/import-kit/src/door/uploads.ts')

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
 const snapshot=async()=>{const {_cf_METADATA,...state}=await h.snapshot();return state}
 const open=async id=>packageUpload(request,await uploadRow(request,id)),upload=await open(uploadId),before=await snapshot(),outbound=h.outbound,queued=h.queued.length
 const first=await prepareLegacyUnits(h.db,upload,project,ownerId,limits),repeat=await prepareLegacyUnits(h.db,upload,project,ownerId,limits)
 assert.deepEqual(repeat,first,'pure preparation repeats exact membership, dependencies, byte totals and fingerprints')
 assert.deepEqual(await snapshot(),before,'decoder, native preparation and compiler produce no database effects or success receipt')
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
 assert.deepEqual(await snapshot(),before)
 const changed=unitFixture(email,{mutate:tables=>{tables.conversations.find(row=>row.id==='legacy-second-conversation').contact_id='legacy-peer'}}),changedUpload=await transfer(changed,{},false),afterTransfer=await snapshot(),relation=await prepareLegacyUnits(h.db,await open(changedUpload.uploadId),project,ownerId,limits)
 assert.notEqual(unitFor(relation,'conversations','legacy-second-conversation').unit.relationshipsHash,second.unit.relationshipsHash);assert.notDeepEqual(unitFor(relation,'conversations','legacy-second-conversation').unit.dependsOn,second.unit.dependsOn)
 assert.deepEqual(unitFor(relation,'contacts','legacy-peer').native,unitFor(first,'contacts','legacy-peer').native)
 assert.deepEqual(await snapshot(),afterTransfer)
 const changedBytes=Buffer.from(fixture.bytes);changedBytes[0]^=1
 const bytesFixture=unitFixture(email,{objectBytes:changedBytes}),byteUpload=await transfer(bytesFixture,{},false),beforeBytes=await snapshot(),bytes=await prepareLegacyUnits(h.db,await open(byteUpload.uploadId),project,ownerId,limits)
 assert.equal(unitFor(bytes,'legacy-object','legacy-media').unit.id,conversation.unit.id)
 assert.notEqual(unitFor(bytes,'legacy-object','legacy-media').projectionHash,conversation.projectionHash);assert.notEqual(unitFor(bytes,'legacy-object','legacy-media').fingerprint,conversation.fingerprint)
 assert.deepEqual(await snapshot(),beforeBytes)
 const missing=unitFixture(email,{large:false,mutate:tables=>{tables.conversations[0].contact_id='missing-contact'}}),missingId=await transfer(missing,{},false),beforeMissing=await snapshot(),missingUpload=await open(missingId.uploadId)
 await assert.rejects(()=>prepareLegacyUnits(h.db,missingUpload,project,ownerId,limits),error=>error.code==='legacy_native_relationship_missing')
 assert.deepEqual(await snapshot(),beforeMissing)
 const cyclic=unitFixture(email,{large:false,mutate:tables=>{tables.categories[0].parent_id='cycle-category';tables.categories.push({...tables.categories[0],id:'cycle-category',slug:'cycle-category',parent_id:'legacy-category'})}}),cycleId=await transfer(cyclic,{},false),beforeCycle=await snapshot(),cycleUpload=await open(cycleId.uploadId)
 await assert.rejects(()=>prepareLegacyUnits(h.db,cycleUpload,project,ownerId,limits),error=>error.code==='legacy_work_unit_unsupported')
 assert.deepEqual(await snapshot(),beforeCycle)
 const foreign=unitFixture(email,{large:false,mutate:tables=>{tables.messages[0].project_id='foreign-project'}})
 await assert.rejects(()=>transfer(foreign,{},false),/source_invalid_or_credential_source_data/)
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0)
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM legacy_door_blob_chunks').first()).n,0)
 assert.equal(h.outbound,outbound);assert.equal(h.queued.length,queued)
 console.log('Legacy work unit totals',JSON.stringify(first.totals))
 console.log('Legacy work units POINT1/POINT2: deterministic closures/dependencies, exact physical rows/files/aliases/readable bytes, relationship/byte drift, refusal and zero preparation effects')
 return first
}

/** Compare compiler accounting with rows written by the ordinary reviewed import,
 * including the real adapter origin rows and readable native chunks. */
export async function verifyLegacyUnitStorage(h,compiled,project){
 let nativeBytes=0,blobBytes=0,count=0
 for(const {native} of compiled.units)for(const projection of native){
  const origin=projection.table==='legacy_door_targets',names=origin?['project_id','target_id']:keys[projection.table],values=JSON.parse(origin?projection.key:decodeURIComponent(projection.key.slice(projection.key.indexOf(':')+1)))
  const row=await h.db.prepare(`SELECT * FROM ${quote(projection.table)} WHERE ${names.map(name=>`${quote(name)} IS ?`).join(' AND ')}`).bind(...values).first()
  assert.ok(row,`physical ${projection.table} row is readable`)
  const generated=(await h.db.prepare(`PRAGMA table_xinfo(${quote(projection.table)})`).all()).results.filter(column=>column.hidden).map(column=>column.name)
  for(const column of generated)delete row[column]
  let revisionBytes=0
  if(origin){revisionBytes=row.revision.length;assert.match(row.revision,/^[a-f0-9]{64}$/);row.revision=''}
  const encoded=canonicalJson(row),bytes=Buffer.byteLength(encoded)+revisionBytes
  assert.equal(createHash('sha256').update(encoded).digest('hex'),projection.valueHash)
  assert.equal(bytes,projection.storedBytes);nativeBytes+=bytes;count++
  if(projection.table==='legacy_door_blob_chunks'){const bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,projection.blobBytes);blobBytes+=bytes.length}
 }
 assert.equal(count,compiled.totals.native);assert.equal(nativeBytes,compiled.totals.nativeBytes);assert.equal(blobBytes,compiled.totals.blobBytes)
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM legacy_door_targets WHERE project_id=?').bind(project).first()).n,count/2)
 console.log('Legacy work units: real ordinary-import storage matches every compiled physical row, byte total and source-derived projection')
}
