import assert from 'node:assert/strict'
import {doorFixture,packageFixture} from './door-fixture.mjs'
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export async function legacyPrivacyProof({h,project,email,plan,fixture,call,ok,upload,transfer,apply}){
 const management=`/api/management/projects/${project}`
 const fresh=await ok('plan',{uploadId:plan.uploadId});await apply(fresh)
 await h.call(management+'/contacts/legacy-contact',{...json({name:'A native correction'}),method:'PUT'})
 await h.contactSession('visitor',project,'legacy-contact');assert.doesNotMatch(JSON.stringify(await h.call('/api/conversations/legacy-conversation/messages',{actor:'visitor'})),/private historical note/)
 const before=await h.snapshot(),conflict=await call('undo',{planId:fresh.planId});assert.equal(conflict.response.status,409)
 assert.deepEqual((await h.snapshot()).messages,before.messages,'strict Undo conflicts before reversing any effect')
 const next=await transfer(doorFixture(email,{update:true,mutate:tables=>{tables.contacts[0].name='A later source correction'}}),{},false),preview=await ok('plan',{uploadId:next.uploadId,catchup:true});assert.ok(preview.differences.conflicts.length>0)
 await ok('cancel',{planId:preview.planId})
 const r2=await h.files,legacyKey=(await h.db.prepare("SELECT object_key FROM media WHERE id='legacy-media'").first()).object_key;await r2.put(legacyKey,'Preserved R2 bytes');await h.db.prepare("DELETE FROM legacy_door_blob_chunks WHERE media_id='legacy-media' AND ordinal=0").run();assert.equal((await h.download('/api/conversations/legacy-conversation/media/legacy-media')).status,404,'missing D1 custody never falls through to R2')
 const prepared=packageFixture(fixture);for(const bytes of prepared.segments)await upload(bytes,'rer-segment',{namespace:'zendesk'})
 const other=(await h.call('/api/management/projects',json({name:'Foreign custody',allowedOrigin:'https://foreign-custody.example.test'}))).id
 // Fixture-only prior custody of another installation/destination, using exact
 // transport bytes. Native HTTP erasure must leave this foreign scope intact.
 await h.db.batch([h.db.prepare("INSERT INTO ik_door_scopes VALUES('foreign-installation','happytohelp-legacy',?)").bind(other),h.db.prepare("INSERT INTO ik_door_uploads SELECT 'foreign-'||id,'foreign-installation','happytohelp-legacy',name,bundle_sha256,total_bytes,total_chunks,intake_json FROM ik_door_uploads WHERE namespace='zendesk'"),h.db.prepare("INSERT INTO ik_door_chunks SELECT 'foreign-'||c.upload_id,c.ordinal,c.sha256,c.size,c.base64 FROM ik_door_chunks c JOIN ik_door_uploads u ON u.id=c.upload_id WHERE u.namespace='zendesk'")])
 const foreign=(await h.db.prepare("SELECT COUNT(*) n FROM ik_door_chunks c JOIN ik_door_uploads u ON u.id=c.upload_id WHERE u.installation_id='foreign-installation'").first()).n
 const erased=await h.raw(management+'/contacts/legacy-contact/erase',json({}));assert.ok(erased.response.ok,JSON.stringify({status:erased.response.status,data:erased.data,limits:erased.response.headers.get('X-Test-Limits')}))
 assert.equal((await h.download('/api/conversations/legacy-conversation/media/legacy-media')).status,404);assert.equal(await (await r2.get(legacyKey)).text(),'Preserved R2 bytes')
 assert.doesNotMatch(JSON.stringify(await h.call('/api/conversations/legacy-conversation/messages')),/retained historical message|original answer|private historical note/)
 assert.equal((await h.call(management+'/contacts/legacy-peer')).data.name,'Preserved peer')
 assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM ik_door_chunks c JOIN ik_door_uploads u ON u.id=c.upload_id WHERE u.namespace='happytohelp-legacy' AND u.installation_id='legacy-test-installation'").first()).n,0,'all equivalent authorized transport copies are erased')
 assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM ik_door_chunks c JOIN ik_door_uploads u ON u.id=c.upload_id WHERE u.installation_id='foreign-installation'").first()).n,foreign)
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM legacy_door_blob_chunks').first()).n,0)
 assert.equal((await call('reconcile',{planId:fresh.planId})).response.status,410)
 const retained=await h.snapshot();assert.doesNotMatch(JSON.stringify(retained),/historical@example\.test|A retained historical message|A private historical note/)
 // Upload-time privacy admission catches the original and corrected upload,
 // even before Plan and even after the manifest fingerprint has changed.
 for(const correction of [false,true]){const value=doorFixture(email,{large:false,mutate:tables=>{if(correction){tables.contacts[0].email='corrected@example.test';tables.messages[0].content='Corrected replacement'}}}),pkg=packageFixture(value);await upload(pkg.manifestBytes,'rer-package.json');await assert.rejects(async()=>{for(const bytes of pkg.segments)await upload(bytes,'rer-segment')},/source_erased/)}
 // A complete, unapplied package also participates in native erasure. Its
 // source ID is aliased to an independently created native customer's email.
 const pending=doorFixture(email,{large:false,mutate:tables=>{for(const rows of Object.values(tables))for(const row of rows)for(const key of Object.keys(row))if(typeof row[key]==='string'&&row[key].startsWith('legacy-')&&row[key]!=='legacy-project'&&row[key]!=='legacy-owner')row[key]=row[key].replace(/^legacy-/,'pending-');tables.contacts[0].email='pending-customer@example.test'}})
 const native=(await h.call(management+'/contacts',json({name:'Pending customer',email:'pending-customer@example.test'}))).data
 const waiting=await transfer(pending,{},false);await h.call(management+'/contacts/'+native.id+'/erase',json({}))
 assert.equal((await call('plan',{uploadId:waiting.uploadId})).response.status,404,'unapplied package bytes are removed')
 const corrected=doorFixture(email,{large:false,mutate:tables=>{for(const [table,rows] of Object.entries(tables))tables[table]=structuredClone(pending.tables[table]);tables.contacts[0].email='new-pending-address@example.test'}}),retry=packageFixture(corrected);await upload(retry.manifestBytes,'rer-package.json');await assert.rejects(async()=>{for(const bytes of retry.segments)await upload(bytes,'rer-segment')},/source_erased/)
 assert.equal((await h.call(management+'/contacts/legacy-peer')).data.name,'Preserved peer')
}
