import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {intercomRecords} from './record-inputs.mjs';
const root='/api/move-in/projects/p/imports',post={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};

import {step} from './steps.mjs';

export async function upgradeSteps(){
for(const slot of ['contact','source','participant','ambiguous'])await step(`pre-audit ${slot} root classification recovers aliases or establishes the documented workspace/vendor fence`,async()=>{
 const records=intercomRecords(),record=slot==='contact'?records.contact:records.conversation,person=slot==='contact'?record:slot==='participant'?record.contacts.contacts[0]:record.source.author;person.email='old-root@example.test';person.external_id='old-root-external';const body=JSON.stringify({...record,data:[],...(slot==='ambiguous'?{kind:'list'}:{})});
 const h=await nativeHarness({async beforeIdentityAudit(db,directory,files){await db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','old-root@example.test',1)").run();await files.put('move-in/p/old/original',body);await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,created_at,updated_at) VALUES('old','p','owner','old-session','intercom','old-root.json',?,'move-in/p/old/original',?,'uploaded',1,1,1)").bind(createHash('sha256').update(body).digest('hex'),Buffer.byteLength(body)).run()}});
 try{
  assert.equal((await h.db.prepare("SELECT identity_complete FROM move_in_runs WHERE id='old'").first()).identity_complete,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_identity_links').first()).n,0);await h.call('/api/management/projects/p/contacts/native/erase',post);assert.equal((await h.call(`${root}/old`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);
  assert.equal((await h.db.prepare("SELECT identity_audited FROM move_in_runs WHERE id='old'").first()).identity_audited,slot==='ambiguous'?-1:1);
  for(const change of [{id:person.id},{id:'new-source',external_id:'old-root-external'}]){const result=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.json','X-Import-Schema':'2.16'},body:JSON.stringify({type:'contact',email:'changed@example.test',created_at:1704067200,...change})});assert.equal(result.response.status,410);assert.equal(h.lastWrites,0);if(slot==='ambiguous')assert.match(result.data.error,/older export/)}
  if(slot==='ambiguous'){const different=await h.raw(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'other.ndjson'},body:JSON.stringify({user:{id:99,role:'end-user',name:'Other vendor',email:'other@example.test',created_at:'2024-01-01T00:00:00Z'}})});assert.equal(different.response.status,201)}assert.equal(h.outbound,0);
 }finally{await h.close()}
});}
