import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {person,conversation,upload,state,replay,json,apply} from './correction-fixtures.mjs';

const cases=[
 ['nested invalid email',id=>({...person(id),email:{address:'private@example.test'}}),'contact_email_missing_or_invalid'],
 ['embedded author email',id=>({...conversation(id,'unrelated'),source:{id:'source',body:'Hello',author:{type:'contact',id:'embedded',email:'private@example.test'}}}),'conversation_contact_unavailable'],
 ['unrecognized contact identity',id=>({...person(id,'other@example.test'),alternate_identity:{email:'private@example.test'}}),'unsupported_source_field:alternate_identity'],
 ['malformed contact collection',id=>({...conversation(id),contacts:{type:'contact.list',contacts:{id:'hidden',email:'private@example.test'}}}),'exactly_one_conversation_contact_required']
];

import {step} from './steps.mjs';

test("erasure: erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people's data stays",async()=>{
await step('private original erasure covers malformed and embedded identities and changed source IDs',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','private@example.test',1)").run();
 const runs=[];for(const [label,shape,reason] of cases){
 const run=await upload(h,[shape('first')]);runs.push(run);await h.drain();const ready=await state(h,run);assert.equal(ready.state,'ready');assert.equal(ready.error,null);assert.ok(ready.plan.decisions.some(d=>d.rejection===reason||d.omissions.some(o=>o.reason===reason)),label+' is accounted for');
 }
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));
 for(const run of runs){assert.equal((await state(h,run)).state,'erased');assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0)}
 for(const [label,shape] of cases){assert.equal((await replay(h,[shape('different-source')])).response.status,410,label);assert.equal(h.outbound,0)}
 }finally{await h.close()}});
await step('the first durable fence retains imported source aliases even after native identity fields were cleared',async()=>{const h=await nativeHarness();try{
 const run=await upload(h,[person('source','original@example.test')]);await h.drain();assert.equal((await apply(h,run)).state,'completed');const target=await h.db.prepare('SELECT id FROM contacts').first();await h.db.prepare('UPDATE contacts SET email=NULL,external_id=NULL').run();
 assert.deepEqual(await h.call('/_test/interrupt-first-fence',json({id:target.id})),{status:500,fired:true});
 assert.equal((await replay(h,[person('source','changed@example.test')])).response.status,410);assert.equal((await replay(h,[person('new-source','original@example.test')])).response.status,410);
 await h.call(`/api/management/projects/p/contacts/${target.id}/erase`,json({}));assert.equal((await state(h,run)).state,'erased');assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 }finally{await h.close()}});
for(const body of [{email:'concurrent@example.test'},{provided_email:'concurrent@example.test',is_blocked:false}])await step(`native contact ${'email' in body?'email':'metadata'} update admitted before erasure cannot overwrite its fence`,async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','old@example.test',1)").run();
 const result=await h.call('/_test/native-update-erasure',json(body));assert.equal(result.fired,true);assert.equal(result.status,409);
 const row=await h.db.prepare("SELECT email,metadata_json FROM contacts WHERE id='native'").first();assert.equal(row.email,null);const metadata=JSON.parse(row.metadata_json);assert.equal(metadata.is_erased,1);assert.equal(metadata.is_blocked,1);assert.equal(metadata.provided_email,undefined);
 }finally{await h.close()}});
await step('first erasure fence retains original aliases, concurrent identity and resumable closure',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES('native','p','Original name','old@example.test','old-external',1)").run();
 const runs=[];for(const row of [person('first','old@example.test'),person('first','bridge@example.test'),person('second','bridge@example.test'),person('current','new@example.test')])runs.push(await upload(h,[row]));
 await h.db.prepare("CREATE TRIGGER test_first_fence AFTER UPDATE OF metadata_json ON contacts WHEN NEW.id='native' AND OLD.email='old@example.test' BEGIN UPDATE contacts SET email='new@example.test',external_id='new-external' WHERE id=NEW.id; END;").run();
 await h.db.prepare("CREATE TRIGGER test_interrupt_erasure BEFORE INSERT ON contact_erasures BEGIN SELECT RAISE(ABORT,'test interruption'); END;").run();
 assert.equal((await h.raw('/api/management/projects/p/contacts/native/erase',json({}))).response.status,500);
 assert.equal((await h.db.prepare("SELECT email FROM contacts WHERE id='native'").first()).email,'new@example.test','actual first-fence interleaving occurred');
 for(const run of runs)assert.equal((await state(h,run)).state,'erased');
 assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 await h.db.prepare('DROP TRIGGER test_interrupt_erasure').run();await h.call('/api/management/projects/p/contacts/native/erase',json({}));
 for(const email of ['old@example.test','bridge@example.test','new@example.test'])assert.equal((await replay(h,[person('brand-new',email)])).response.status,410);
 assert.equal((await replay(h,[person('second','last@example.test')])).response.status,410);
 assert.equal((await h.raw('/api/management/projects/p/contacts/native',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'revive@example.test'})})).response.status,409);
 const erased=await h.db.prepare("SELECT name,email,external_id FROM contacts WHERE id='native'").first();assert.deepEqual(erased,{name:null,email:null,external_id:null});assert.equal(h.outbound,0);
 }finally{await h.close()}});
for(const action of ['contact','instruction'])await step(`native widget ${action} admitted before erasure cannot revive contact data`,async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,metadata_json,created_at) VALUES('native','p','widget@example.test','{\"provided_email\":\"provided@example.test\"}',1)").run();
 await h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('own','p','native',1,1)").run();await h.contactSession('visitor','p','native');
 const result=await h.call('/_test/native-update-erasure?route=widget',{...json({action,data:{email:'new@example.test',opened:true}}),actor:'visitor'});assert.deepEqual(result,{status:409,fired:true});
 const row=await h.db.prepare("SELECT email,metadata_json FROM contacts WHERE id='native'").first();assert.equal(row.email,null);assert.equal(JSON.parse(row.metadata_json).is_erased,1);assert.equal(JSON.parse(row.metadata_json).provided_email,undefined);
 for(const email of ['widget@example.test','provided@example.test'])assert.equal((await replay(h,[person('new',email)])).response.status,410);assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('a signed widget metadata write admitted before erasure cannot restore identity or create a live session',async()=>{const h=await nativeHarness();try{
 const secret=randomBytes(32).toString('hex'),identifier='signed-customer',metadata={provided_email:'restored@example.test'};const sign=value=>createHmac('sha256',secret).update(value).digest('hex');
 await h.db.prepare("UPDATE projects SET verification_secret=? WHERE id='p'").bind(secret).run();await h.db.prepare("INSERT INTO contacts(id,project_id,email,external_id,is_verified,created_at) VALUES('native','p','signed@example.test',?,1,1)").bind(identifier).run();
 const body={widgetKey:'widget-p',identifier,contact_hash:sign(identifier),metadata:{...metadata,hash:sign(JSON.stringify(metadata))}};
 const result=await h.call('/_test/native-update-erasure?route=session',{...json(body),headers:{'Content-Type':'application/json',Origin:'https://example.test'}});assert.deepEqual(result,{status:403,fired:true});
 const row=await h.db.prepare("SELECT email,external_id,metadata_json FROM contacts WHERE id='native'").first();assert.equal(row.email,null);assert.equal(row.external_id,null);assert.equal(JSON.parse(row.metadata_json).is_erased,1);assert.equal(JSON.parse(row.metadata_json).provided_email,undefined);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sessions WHERE contact_id='native' AND revoked_at IS NULL").first()).n,0);assert.equal((await replay(h,[person('new','signed@example.test')])).response.status,410);assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('a native identity committed before the first fence is durably retained even if erasure immediately stops',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','initial@example.test',1)").run();const original=await upload(h,[person('initial','initial@example.test')]);const current=await upload(h,[person('changed','changed@example.test')]);
 assert.deepEqual(await h.call('/_test/interrupt-first-fence',json({id:'native',change:{email:'changed@example.test',provided_email:'alias@example.test'}})),{status:500,fired:true});
 for(const email of ['initial@example.test','changed@example.test','alias@example.test'])assert.equal((await replay(h,[person('fresh',email)])).response.status,410);
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));for(const run of [original,current])assert.equal((await state(h,run)).state,'erased');assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 }finally{await h.close()}});
});
