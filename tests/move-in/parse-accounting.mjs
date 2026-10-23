import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {unchanged} from './admission-equality.mjs';
import {nativeHarness} from './harness.mjs';
import {person,uploadBody,state,root,json} from './correction-fixtures.mjs';
test("malformed positions are located pre-custody refusals in every source format",matrix([
 ['broken.jsonl',JSON.stringify(person())+'\n\n{"type":\n',{artifact:'broken.jsonl',row:3,pointer:'/type'}],
 ['broken.json','{\n"contacts":['+JSON.stringify(person())+'],\n"conversations":[\n nope\n]}',{artifact:'broken.json',row:4,pointer:'/conversations/0'}]
],async ([name,body,location])=>{const h=await nativeHarness();try{
 const before=await h.snapshot(),result=await h.raw('/api/move-in/projects/p/imports?vendor=intercom',{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'invalid_json',location});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,before,'syntax-admission-refusal');assert.equal((await (await h.files).list()).objects.length,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0);assert.equal(h.outbound,0);
 }finally{await h.close()}}));

test('repeated source identities and unidentifiable positions have distinct handwritten counts',async()=>{const h=await nativeHarness();try{
 const row=JSON.stringify(person()),run=(await uploadBody(h,row+'\n'+row+'\n{"type":"contact","email":"missing@example.test"}\n','counts.jsonl')).data;await h.drain();const ready=await state(h,run);
 assert.equal(ready.state,'ready');assert.deepEqual(ready.plan.counts,{input:3,unique:1,duplicates:1,mapped:0,unmapped:0,rejected:2,effects:0,byKind:{contact:1,'invalid-record':1}});assert.equal(ready.plan.duplicateRecords,1);
 assert.deepEqual(ready.plan.decisions.map(d=>[d.kind,d.rejection,d.location]),[['contact','conflicting_duplicate_id',{artifact:'counts.jsonl',row:1}],['invalid-record','invalid_source_id',{artifact:'counts.jsonl',row:3}]]);assert.ok(ready.plan.decisions.every(d=>d.targets.length===0));
 assert.equal((await h.raw(`${root}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}))).response.status,409,'a review with nothing to import cannot be approved');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,0);
 }finally{await h.close()}});
