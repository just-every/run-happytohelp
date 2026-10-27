import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {unchanged} from './admission-equality.mjs';
import {nativeHarness} from './harness.mjs';
import {documents,cases,changed,privateEmail} from './shape-inputs.mjs';
const root='/api/move-in/projects/p/imports',json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const body=records=>records.map(JSON.stringify).join('\n');
const request=(vendor,records,name)=>({method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body:'\n'+body(records)});
const state=async(h,run)=>(await h.call(`${root}/${run.id}`)).data;

import {step} from './steps.mjs';

test("erasure: erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people's data stays",async()=>{
for(const vendor of ['intercom','zendesk'])await step(`${vendor} all supported nested shapes fence native erasure and changed replay`,async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('native','p',?,'Erase me',1)").bind(privateEmail).run();
 const runs=[];
 for(const [index,[kind,path,value,pointer,reason]] of cases[vendor].entries()){
  const {records}=changed(vendor,kind,path,value),name=`shape-${index}.jsonl`,run=(await h.call(`${root}?vendor=${vendor}`,request(vendor,records,name))).data;await h.drain();
  const ready=await state(h,run);assert.equal(ready.state,'ready');assert.equal(ready.error,null);runs.push({run,ready,records,name,pointer,reason,kind,holds:JSON.stringify(value).includes(privateEmail)});
 }
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));
 // Only runs holding the erased address are erased; a run whose uninterpreted
 // field holds nothing of hers keeps its custody.
 const custody=async run=>[(await (await h.files).list({prefix:`move-in/p/${run.id}/`})).objects.length,(await h.db.prepare('SELECT COUNT(*) n FROM move_in_records WHERE run_id=?').bind(run.id).first()).n];
 assert.ok(runs.some(run=>!run.holds));
 for(const {run,pointer,holds} of runs){assert.equal((await state(h,run)).state,holds?'erased':'ready',`${vendor} raw-original custody at ${pointer}`);const [objects,records]=await custody(run);if(holds)assert.deepEqual([objects,records],[0,0],pointer);else assert.ok(objects>0&&records>0,pointer)}
 for(const {run,ready,records,name,pointer,reason,kind} of runs){
  assert.equal((await h.db.prepare('SELECT identity_complete FROM move_in_runs WHERE id=?').bind(run.id).first()).identity_complete,0,pointer);
  const decision=ready.plan.decisions.find(row=>row.kind===(vendor==='zendesk'?{person:'user',conversation:'ticket'}[kind]??kind:{person:'contact'}[kind]??kind));
  assert.equal(decision.location.artifact,name);assert.equal(decision.location.row,kind==='conversation'?3:2);
  const diagnostic=ready.plan.diagnostics.find(row=>row.code===reason&&row.location.pointer.endsWith(pointer));assert.ok(diagnostic,`${reason}:${pointer}`);assert.equal(diagnostic.location.artifact,name);assert.equal(diagnostic.location.row,decision.location.row);
  if(vendor==='intercom'&&pointer==='/name')assert.equal(decision.rejection,'contact_name_invalid');
  // Different bytes and source identity avoid the artifact digest fast path.
  const replay=structuredClone(records),last=replay.at(-1);if(vendor==='zendesk')Object.values(last)[0].id+=1000;else last.id+='-changed';
  assert.equal((await h.raw(`${root}?vendor=${vendor}`,request(vendor,replay,'replay.jsonl'))).response.status,410,pointer);
 }
 for(const {run,holds} of runs)if(holds)assert.deepEqual(await custody(run),[0,0]);assert.equal(h.outbound,0);
 }finally{await h.close()}});
for(const vendor of ['intercom','zendesk'])await step(`${vendor} understood primitives and nullable fields remain complete through native erasure and admission`,async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p',?,1)").bind(privateEmail).run();
 const input=documents(vendor),person=vendor==='zendesk'?input.person.user:input.person,conversation=vendor==='zendesk'?input.conversation.ticket:input.conversation;
 person.custom_attributes=null;person.user_fields=null;person.external_id=null;
 if(vendor==='intercom'){person.name=null;conversation.source.body=privateEmail;conversation.source.subject=null;conversation.source.author.name=null;conversation.source.author.email=null;conversation.source.author.external_id=null;conversation.admin_assignee_id=null;conversation.team_assignee_id=null;input.article.body=null;input.article.body_markdown=privateEmail;input.article.audience=null;input.article.audience_rules=null;input.macro.body_text=null}
 else {conversation.comments[0].body=privateEmail;conversation.comments[0].plain_body=null;conversation.assignee_id=null;input.article.article.body=privateEmail;input.article.article.user_segment_ids=[]}
 const records=Object.values(input),run=(await h.call(`${root}?vendor=${vendor}`,request(vendor,records,'primitives.jsonl'))).data;await h.drain();const ready=await state(h,run);
 assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.rejected,0);assert.equal((await h.db.prepare('SELECT identity_complete FROM move_in_runs WHERE id=?').bind(run.id).first()).identity_complete,1);
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));assert.equal((await state(h,run)).state,'ready');
 const replay=structuredClone(records),article=replay.at(-1);if(vendor==='zendesk')article.article.title='Changed guide';else article.title='Changed guide';
 assert.equal((await h.raw(`${root}?vendor=${vendor}`,request(vendor,replay,'changed-primitives.jsonl'))).response.status,201);
 await h.call(`${root}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await state(h,run)).state,'completed');
 // The handwritten timestamps tie. Assert the content at its original source
 // identity, independently of the mapper's tie-breaking transcript order.
 assert.deepEqual((await h.db.prepare('SELECT s.source_id,m.content FROM messages m JOIN move_in_message_sources s ON s.message_id=m.id ORDER BY s.source_id').all()).results,vendor==='zendesk'?[{source_id:'73',content:privateEmail}]:[{source_id:'reply',content:'Reply'},{source_id:'source:first',content:privateEmail}]);
 assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('all recorded Intercom participants and staff authors retain known email, external and source aliases',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,external_id,created_at) VALUES('native','p',?,'private-external',1)").bind(privateEmail).run();
 const records=[];
 for(const [index,path] of [['participant',['contacts','contacts',0]],['source',['source','author']],['part',['conversation_parts','conversation_parts',0,'author']]]){
  const input=documents('intercom'),conversation=input.conversation;conversation.id=index;let person=conversation;for(const key of path)person=person[key];person.id=`identity-${index}`;person.email=privateEmail;person.external_id='private-external';records.push(input.person,conversation);
 }
 const runs=[];for(let i=0;i<records.length;i+=2){const run=(await h.call(`${root}?vendor=intercom`,request('intercom',records.slice(i,i+2),`alias-${i}.jsonl`))).data;await h.drain();assert.equal((await h.db.prepare('SELECT identity_complete FROM move_in_runs WHERE id=?').bind(run.id).first()).identity_complete,1);runs.push(run)}
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));for(const run of runs)assert.equal((await state(h,run)).state,'erased');
 for(const id of ['identity-participant','identity-source','identity-part']){const person={type:'contact',id,email:'changed@example.test',created_at:1704067200};assert.equal((await h.raw(`${root}?vendor=intercom`,request('intercom',[person],'alias-replay.jsonl'))).response.status,410)}
 assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('bounded shape exhaustion and opaque envelope metadata retain conservative native erasure',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p',?,1)").bind(privateEmail).run();
 const records=[{user:{id:81,role:'end-user',name:'Other',email:'other@example.test',created_at:'2024-01-01T00:00:00Z',tags:Array(5000).fill('ordinary text')}}];
 const before=await h.snapshot(),bounded=await h.raw(`${root}?vendor=zendesk`,request('zendesk',records,'bounded.jsonl'));assert.equal(bounded.response.status,422);assert.deepEqual(bounded.data.diagnostic,{code:'source_identity_node_limit',location:{artifact:'bounded.jsonl',row:2,pointer:'/user/tags/4089'}});assert.equal(h.lastWrites,0);await unchanged(h,before,'bounded-shape-refusal');assert.equal((await (await h.files).list()).objects.length,0);
 const manyFields={type:'contact',id:'many-fields',email:'other@example.test',created_at:1704067200};for(let i=0;i<150;i++)manyFields[`field${i}`]=i===149?privateEmail:'opaque';
 const limited=(await h.call(`${root}?vendor=intercom`,request('intercom',[manyFields],'field-bound.jsonl'))).data;await h.drain();const limitedState=await state(h,limited);assert.equal(limitedState.error,null);assert.equal(limitedState.plan.diagnostics.filter(row=>['unsupported_source_field','source_shape_limit'].includes(row.code)).length,129);assert.equal(limitedState.plan.diagnostics.find(row=>row.code==='source_shape_limit').location.pointer,'/field128');
 const inputs=[{contacts:[documents('intercom').person],pages:{next:{email:privateEmail}}},{contacts:[documents('intercom').person],total_count:{email:privateEmail}},{contacts:[documents('intercom').person],type:{email:privateEmail}}],runs=[];
 for(const [i,input] of inputs.entries()){
  const options={method:'POST',headers:{'X-Import-Filename':`envelope-${i}.json`,'X-Import-Schema':'2.16'},body:JSON.stringify(input)};
  if(i===2){const before=await h.snapshot(),objects=(await (await h.files).list()).objects.map(({key,size,etag,uploaded})=>({key,size,etag,uploaded:uploaded.toISOString()})),result=await h.raw(`${root}?vendor=intercom`,options);assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'invalid_record_discriminator',location:{artifact:'envelope-2.json',row:1,pointer:'/type'}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,before,'malformed-envelope-discriminator-refusal');assert.deepEqual((await (await h.files).list()).objects.map(({key,size,etag,uploaded})=>({key,size,etag,uploaded:uploaded.toISOString()})),objects)}
  else{const run=(await h.call(`${root}?vendor=intercom`,options)).data;await h.drain();runs.push(run)}
 }
 await h.call('/api/management/projects/p/contacts/native/erase',json({}));for(const run of [limited,...runs])assert.equal((await state(h,run)).state,'erased');
 assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 // An unrelated identity with an unsupported source type is refused because
 // checking is incomplete, rather than claiming an erased person was found.
 const unrelated=documents('intercom');unrelated.person.id='fresh-person';unrelated.person.email='fresh-person@example.test';unrelated.conversation.id='fresh-conversation';unrelated.conversation.contacts.contacts[0].id='fresh-person';unrelated.conversation.source.author.id='fresh-person';unrelated.conversation.source.type='conversation';unrelated.conversation.conversation_parts.conversation_parts[0].author.id='fresh-staff';
 const incomplete=await h.raw(`${root}?vendor=intercom`,request('intercom',[unrelated.person,unrelated.conversation],'incomplete-identity.jsonl'));
 assert.equal(incomplete.response.status,410);assert.equal(incomplete.data.code,'source_identity_index_incomplete');assert.deepEqual(incomplete.data.diagnostic,{code:'malformed_source_field',location:{artifact:'incomplete-identity.jsonl',row:3,pointer:'/source/type'},reason:'unsupported_structural_value'});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.doesNotMatch(incomplete.data.error,/contains erased identities/);
 const matched=await h.raw(`${root}?vendor=intercom`,request('intercom',[{type:'contact',id:'fresh-erased-match',email:privateEmail,created_at:1704067200}],'matched-identity.jsonl'));
 assert.equal(matched.response.status,410);assert.equal(matched.data.code,'erased_identity_match');assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list({prefix:'move-in/p/'})).objects.length,0);
 for(const [i,input] of inputs.entries()){input.contacts[0].id='changed';const replay=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed-envelope.json','X-Import-Schema':'2.16'},body:JSON.stringify(input)});assert.equal(replay.response.status,i===2?422:410);assert.equal(h.lastWrites,0);if(i===2)assert.deepEqual(replay.data.diagnostic,{code:'invalid_record_discriminator',location:{artifact:'changed-envelope.json',row:1,pointer:'/type'}})}
 records[0].user.id=82;assert.equal((await h.raw(`${root}?vendor=zendesk`,request('zendesk',records,'changed-bounded.jsonl'))).response.status,422);manyFields.id='changed-fields';assert.equal((await h.raw(`${root}?vendor=intercom`,request('intercom',[manyFields],'changed-fields.jsonl'))).response.status,410);assert.equal(h.outbound,0);
 }finally{await h.close()}});
});
