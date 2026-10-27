import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {nestedRecord,nestedUpload} from './nested-inputs.mjs';

import {step} from './steps.mjs';

export async function upgradeSteps(){
for(const vendor of ['intercom','zendesk'])await step(`${vendor}: an old unprocessable nested original establishes its vendor fence before removal`,async()=>{
 const body=Buffer.from(JSON.stringify(vendor==='intercom'?{type:'list',unknown:{deeper:[nestedRecord]}}:{box:{deeper:[{user:{id:81,email:'imani@example.test'}}]}})),filename=vendor==='intercom'?'old.json':'old.ndjson';
 const h=await nativeHarness({async beforeIdentityAudit(db,directory,files){await db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','imani@example.test',1)").run();await files.put('move-in/p/old/original',body);await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,created_at,updated_at) VALUES('old','p','owner','old-session',?,?,?,'move-in/p/old/original',?,'uploaded',1,1,1)").bind(vendor,filename,createHash('sha256').update(body).digest('hex'),body.length).run()}});
 try{
  assert.equal((await h.db.prepare("SELECT identity_complete FROM move_in_runs WHERE id='old'").first()).identity_complete,0);
  await h.call('/api/management/projects/p/contacts/native/erase',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.deepEqual(await h.db.prepare("SELECT state,identity_audited FROM move_in_runs WHERE id='old'").first(),{state:'erased',identity_audited:-1});assert.equal((await (await h.files).list()).objects.length,0);
  const before=await h.snapshot(),record=vendor==='intercom'?{...nestedRecord,id:'unrelated',email:'unrelated@example.test',external_id:'unrelated'}:{user:{id:99,role:'end-user',name:'Unaffected',email:'unrelated@example.test',created_at:'2024-04-01T00:00:00Z'}};
  const replay=await h.raw(`/api/move-in/projects/p/imports?vendor=${vendor}`,nestedUpload(JSON.stringify(record),filename));assert.equal(replay.response.status,410);assert.match(replay.data.error,/older export/);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,before,'nested-old-original-vendor-fence');assert.equal(h.outbound,0);
 }finally{await h.close()}
});}
