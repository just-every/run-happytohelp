import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {archive} from './archive-inputs.mjs';
import {person,sourceName,upload} from './empty-inputs.mjs';
const root='/api/move-in/projects/p/imports',post={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};



export async function legacyCustodyJourney(){
 const vendor='zendesk',savedIndex=true;
 const source=Buffer.from(vendor==='zendesk'?'\uFEFF \r\n':'\n{"type":"list","data":[]}'),body=savedIndex?source:archive([{name:'empty/'}]),filename=savedIndex?sourceName(vendor):'old.zip',originalKey='move-in/p/old/original',fileKey='move-in/p/old/files/0',hash=createHash('sha256').update(body).digest('hex'),descriptors=savedIndex?[{name:filename,key:fileKey,sha256:hash,size:body.length,index:[]}]:[];
 const h=await nativeHarness({async beforeIdentityAudit(db,directory,files){
  await db.batch([db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','erase@example.test',1)"),db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','keeper@example.test','Keep',2)")]);
  await files.put(originalKey,body);if(savedIndex)await files.put(fileKey,source);
  await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,files_json,identity_complete,created_at,updated_at) VALUES('old','p','owner','old-session',?,?,?,?,?,?,?,1,1,1)").bind(vendor,filename,hash,originalKey,body.length,savedIndex?'parsing':'uploaded',JSON.stringify(descriptors)).run();
 }});
 try{
  const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),initial=await h.db.prepare("SELECT identity_complete,identity_audited,files_json FROM move_in_runs WHERE id='old'").first();assert.deepEqual(initial,{identity_complete:0,identity_audited:0,files_json:JSON.stringify(descriptors)});
  await h.call(`${root}/old/resume`,post);await h.drain();const stopped=(await h.call(`${root}/old`)).data;assert.equal(stopped.state,savedIndex?'parsing':'uploaded');assert.equal(stopped.error,'older_export_identity_audit_incomplete');assert.equal(stopped.parsed,0);
  assert.equal((await h.db.prepare("SELECT identity_audited FROM move_in_runs WHERE id='old'").first()).identity_audited,-1);
  for(const table of ['move_in_records','move_in_batches','move_in_identity_links','ik_jobs'])assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
  assert.deepEqual(Buffer.from(await (await (await h.files).get(originalKey)).arrayBuffer()),body);if(savedIndex)assert.deepEqual(Buffer.from(await (await (await h.files).get(fileKey)).arrayBuffer()),source);
  const beforeRepeat=await h.snapshot(),repeat=await h.call(`${root}?vendor=${vendor}`,upload(body,filename));assert.equal(repeat.data.id,'old');assert.equal(repeat.writes,0);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,beforeRepeat,`${vendor}-legacy-empty-retained`);
  await h.call('/api/management/projects/p/contacts/native/erase',post);assert.equal((await h.call(`${root}/old`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);assert.deepEqual(await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),keeper);
  const beforeReplay=await h.snapshot(),replay=await h.raw(`${root}?vendor=${vendor}`,upload(JSON.stringify(person(vendor)),sourceName(vendor)));assert.equal(replay.response.status,410);assert.match(replay.data.error,/older export/);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,beforeReplay,`${vendor}-legacy-empty-fenced`);
  const other=vendor==='zendesk'?'intercom':'zendesk',different=await h.raw(`${root}?vendor=${other}`,upload(JSON.stringify(person(other)),sourceName(other)));assert.equal(different.response.status,201);await h.drain();assert.equal((await h.call(`${root}/${different.data.data.id}`)).data.state,'ready');assert.equal(h.outbound,0);
 }finally{await h.close()}
}
