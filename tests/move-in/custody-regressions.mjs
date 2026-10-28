import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
const root='/api/move-in/projects/p/imports';
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const contact=(id,email)=>({type:'contact',id,email,created_at:1704067200});
const upload=async(h,records,name='people.jsonl')=>(await h.call(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body:records.map(JSON.stringify).join('\n')})).data;

import {step} from './steps.mjs';

test("erasure: erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people's data stays",async()=>{
await step('erasure retains the complete transitive identity alias closure after raw journals are deleted',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','original@example.test',1)").run();
 const runs=[];for(const row of [contact('first','original@example.test'),contact('first','bridge@example.test'),contact('second','bridge@example.test')])runs.push(await upload(h,[row]));
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));
 for(const run of runs)assert.equal((await h.call(`${root}/${run.id}`)).data.state,'erased');
 const replay=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.jsonl','X-Import-Schema':'2.16'},body:JSON.stringify(contact('second','changed@example.test'))});assert.equal(replay.response.status,410);assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 }finally{await h.close()}});
await step('unrecognized identity-bearing source shapes keep raw-custody protection without touching another contact\'s run',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','private@example.test',1)").run();
 const run=await upload(h,[{type:'unknown',id:'x',person:{email:'private@example.test'}}]);const other=await upload(h,[{type:'unknown',id:'y',person:{email:'other@example.test'}}],'other.jsonl');await h.drain();
 const custody=async()=>({run:await h.db.prepare('SELECT * FROM move_in_runs WHERE id=?').bind(other.id).first(),records:(await h.db.prepare('SELECT * FROM move_in_records WHERE run_id=? ORDER BY 1').bind(other.id).all()).results,links:(await h.db.prepare('SELECT * FROM move_in_identity_links WHERE run_id=? ORDER BY digest').bind(other.id).all()).results,objects:(await (await h.files).list({prefix:`move-in/p/${other.id}/`})).objects.map(({key,etag})=>({key,etag}))}),kept=await custody();assert.equal(kept.run.identity_complete,0);assert.ok(kept.objects.length);
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));assert.equal((await h.call(`${root}/${run.id}`)).data.state,'erased');assert.equal((await (await h.files).list({prefix:`move-in/p/${run.id}/`})).objects.length,0);
 assert.deepEqual(await custody(),kept);
 const changed=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed-unknown.jsonl','X-Import-Schema':'2.16'},body:JSON.stringify({type:'another-unknown-shape',id:'new-source',person:{email:'private@example.test'}})});assert.equal(changed.response.status,410);assert.deepEqual(await custody(),kept);
 }finally{await h.close()}});
});

test("recovery: interrupted work resumes from durable state after a killed Worker, a broken checkpoint or tampered originals, without duplicating history",async()=>{
await step('conditional custody writes preserve the winner and reject stale reservations after recreation',async()=>{const h=await nativeHarness();try{
 const run=await upload(h,[contact('c','person@example.test')]);
 assert.equal((await h.call('/_test/custody-writers',json({id:run.id}))).retained,true);
 assert.deepEqual(await h.call('/_test/custody-reservation-aba',json({id:run.id})),{lateWriteAccepted:false,retained:false});
 }finally{await h.close()}});
});
