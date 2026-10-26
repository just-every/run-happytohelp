import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {unchanged} from './admission-equality.mjs';
import {nativeHarness} from './harness.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
// Duplicate JSON members cannot be represented by an ordinary JS object. These
// source bytes and expected pointers are intentionally written independently.
const cases=[
 ['zendesk','{"user":{"id":901,"name":{"email":"syntax-private@example.test"},"name":"Safe","email":"other@example.test","role":"end-user","created_at":"2024-01-01T00:00:00Z"}}','/user/name'],
 ['intercom','{"type":"contact","id":"duplicate","name":{"email":"syntax-private@example.test"},"na\\u006de":"Safe","email":"other@example.test","created_at":1704067200}','/name'],
 ['intercom','{"type":"conversation","id":"duplicate","source":{"body":{"email":"syntax-private@example.test"},"body":"Safe"}}','/source/body']
];
test('duplicate source members cannot hide erased original identities across vendor and nesting forms',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','syntax-private@example.test',1)").run();
 for(const [vendor,body,pointer] of cases){
 const options={method:'POST',headers:{'X-Import-Filename':'duplicates.jsonl','X-Import-Schema':'2.16'},body:'\n'+body};
 const before=await h.snapshot(),result=await h.raw(`${root}?vendor=${vendor}`,options);assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'duplicate_json_field',location:{artifact:'duplicates.jsonl',row:2,pointer}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);
 await unchanged(h,before,'duplicate-member-refusal');assert.equal((await (await h.files).list()).objects.length,0);
 }
 await h.call('/api/management/projects/p/contacts/native/erase',post({}));
 for(const [vendor,body] of cases){const options={method:'POST',headers:{'X-Import-Filename':'duplicates.jsonl','X-Import-Schema':'2.16'},body:'\n'+body};assert.equal((await h.raw(`${root}?vendor=${vendor}`,{...options,body:'\n\n'+body.replace('Safe','Changed')})).response.status,422);assert.equal(h.outbound,0)}
 }finally{await h.close()}});

test('a malformed record discriminator is a located rejection without object-to-string coercion',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','kind-private@example.test',1)").run();
 const input={type:{toString:{email:'kind-private@example.test'}},id:'malformed-kind',email:'other@example.test',created_at:1704067200},options={method:'POST',headers:{'X-Import-Filename':'kind.jsonl','X-Import-Schema':'2.16'},body:'\n'+JSON.stringify(input)};
 const before=await h.snapshot(),result=await h.raw(`${root}?vendor=intercom`,options);
 assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'invalid_record_discriminator',location:{artifact:'kind.jsonl',row:2,pointer:'/type'}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,before,'malformed-discriminator-refusal');assert.equal((await (await h.files).list()).objects.length,0);
 await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 input.id='changed-kind';const repeated=await h.raw(`${root}?vendor=intercom`,{...options,body:JSON.stringify(input)});assert.equal(repeated.response.status,422);assert.deepEqual(repeated.data.diagnostic,{code:'invalid_record_discriminator',location:{artifact:'kind.jsonl',row:1,pointer:'/type'}});assert.equal(h.lastWrites,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
