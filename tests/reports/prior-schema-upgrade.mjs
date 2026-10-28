import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pbkdf2Sync} from 'node:crypto';
import {readArtifact} from '../helpers/artifact-payloads.mjs';
import {recoveryRuntime} from '../helpers/recovery/runtime.mjs';
import {snapshot} from '../helpers/recovery/snapshot.mjs';
import {passwordSession} from '../helpers/recovery/cli.mjs';
import {seedHistoryUpgrade,verifyHistoryUpgrade} from './history-upgrade.mjs';
import {attachmentSchemaUpgrade} from './upgrade-attachments.mjs';

// One prior native store, one additive upgrade, one historical customer cohort.
// Exact prior values and file bytes are compared; schema text and declaration
// inventories are implementation details rather than user-facing contracts.
export async function priorSchemaUpgrade(){
 const artifact=await readArtifact('delivery-artifact/happytohelp-worker-artifact.json');
 // Wrangler orders migration names by numeric prefix, then code-unit name for
 // equal prefixes. Artifact packaging orders filenames lexically instead.
 const complete=[...artifact.deploymentSpec.migrations].sort((a,b)=>parseInt(a.name,10)-parseInt(b.name,10)||(a.name<b.name?-1:a.name>b.name?1:0));
 const cutoff=complete.findIndex(m=>m.name==='112_conversation_outcomes.sql');assert.ok(cutoff>0);
 const old=complete.slice(0,cutoff),scratch=await mkdtemp(join(tmpdir(),'h2h-upgrade-'));
 const email='upgrade-agent@example.test',password='synthetic-hh-upgrade-native-password',salt='synthetic-hh-upgrade-salt';
 let runtime;
 try{
  // Keep readArtifact's payload-location association while selecting the prior
  // migration prefix. A spread/structuredClone loses that WeakMap identity.
  artifact.deploymentSpec={...artifact.deploymentSpec,migrations:old};
  runtime=await recoveryRuntime(artifact,{directory:join(scratch,'runtime'),variables:{}});
  let before;
  await runtime.withStorage(async storage=>{
   const sql=(sql,values=[])=>storage.inspect({sql,values});
   await sql("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('upgrade-project','Upgrade','upgrade-widget','https://upgrade.example.test',1)");
   await sql("INSERT INTO users VALUES('upgrade-agent',?,'Upgrade agent',1)",[email]);
   await sql("INSERT INTO credentials VALUES('upgrade-agent',?,1)",[salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')]);
   await sql("INSERT INTO memberships VALUES('upgrade-project','upgrade-agent','owner')");
   await sql("INSERT INTO contacts(id,project_id,created_at) VALUES('upgrade-contact','upgrade-project',1)");
   await sql("INSERT INTO conversations(id,project_id,contact_id,revision,created_at,updated_at,resolved_at) VALUES('upgrade-closed','upgrade-project','upgrade-contact',1,10,30,30),('upgrade-open','upgrade-project','upgrade-contact',1,10,20,NULL)");
   await sql("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('upgrade-answer','upgrade-project','upgrade-closed','closed','historical-operator','operator','Preserve closed reply café',1,20),('upgrade-question','upgrade-project','upgrade-open','open','upgrade-contact','contact','Preserve open question 日本語',1,20)");
   await sql("INSERT INTO conversation_notes(id,conversation_id,user_id,content,created_at) VALUES('upgrade-note','upgrade-open','upgrade-agent','Retained private note',21)");
   for(const [id,message] of [['upgrade-public','upgrade-question'],['upgrade-private',null]]){
    await sql('INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,'upgrade-project','upgrade-open','upgrade-agent',id,id+'.txt','text/plain',id.length,message,22]);
    await storage.inspect({key:id,bytes:[...Buffer.from(id)]});
   }
   await seedHistoryUpgrade(storage);before=await snapshot(storage);
  });
  for(const migration of complete.slice(cutoff))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
   const after=await snapshot(storage);
   for(const [table,rows] of Object.entries(before.rows)){
    if(['d1_migrations','sqlite_sequence'].includes(table))continue;
    const current=after.rows[table].map(JSON.parse);
    for(const serialized of rows){const old=JSON.parse(serialized);assert.ok(current.some(row=>Object.entries(old).every(([key,value])=>row[key]===value)),`upgrade retains every prior field in ${table}`);}
   }
   assert.deepEqual(after.objects,before.objects,'upgrade retains every native file byte and metadata');
   // Snapshot rows are sorted by serialized values, not by the native ledger's
   // numeric id. Read its actual application order before comparing the plan.
   const names=(await storage.inspect({sql:'SELECT name FROM d1_migrations ORDER BY id'})).results.map(row=>row.name);
   assert.deepEqual(names,complete.map(m=>m.name),'native upgrade retains its prior ledger and applies exactly the missing migrations in order');
  });
  await attachmentSchemaUpgrade(runtime,complete.find(m=>m.name==='257_move_in_attachment_bytes.sql'),async()=>{
   const login=await passwordSession(runtime,email,password,'upgrade-project');assert.equal(login.actor.id,'upgrade-agent');
   const response=await fetch(runtime.origin+'/api/conversations/upgrade-open/messages',{headers:{Authorization:'Bearer '+login.token}});assert.equal(response.status,200);assert.ok((await response.json()).messages.some(row=>row.content==='Preserve open question 日本語'));
   await verifyHistoryUpgrade(runtime,login.token);
  });
 }finally{if(runtime)await runtime.close();await rm(scratch,{recursive:true,force:true});}
}
