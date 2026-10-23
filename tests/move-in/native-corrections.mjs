import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {unchanged} from './admission-equality.mjs';
import {nativeHarness} from './harness.mjs';
import {generate} from './generator.mjs';
const base='/api/move-in/projects/p/imports',json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const upload=(h,vendor,body,name=`${vendor}.jsonl`)=>h.call(`${base}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});
const state=async(h,run)=>(await h.call(`${base}/${run.id}`)).data;
async function apply(h,run){run=await state(h,run);await h.call(`${base}/${run.id}/apply`,json({fingerprint:run.plan.fingerprint}));await h.drain();return state(h,run)}
const rows=(vendor,count=1)=>generate(vendor,count).trim().split('\n').map(JSON.parse);
const serial=rows=>rows.map(JSON.stringify).join('\n');
test("native contact erasure fences rejected, raw and aliased source custody and changed replay",matrix(['zendesk','intercom'],async (vendor)=>{const h=await nativeHarness();try{
 const sample=rows(vendor),person=vendor==='zendesk'?sample.find(x=>x.user?.role==='end-user').user:sample.find(x=>x.type==='contact'),sid=String(person.id);
 await h.db.batch([h.db.prepare("INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES('native','p','Native person',?,'external-person',1)").bind(person.email),h.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('unrelated','p','Keep me','keep@example.test',1)")]);
 const rejected=(await upload(h,vendor,serial(sample))).data;await h.drain();assert.equal((await state(h,rejected)).plan.decisions.find(d=>d.kind===(vendor==='zendesk'?'user':'contact')&&d.sourceId===sid).rejection,'native_contact_email_conflict');
 // Unreviewed source with a distinct identity and only an external-ID match.
 const rawPerson={...person,id:vendor==='zendesk'?987:'other-source',email:'changed-private@example.test',external_id:'external-person'},raw=(await upload(h,vendor,serial([vendor==='zendesk'?{user:rawPerson}:rawPerson]))).data;
 const files=await h.files;await files.put(`move-in/p/${rejected.id}/plans/unlinked`,'private unlinked child custody');
 const unchanged=await h.db.prepare("SELECT * FROM contacts WHERE id='unrelated'").first();
 assert.equal((await h.raw('/api/management/projects/p/contacts/native/erase',{...json({}),actor:'operator'})).response.status,403);
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));assert.equal((await state(h,rejected)).state,'erased');assert.equal((await state(h,raw)).state,'erased');
 assert.equal((await files.list({prefix:'move-in/p/'})).objects.length,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_records').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_jobs').first()).n,0);assert.deepEqual(await h.db.prepare("SELECT * FROM contacts WHERE id='unrelated'").first(),unchanged);
 const tombstones=(await h.db.prepare('SELECT * FROM move_in_erased_identities').all()).results;assert.ok(tombstones.length>=4);for(const item of tombstones)assert.match(item.digest,/^[0-9a-f]{64}$/);assert.doesNotMatch(JSON.stringify(tombstones),new RegExp(person.email));
 for(const replay of [sample.map(record=>{if(vendor==='zendesk'&&record.user?.id===person.id)return {user:{...record.user,email:'new@example.test',name:'Restored'}};if(vendor==='intercom'&&record.type==='contact')return {...record,email:'new@example.test',name:'Restored'};return record}),[vendor==='zendesk'?{user:{...rawPerson,email:'again@example.test'}}:{...rawPerson,email:'again@example.test'}],sample.filter(record=>vendor==='zendesk'?!!record.ticket:record.type==='conversation')]){
  const response=await h.raw(`${base}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'replay.jsonl','X-Import-Schema':'2.16'},body:serial(replay)});assert.equal(response.response.status,410)
 }
 assert.equal((await files.list({prefix:'move-in/p/'})).objects.length,0);assert.equal((await h.db.prepare("SELECT email FROM contacts WHERE id='native'").first()).email,null);assert.equal(h.outbound,0)
 }finally{await h.close()}}));
test('native macro HTML placeholders, malformed counts and unknown envelope collections are explicit review decisions',async()=>{const h=await nativeHarness();try{
 const sample=rows('intercom'),macro=sample.find(row=>row.type==='macro'),conversation=sample.find(row=>row.type==='conversation');macro.body='<p>Hi <attribute key="company.custom" default="there"/></p>';macro.body_text='Hi {{company.custom|fallback:"there"}}';conversation.conversation_parts.total_count='2';
 const run=(await upload(h,'intercom',JSON.stringify({contacts:sample.filter(x=>x.type==='contact'),conversations:[conversation],macros:[macro],companies:[{type:'company',id:'co'}]}),'source.json')).data;await h.drain();const plan=(await state(h,run)).plan;
 assert.equal(plan.decisions.find(x=>x.kind==='macro').rejection,'macro_placeholders_not_supported');assert.equal(plan.decisions.find(x=>x.kind==='conversation').rejection,'conversation_parts_count_invalid_or_incomplete');assert.equal(plan.counts.byKind.company,1);const company=plan.decisions.find(x=>x.kind==='company');assert.equal(company.sourceId,'co');assert.deepEqual(company.location,{artifact:'source.json',row:1,pointer:'/companies/0'});assert.match(company.omissions[0].reason,/unsupported_record_kind/);assert.deepEqual(company.targets,[]);assert.ok(plan.diagnostics.some(d=>d.code==='unsupported_source_field'&&d.message==='unsupported_envelope_field:companies'&&d.location.pointer==='/companies/0'));await apply(h,run);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM macros').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0)
 }finally{await h.close()}});
async function planningAudit(h,vendor,body){const run=(await upload(h,vendor,body)).data;let audit;while(h.queued.length){const jobs=h.queued.splice(0,1),result=await h.call('/_test/queue-audit',{...json(jobs)});h.queued.push(...result.queue);assert.deepEqual(result.retried,[]);if(result.sqlAudit.some(query=>query.sql.includes('SELECT record_json,serialized')))audit=result}const current=await state(h,run);assert.equal(current.error,null);assert.equal(current.state,'ready');assert.ok(audit);return {run:current,audit}}
test('planning reads relevant native bundles and collision identities, independent of unrelated workspace volume',async()=>{const h=await nativeHarness();try{
 const body=generate('intercom',2),first=await planningAudit(h,'intercom',body);await apply(h,first.run);
 const before=await planningAudit(h,'intercom','\n'+body);assert.equal(before.run.plan.counts.rejected,0);await apply(h,before.run);
 // Real native rows, including unrelated owned provenance and large text. One
 // set insert per table avoids test fixture setup dictating importer complexity.
 await h.db.batch([
  h.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3000) INSERT INTO contacts(id,project_id,email,name,created_at) SELECT 'old-contact-'||i,'p','old-'||i||'@example.test','Unrelated',1 FROM n"),
  h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) SELECT 'old-conv-'||id,'p',id,1,1 FROM contacts WHERE id LIKE 'old-contact-%'"),
  h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT 'old-msg-'||id,'p',id,'old',contact_id,'contact',replace(hex(zeroblob(500)),'0','z'),1,1 FROM conversations WHERE id LIKE 'old-conv-%'"),
  h.db.prepare("INSERT INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT 'old-note-'||id,id,'owner','Unrelated native note',1 FROM conversations WHERE id LIKE 'old-conv-%'"),
  h.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) SELECT 'old-article-'||id,'p','old-'||id,'Unrelated article','Unrelated body','draft',1 FROM contacts WHERE id LIKE 'old-contact-%'"),
  h.db.prepare("INSERT INTO workspace_tags(id,project_id,name,normalized_name) SELECT 'old-tag-'||id,'p',id,id FROM contacts WHERE id LIKE 'old-contact-%'"),
  h.db.prepare("INSERT INTO move_in_notes(id,project_id,conversation_id,author_json,content,created_at,source_time) SELECT 'old-private-'||id,'p',id,'{}','Unrelated import note',1,'1' FROM conversations WHERE id LIKE 'old-conv-%'"),
  h.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,created_at) SELECT 'old-media-'||id,'p',id,'owner','old/'||id,'old.txt','text/plain',1,1 FROM conversations WHERE id LIKE 'old-conv-%'"),
  h.db.prepare("INSERT INTO ik_sources(identity,source_hash,mapping_version,effects_hash,job_id) SELECT 'unrelated-'||id,'unrelated','unrelated','unrelated',(SELECT id FROM ik_jobs LIMIT 1) FROM contacts WHERE id LIKE 'old-contact-%'"),
  h.db.prepare("INSERT INTO move_in_origins(project_id,target_kind,target_id,vendor,source_id,source_json,revision) SELECT 'p','article',id,'intercom','source-'||id,'{}','test' FROM knowledge_articles WHERE id LIKE 'old-article-%'")
 ]);
 const after=await planningAudit(h,'intercom','\n\n'+body);assert.equal(after.run.plan.counts.rejected,0);
 const nativeReads=audit=>audit.sqlAudit.filter(query=>/\b(?:contacts|conversations|messages|move_in_notes|knowledge_articles|workspace_tags|ik_sources|move_in_origins)\b/.test(query.sql)&&!/ik_d1_assertions/.test(query.sql));
 assert.deepEqual(nativeReads(after.audit).map(x=>[x.sql,x.rows]),nativeReads(before.audit).map(x=>[x.sql,x.rows]));assert.ok(nativeReads(after.audit).every(query=>query.rows<25));assert.ok(nativeReads(after.audit).every(query=>query.rowsRead<500),JSON.stringify(nativeReads(after.audit).filter(query=>query.rowsRead>=500).map(({sql,rowsRead})=>({sql,rowsRead}))));assert.ok(after.audit.statements<=1000);assert.ok(after.audit.maxBindings<=100);assert.ok(after.audit.maxParameterBytes<=2000000);
 // Source changes and complete-bundle native edits still refuse reuse.
 await h.db.prepare("UPDATE knowledge_articles SET content='Native article edit' WHERE id NOT LIKE 'old-article-%' AND status='published'").run();const edited=await planningAudit(h,'intercom','\n\n\n'+body);assert.ok(edited.run.plan.decisions.some(d=>d.kind==='article'&&d.rejection==='native_target_conflict'));
 const changed=rows('intercom',2);changed.find(x=>x.type==='contact').name='Changed source';const changedPlan=await planningAudit(h,'intercom',serial(changed));assert.ok(changedPlan.run.plan.decisions.some(d=>d.rejection==='source_changed_conflict'));
 const collision=rows('intercom',1);collision.find(x=>x.type==='contact').id='fresh-source';collision.find(x=>x.type==='contact').email=' OLD-2999@example.test ';const collisionPlan=await planningAudit(h,'intercom',serial(collision));assert.ok(collisionPlan.run.plan.decisions.some(d=>d.rejection==='contact_email_missing_or_invalid'));
 collision.find(x=>x.type==='contact').email='OLD-2999@example.test';const validCollision=await planningAudit(h,'intercom',serial(collision));assert.ok(validCollision.run.plan.decisions.some(d=>d.rejection==='native_contact_email_conflict'));assert.equal(h.outbound,0)
 }finally{await h.close()}});
test('erasure and raw-upload admission recheck authority and identity fences in their SQL transaction',async()=>{const h=await nativeHarness();try{
 const body=generate('intercom',1),run=(await upload(h,'intercom',body)).data;await h.drain();await apply(h,run);const contact=await h.db.prepare("SELECT id FROM contacts WHERE project_id='p'").first(),files=await h.files;
 await h.db.prepare("CREATE TRIGGER test_revoke_erasure AFTER UPDATE OF metadata_json ON contacts BEGIN UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'; END;").run();
 const denied=await h.raw(`/api/management/projects/p/contacts/${contact.id}/erase`,json({}));assert.equal(denied.response.status,500);assert.equal((await state(h,run)).state,'completed');assert.ok((await files.list({prefix:`move-in/p/${run.id}/`})).objects.length>0);assert.ok((await h.db.prepare('SELECT email FROM contacts WHERE id=?').bind(contact.id).first()).email);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_erased_identities').first()).n,0);
 await h.db.prepare('DROP TRIGGER test_revoke_erasure').run();
 // A fence arriving between the admission checks and identity persistence must
 // fail the same transaction, and the caller must remove its preceding R2 put.
 await h.db.prepare("CREATE TRIGGER test_fence_upload AFTER INSERT ON move_in_identity_links BEGIN INSERT OR IGNORE INTO move_in_erased_identities(project_id,digest) VALUES(NEW.project_id,NEW.digest); END;").run();
 const originalCount=(await files.list({prefix:'move-in/p/'})).objects.length,response=await h.raw(`${base}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'race.jsonl','X-Import-Schema':'2.16'},body:'\n'+body});assert.equal(response.response.status,500);assert.equal((await files.list({prefix:'move-in/p/'})).objects.length,originalCount);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_runs').first()).n,1);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_erased_identities').first()).n,0)
 }finally{await h.close()}});
test('email collision index preserves Unicode case and whitespace and tracks later native edits',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('unicode','p',?,1)").bind('\u00a0Ä@EXAMPLE.TEST\u2003').run();
 const sample=rows('intercom'),person=sample.find(row=>row.type==='contact');person.email='ä@example.test';let ready=await planningAudit(h,'intercom',serial(sample));assert.equal(ready.run.plan.decisions.find(row=>row.kind==='contact').rejection,'native_contact_email_conflict');
 await h.db.prepare("UPDATE contacts SET email='elsewhere@example.test',external_id='import:intercom:ct-1' WHERE id='unicode'").run();ready=await planningAudit(h,'intercom','\n'+serial(sample));assert.equal(ready.run.plan.decisions.find(row=>row.kind==='contact').rejection,'native_contact_identity_conflict');
 await h.db.prepare("UPDATE contacts SET external_id=NULL WHERE id='unicode'").run();ready=await planningAudit(h,'intercom','\n\n'+serial(sample));assert.equal(ready.run.plan.decisions.find(row=>row.kind==='contact').rejection,undefined)
 }finally{await h.close()}});
test('incomplete raw input is refused before custody and cannot bypass ordinary native erasure',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('raw-native','p','raw@example.test',1)").run();
 const before=await h.snapshot(),options={method:'POST',headers:{'X-Import-Filename':'intercom.jsonl','X-Import-Schema':'2.16'},body:'{"type":"contact","id":"broken","email":"raw@example.test"\n'},result=await h.raw(`${base}?vendor=intercom`,options);assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'invalid_json',location:{artifact:'intercom.jsonl',row:1,pointer:''}});assert.equal(h.lastWrites,0);await unchanged(h,before,'incomplete-raw-refusal');await h.call('/api/management/projects/p/contacts/raw-native/erase',json({}));assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 assert.equal((await h.raw(`${base}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.jsonl','X-Import-Schema':'2.16'},body:' \n{"type":"contact","id":"broken","email":"changed@example.test"'})).response.status,422);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_runs').first()).n,0);assert.equal(h.outbound,0)
 }finally{await h.close()}});
test('reserved original uploads resume and deleted R2 reservations cannot be recreated by an in-flight writer',async()=>{const h=await nativeHarness();try{
 const body=generate('intercom',1),run=(await upload(h,'intercom',body)).data;h.queued.length=0;const stored=await h.db.prepare('SELECT object_key FROM move_in_runs WHERE id=?').bind(run.id).first();await (await h.files).delete(stored.object_key);await h.db.prepare("UPDATE move_in_runs SET state='uploading' WHERE id=?").bind(run.id).run();
 const retry=(await upload(h,'intercom',body)).data;assert.equal(retry.id,run.id);assert.equal(retry.state,'uploaded');assert.equal(await (await (await h.files).get(stored.object_key)).text(),body);await h.drain();
 assert.deepEqual(await h.call('/_test/custody-race',json({id:run.id})),{reason:'source_custody_erased',retained:false})
 }finally{await h.close()}});
test('oversized relevant native bundles become explicit conflicts without loading their content',async()=>{const h=await nativeHarness();try{
 const body=generate('intercom',1),initial=await planningAudit(h,'intercom',body);await apply(h,initial.run);await h.db.prepare("UPDATE messages SET content=replace(hex(zeroblob(400000)),'0','x')").run();const changed=await planningAudit(h,'intercom','\n'+body);assert.equal(changed.run.plan.decisions.find(d=>d.kind==='conversation').rejection,'native_target_review_size_limit');assert.ok(changed.audit.sqlAudit.every(read=>read.bytes<100000));assert.equal((await h.db.prepare('SELECT MAX(length(content)) n FROM messages').first()).n,800000)
 }finally{await h.close()}});
test('missing source IDs do not link unrelated email identities into one erasure fence',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('one','p','one@example.test',1)").run();await upload(h,'intercom',serial([{type:'contact',email:'one@example.test'},{type:'contact',email:'two@example.test'}]));await h.drain();await h.call('/api/management/projects/p/contacts/one/erase',json({}));const second=await upload(h,'intercom',serial([{type:'contact',id:'two',email:'two@example.test',created_at:1704067200}]));await h.drain();assert.equal((await state(h,second.data)).plan.counts.rejected,0)
 }finally{await h.close()}});
