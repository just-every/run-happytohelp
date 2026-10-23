import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {person,article,conversation,upload,state,apply,json,root,uploadBody} from './correction-fixtures.mjs';
test('native knowledge deletion is a reviewable rejection and cannot be undone by a new import',async()=>{const h=await nativeHarness();try{
 const first=await upload(h,[article()]);await h.drain();assert.equal((await apply(h,first)).state,'completed');const target=await h.db.prepare('SELECT id FROM knowledge_articles').first();
 await h.call(`/api/knowledge/p/articles/${target.id}`,{method:'DELETE'});
 const reviewed=(await uploadBody(h,'\n'+JSON.stringify(article()))).data;await h.drain();const result=await state(h,reviewed);
 assert.equal(result.state,'ready');assert.equal(result.error,null);assert.equal(result.plan.decisions[0].rejection,'native_target_missing');assert.equal(result.plan.counts.rejected,1);assert.equal(result.plan.counts.effects,0);
 assert.equal((await h.raw(`${root}/${reviewed.id}/apply`,json({fingerprint:result.plan.fingerprint}))).response.status,409);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM knowledge_articles').first()).n,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});

test('a collision in a later review partition prevents any earlier publication',async()=>{const h=await nativeHarness();try{
 const people=Array.from({length:25},(_,i)=>person(`source-${i}`,`source-${i}@example.test`));const run=await upload(h,people);await h.drain();assert.equal((await state(h,run)).plan.counts.mapped,25);
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('late-native','p','SOURCE-24@example.test',1)").run();
 const result=await apply(h,run);assert.equal(result.error,'native_contact_changed_since_review');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,1);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_origins').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_provenance').first()).n,0);
 }finally{await h.close()}});

test("missing imported records are an explicit review conflict",matrix([
 ['contact',[person()],'contacts'],
 ['conversation',[person(),conversation()],'conversations'],
 ['macro',[{type:'macro',id:'reply',name:'Reply',body:'Hello',visible_to:'everyone',available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}],'macros']
],async ([kind,rows,table])=>{const h=await nativeHarness();try{
 const run=await upload(h,rows);await h.drain();const applied=await apply(h,run);assert.equal(applied.error,null);assert.equal(applied.state,'completed');if(kind==='conversation')await h.db.batch(['DELETE FROM move_in_message_sources','DELETE FROM move_in_notes','DELETE FROM move_in_conversations','DELETE FROM conversation_tags','DELETE FROM messages'].map(sql=>h.db.prepare(sql)));await h.db.prepare(`DELETE FROM ${table}`).run();
 const next=(await uploadBody(h,'\n'+rows.map(JSON.stringify).join('\n'))).data;await h.drain();const reviewed=await state(h,next);assert.equal(reviewed.state,'ready');assert.equal(reviewed.error,null);assert.equal(reviewed.plan.decisions.find(d=>d.kind===kind).rejection,'native_target_missing');assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
 }finally{await h.close()}}));

test("native article changes after review are preserved during apply",matrix(['delete','edit'],async (change)=>{const h=await nativeHarness();try{
 const first=await upload(h,[article()]);await h.drain();assert.equal((await apply(h,first)).state,'completed');const target=await h.db.prepare('SELECT id FROM knowledge_articles').first();
 const next=(await uploadBody(h,'\n'+JSON.stringify(article()))).data;await h.drain();assert.equal((await state(h,next)).plan.counts.rejected,0);
 if(change==='delete')await h.call(`/api/knowledge/p/articles/${target.id}`,{method:'DELETE'});else await h.db.prepare("UPDATE knowledge_articles SET content='Native replacement' WHERE id=?").bind(target.id).run();
 const current=await apply(h,next);assert.notEqual(current.state,'completed');assert.ok(current.error);const row=await h.db.prepare('SELECT content FROM knowledge_articles WHERE id=?').bind(target.id).first();assert.deepEqual(row,change==='delete'?null:{content:'Native replacement'});
 const changed=(await upload(h,[{...article(),title:'Changed source'}])).id;await h.drain();assert.ok((await state(h,{id:changed})).plan.decisions[0].rejection);
 }finally{await h.close()}}));

test('a native identity mutation inside the publishing transaction rolls back every imported row',async()=>{const h=await nativeHarness();try{
 const run=await upload(h,[person(),article()]);await h.drain();await h.call(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));await h.step();
 await h.db.prepare("CREATE TRIGGER test_publication_race AFTER INSERT ON contacts WHEN NEW.id LIKE 'mi_%' BEGIN INSERT INTO contacts(id,project_id,email,created_at) VALUES('native-race','p','CUSTOMER@example.test',1); END;").run();
 await h.drain();const result=await state(h,run);assert.notEqual(result.state,'completed');assert.ok(result.error);for(const table of ['contacts','knowledge_articles','move_in_origins','ik_provenance'])assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0,table);assert.equal(h.outbound,0);
 }finally{await h.close()}});

test('publication collision guards use bounded indexed reads with unrelated native contacts',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3000) INSERT INTO contacts(id,project_id,email,created_at) SELECT 'unrelated-'||i,'p','unrelated-'||i||'@example.test',1 FROM n").run();
 const run=await upload(h,[person()]);await h.drain();await h.call(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));const guarded=[];
 while(h.queued.length){const result=await h.call('/_test/queue-audit',json(h.queued.splice(0,1)));h.queued.push(...result.queue);assert.deepEqual(result.retried,[]);assert.ok(result.statements<=1000);assert.ok(result.maxBindings<=100);assert.ok(result.maxParameterBytes<=2000000);guarded.push(...result.sqlTransactions.filter(s=>s.sql.includes('json_each(?) candidate')))}
 assert.equal((await state(h,run)).state,'completed');assert.ok(guarded.length>0);assert.ok(guarded.every(s=>s.rowsRead<300),'candidate guards do not scan unrelated contacts');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,3001);assert.equal(h.outbound,0);console.log(JSON.stringify({publicationGuardReadMax:Math.max(...guarded.map(s=>s.rowsRead)),guardedStatements:guarded.length,maxInvocationStatements:h.maxStatements,unrelatedContacts:3000}));
 }finally{await h.close()}});

test("publication refuses late native email changes with case differences atomically",matrix(['insert','edit'],async (mutation)=>{const h=await nativeHarness();try{
 if(mutation==='edit')await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','before@example.test',1)").run();
 const run=await upload(h,[person('one','same@example.test'),article()]);await h.drain();assert.equal((await state(h,run)).plan.counts.rejected,0);
 if(mutation==='insert')await h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('native','p','SAME@example.test','Native keeper',1)").run();else await h.db.prepare("UPDATE contacts SET email='SAME@example.test',name='Native keeper' WHERE id='native'").run();
 const approved=await h.raw(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));if(approved.response.ok)await h.drain();else assert.equal(approved.response.status,409);
 assert.notEqual((await state(h,run)).state,'completed');assert.deepEqual((await h.db.prepare('SELECT id,email,name FROM contacts ORDER BY id').all()).results,[{id:'native',email:'SAME@example.test',name:'Native keeper'}]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM knowledge_articles').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_origins').first()).n,0);assert.equal(h.outbound,0);
 }finally{await h.close()}}));

test('a rejected record holds no source ID: its corrected copy imports beside what was already imported',async()=>{const h=await nativeHarness();try{
 const reply=(visible_to)=>({type:'macro',id:'refund',name:'Refund timing',body:'Refunds take 5 days.',visible_to,available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'});
 const first=await upload(h,[person(),reply('team')]);await h.drain();assert.equal((await state(h,first)).plan.decisions.find(d=>d.kind==='macro').rejection,'restricted_macro_not_imported');assert.equal((await apply(h,first)).state,'completed');
 const fixed=await upload(h,[person(),reply('everyone')],'fixed.jsonl');await h.drain();const review=await state(h,fixed);assert.deepEqual(review.plan.decisions.map(d=>[d.kind,d.rejection??null,d.targets.length]),[['contact',null,1],['macro',null,1]]);
 assert.equal((await apply(h,fixed)).state,'completed');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM macros').first()).n,1);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,1);
 }finally{await h.close()}});
