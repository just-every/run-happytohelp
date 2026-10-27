import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {records} from './envelope-inputs.mjs';
import {archive} from './archive-inputs.mjs';

import {step} from './steps.mjs';

export async function upgradeSteps(){
for(const malformed of [false,true])await step(`old originals recover envelope aliases or fence opaque ZIP custody (${malformed})`,async()=>{
 const body=malformed?archive([{name:'hidden/',body:'unknown erased identities'},{name:'person.json',body:JSON.stringify(records().contact)}]):Buffer.from(JSON.stringify({type:'list',archived:records().conversation})),filename=malformed?'old.zip':'old.json';
 const h=await nativeHarness({async beforeIdentityAudit(db,directory,files){await db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','courier@example.test',1)").run();await files.put('move-in/p/old/original',body);await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,created_at,updated_at) VALUES('old','p','owner','old-session','intercom',?,?,'move-in/p/old/original',?,'uploaded',1,1,1)").bind(filename,createHash('sha256').update(body).digest('hex'),body.length).run()}});
 try{
  assert.equal((await h.db.prepare("SELECT identity_complete FROM move_in_runs WHERE id='old'").first()).identity_complete,0);
  await h.call('/api/management/projects/p/contacts/native/erase',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal((await h.db.prepare("SELECT state FROM move_in_runs WHERE id='old'").first()).state,'erased');assert.equal((await h.db.prepare("SELECT identity_audited FROM move_in_runs WHERE id='old'").first()).identity_audited,malformed?-1:1);assert.equal((await (await h.files).list()).objects.length,0);
  for(const record of [{id:'courier-agent'},{id:'new-source',external_id:'agent-archive'},...(malformed?[{id:'unrelated'}]:[])]){const result=await h.raw('/api/move-in/projects/p/imports?vendor=intercom',{method:'POST',headers:{'X-Import-Filename':'new.json','X-Import-Schema':'2.16'},body:JSON.stringify({type:'contact',email:'changed@example.test',created_at:1711929600,...record})});assert.equal(result.response.status,410);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);if(malformed)assert.match(result.data.error,/older export/)}assert.equal(h.outbound,0);
 }finally{await h.close()}
});}
