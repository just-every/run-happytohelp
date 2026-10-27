import {attachmentSchemaUpgrade} from './upgrade-attachments.mjs';
import {validateStoredSearch} from '../helpers/search-index.mjs';
import {localMailMigrations,localMailTables} from '../first-run/inventory.mjs';
import {integrationMigrations,integrationTables} from '../connections/inventory.mjs';
import {importEvolutionMigrations,importEvolutionTables,importRuntimeMigrations,importRuntimeTables} from '../helpers/base-import-evolution.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {readArtifact} from '../helpers/artifact-payloads.mjs';
import {recoveryRuntime} from '../helpers/recovery/runtime.mjs';
import {snapshot} from '../helpers/recovery/snapshot.mjs';
import {m9Migrations} from '../helpers/recovery/m9-inventory.mjs';
import {createHash} from 'node:crypto';
import {seedCategoryUpgrade,assertCategoryUpgrade} from './upgrade-categories.mjs';
import {knowledgeUpgradeDefaults,assertKnowledgeHistoryBackfill} from '../helpers/knowledge/upgrade.mjs';
import {assertReferenceUpgrade} from '../helpers/knowledge/reference-upgrade.mjs';
import {expectedSchema} from '../helpers/upgrade-schema-expectations.mjs';

// A packaged install populated before the outcome, integration, mail and import stages upgrades in place; every prior row and file is kept.
export async function priorSchemaUpgrade(){
const artifact=await readArtifact('delivery-artifact/happytohelp-worker-artifact.json');
const completeMigrations=artifact.deploymentSpec.migrations;
assert.deepEqual(completeMigrations.filter(m=>importRuntimeMigrations.includes(m.name)).map(m=>m.name),importRuntimeMigrations);
assert.deepEqual(completeMigrations.filter(m=>integrationMigrations.includes(m.name)).map(m=>m.name),integrationMigrations);
// Apply the historical outcome stage before later additive migrations.
const end=Math.max(...m9Migrations.map(name=>completeMigrations.findIndex(m=>m.name===name)));
const migrations=completeMigrations.slice(0,end+1);
const stagedNames=new Set([...migrations.map(m=>m.name),...integrationMigrations,...importEvolutionMigrations,...localMailMigrations,...importRuntimeMigrations]);
const remaining=completeMigrations.filter(m=>!stagedNames.has(m.name));
// Columns the additional stages add to existing tables; every other part of those tables' schema must stay as it was.
// Triggers an additional stage drops and recreates (import-kit's retirement transition); each must end exactly as that stage declares.
const replacedTriggers=new Map(remaining.flatMap(m=>[...m.sql.matchAll(/DROP TRIGGER IF EXISTS (\w+);\s*(CREATE TRIGGER \1 [\s\S]*?END);/g)].map(([,name,sql])=>[name,sql])));
const addedColumns=remaining.flatMap(m=>[...m.sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN ([^;]+);/gi)].map(([,table,column])=>({table,column:column.trim()})));
const original=migrations.filter(m=>!m9Migrations.includes(m.name));
const directory=await mkdtemp(join(tmpdir(),'reports-upgrade-'));
let runtime;
try {
  artifact.deploymentSpec.migrations=original;
  runtime=await recoveryRuntime(artifact,{directory:join(directory,'runtime'),port:18370,inspectorPort:18371,variables:{}});
  artifact.deploymentSpec.migrations=migrations;
  let before,after;
  await runtime.withStorage(async storage=>{
    await storage.inspect({sql:"INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('upgrade-project','Upgrade','upgrade-widget','https://upgrade.example.test',1)"});
    await storage.inspect({sql:"INSERT INTO contacts(id,project_id,created_at) VALUES('upgrade-contact','upgrade-project',1)"});
    await storage.inspect({sql:"INSERT INTO conversations(id,project_id,contact_id,revision,created_at,updated_at,resolved_at) VALUES('upgrade-closed','upgrade-project','upgrade-contact',1,10,30,30),('upgrade-open','upgrade-project','upgrade-contact',1,10,20,NULL)"});
    await storage.inspect({sql:"INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('upgrade-answer','upgrade-project','upgrade-closed','closed','historical-operator','operator','Preserve closed reply café',1,20),('upgrade-question','upgrade-project','upgrade-open','open','upgrade-contact','contact','Preserve open question 日本語',1,20)"});
    before=await snapshot(storage);
  });
  for(const migration of migrations.filter(m=>m9Migrations.includes(m.name)))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    after=await snapshot(storage);
    for(const [name,rows] of Object.entries(before.rows)) {
      if(name==='d1_migrations')assert.deepEqual(after.rows[name].filter(row=>!m9Migrations.includes(JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence') {
        // SQLite's own ledger sequence grows by the four genuine applied migrations.
        const previous=rows.map(JSON.parse),next=after.rows[name].map(JSON.parse);
        assert.deepEqual(previous.find(row=>row.name==='d1_migrations'),{name:'d1_migrations',seq:original.length});
        assert.deepEqual(next.find(row=>row.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length});
        assert.deepEqual(next.filter(row=>row.name!=='d1_migrations'),previous.filter(row=>row.name!=='d1_migrations'));
      } else assert.deepEqual(after.rows[name],rows,'every existing row retained: '+name);
    }
    for(const entry of before.schema) {
      // A110 deliberately adds only the native import fence to these two
      // pre-existing trigger bodies; every other prior definition is exact.
      const fenceActor={context_message_added:'NEW',context_message_removed:'OLD'}[entry.name];
      const expected=fenceActor ? {...entry,sql:entry.sql.replace(' BEGIN ',` WHEN NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=${fenceActor}.project_id AND f.conversation_id=${fenceActor}.conversation_id) BEGIN `)} : entry;
      assert.deepEqual(after.schema.find(candidate=>candidate.name===entry.name),expected,'prior schema with exact A110 fence only: '+entry.name);
    }
    const ledger=after.rows.d1_migrations.map(JSON.parse).sort((a,b)=>a.id-b.id);
    assert.deepEqual(ledger.slice(original.length).map(row=>row.name),m9Migrations);
    assert.deepEqual(ledger.map(row=>row.name),[...original.map(m=>m.name).sort((a,b)=>parseInt(a,10)-parseInt(b,10)),...m9Migrations]);
    assert.equal((await storage.inspect({sql:"SELECT outcome FROM conversation_resolutions WHERE conversation_id='upgrade-closed'"})).results[0].outcome,'unknown');
    assert.equal((await storage.inspect({sql:"SELECT first_resolved_at FROM conversation_tracking WHERE conversation_id='upgrade-closed'"})).results[0].first_resolved_at,null);
  });
  for(const migration of completeMigrations.filter(m=>integrationMigrations.includes(m.name)))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    const integrated=await snapshot(storage);
    for(const [name,rows] of Object.entries(after.rows)){
      if(name==='d1_migrations')assert.deepEqual(integrated.rows[name].filter(row=>!integrationMigrations.includes(JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence'){
        const previous=rows.map(JSON.parse),next=integrated.rows[name].map(JSON.parse);
        assert.deepEqual(previous.find(row=>row.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length});
        assert.deepEqual(next.find(row=>row.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length+integrationMigrations.length});
        assert.deepEqual(next.filter(row=>row.name!=='d1_migrations'),previous.filter(row=>row.name!=='d1_migrations'));
      }else assert.deepEqual(integrated.rows[name],rows,'C preserves all B rows: '+name);
    }
    for(const entry of after.schema)assert.deepEqual(integrated.schema.find(candidate=>candidate.name===entry.name),entry,'C preserves every B schema definition: '+entry.name);
    for(const table of integrationTables.filter(name=>name!=='integration_authority_epoch'))assert.equal(integrated.rows[table].length,0,'upgrade emits no historical integration events: '+table);
    assert.deepEqual(integrated.rows.integration_authority_epoch.map(JSON.parse),[{id:1,revision:0}]);
  });
  // Base 7e31 is a separate additive stage after the unchanged C ledger proof.
  let priorEvolution;
  await runtime.withStorage(async storage=>{
    await storage.inspect({sql:"INSERT INTO ik_jobs(id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,plan_json,state,total) VALUES('prior-kit-job','upgrade-project','intercom','prior-map','prior-owner','prior-fingerprint','prior-operation','{\"retained\":\"original prior plan\"}','completed',0)"});
    await storage.inspect({sql:"INSERT INTO ik_original_sets VALUES('prior-kit-job',1)"});
    await storage.inspect({sql:"INSERT INTO ik_originals VALUES('prior-kit-job','artifact','prior-original','original.txt','prior-hash',3,X'0001FF')"});
    priorEvolution=await snapshot(storage);
  });
  for(const migration of completeMigrations.filter(m=>importEvolutionMigrations.includes(m.name)))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    const latest=await snapshot(storage);assert.deepEqual(Object.keys(latest.rows).sort(),[...Object.keys(priorEvolution.rows),...importEvolutionTables].sort());
    const defaults={reversal_policy:'strict',reversal_policy_hash:null,reversal_cursor:0,reversal_hash:createHash('sha256').update(JSON.stringify([])).digest('hex')};
    for(const [name,rows] of Object.entries(priorEvolution.rows)){
      if(name==='d1_migrations')assert.deepEqual(latest.rows[name].filter(row=>!importEvolutionMigrations.includes(JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence'){const old=rows.map(JSON.parse),next=latest.rows[name].map(JSON.parse);assert.deepEqual(old.find(r=>r.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length+integrationMigrations.length});assert.deepEqual(next.find(r=>r.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length+integrationMigrations.length+importEvolutionMigrations.length});assert.deepEqual(next.filter(r=>r.name!=='d1_migrations'),old.filter(r=>r.name!=='d1_migrations'));}
      else if(name==='ik_jobs')assert.deepEqual(latest.rows[name].map(JSON.parse),rows.map(row=>({...JSON.parse(row),...defaults})));
      else assert.deepEqual(latest.rows[name],rows,'Base evolution preserves original custody and native rows: '+name);
    }
    for(const name of importEvolutionTables)assert.deepEqual(latest.rows[name],[]);
    for(const entry of priorEvolution.schema){if(entry.name==='ik_jobs')continue;assert.deepEqual(latest.schema.find(row=>row.name===entry.name),entry,'Base evolution preserves every other schema definition: '+entry.name)}
  });
  let beforeLocalMail;
  await runtime.withStorage(async storage=>{beforeLocalMail=await snapshot(storage)});
  for(const migration of completeMigrations.filter(m=>localMailMigrations.includes(m.name)))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    const current=await snapshot(storage);assert.deepEqual(Object.keys(current.rows).sort(),[...Object.keys(beforeLocalMail.rows),...localMailTables].sort());
    for(const [name,rows] of Object.entries(beforeLocalMail.rows)){
      if(name==='d1_migrations')assert.deepEqual(current.rows[name].filter(row=>!localMailMigrations.includes(JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence'){const old=rows.map(JSON.parse),next=current.rows[name].map(JSON.parse);assert.deepEqual(old.find(r=>r.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length+integrationMigrations.length+importEvolutionMigrations.length});assert.deepEqual(next.find(r=>r.name==='d1_migrations'),{name:'d1_migrations',seq:migrations.length+integrationMigrations.length+importEvolutionMigrations.length+localMailMigrations.length});assert.deepEqual(next.filter(r=>r.name!=='d1_migrations'),old.filter(r=>r.name!=='d1_migrations'));}
      else assert.deepEqual(current.rows[name],rows,'local mail preserves all prior rows: '+name);
    }
    for(const entry of beforeLocalMail.schema)assert.deepEqual(current.schema.find(row=>row.name===entry.name),entry,'local mail preserves prior schema: '+entry.name);
    assert.deepEqual(current.rows.rer_mail_development_outbox,[]);
  });
  let beforeRuntime;
  await runtime.withStorage(async storage=>{beforeRuntime=await snapshot(storage)});
  for(const migration of completeMigrations.filter(m=>importRuntimeMigrations.includes(m.name)))await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    const current=await snapshot(storage);
    assert.deepEqual(Object.keys(current.rows).sort(),[...Object.keys(beforeRuntime.rows),...importRuntimeTables].sort());
    for(const [name,rows] of Object.entries(beforeRuntime.rows)){
      if(name==='d1_migrations')assert.deepEqual(current.rows[name].filter(row=>!importRuntimeMigrations.includes(JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence')assert.deepEqual(current.rows[name].map(JSON.parse).filter(row=>row.name!=='d1_migrations'),rows.map(JSON.parse).filter(row=>row.name!=='d1_migrations'));
      else assert.deepEqual(current.rows[name],rows,'runtime closure preserves prior rows and original bytes: '+name);
    }
    for(const entry of beforeRuntime.schema)assert.deepEqual(current.schema.find(row=>row.name===entry.name),entry,'runtime closure preserves prior schema: '+entry.name);
    assert.deepEqual(current.rows.d1_migrations.map(JSON.parse).slice(-importRuntimeMigrations.length).map(row=>row.name),importRuntimeMigrations);
  });
  // Later stages retain all prior data, including article publication state.
  let beforeAdditional,final;
  await runtime.withStorage(async storage=>{await seedCategoryUpgrade(storage);beforeAdditional=await snapshot(storage)});
  for(const migration of remaining)await writeFile(join(runtime.directory,'migrations',migration.name),migration.sql);
  const additionalStartedAt=Date.now();
  await runtime.run(['d1','migrations','apply','DB','--local','--persist-to','.wrangler/state']);
  await runtime.withStorage(async storage=>{
    final=await snapshot(storage);
    const additionalFinishedAt=Date.now();
    for(const [name,rows]of Object.entries(beforeAdditional.rows)){
      if(name==='d1_migrations')assert.deepEqual(final.rows[name].filter(row=>!remaining.some(m=>m.name===JSON.parse(row).name)),rows);
      else if(name==='sqlite_sequence')assert.deepEqual(final.rows[name].map(JSON.parse).filter(row=>row.name!=='d1_migrations'),rows.map(JSON.parse).filter(row=>row.name!=='d1_migrations'));
      else {
        // Mail, ticket, erasure and knowledge additions retain every original field.
        // M122 and M130/M132 add the declared
        // email, ticket and erasure defaults. Compare canonical full rows so
        // unexpected columns and changes to any original value still fail.
        const expected=rows.map(serialized=>{
          const row=knowledgeUpgradeDefaults(name,JSON.parse(serialized));
          if(name==='messages')row.content_raw=null;
          if(name==='contact_erasures')row.ticket_records=0;
          if(name==='conversations'){
            const status=row.resolved_at!==null?'solved':row.revision>0?'open':'new';
            Object.assign(row,{status_id:status,status_category:status,subject:'',priority:'normal',channel:beforeAdditional.rows.inbound_emails.map(JSON.parse).some(email=>email.conversation_id===row.id)?'email':'widget',brand_id:row.project_id,group_id:null,requester_id:row.contact_id,submitter_id:row.contact_id,submitter_type:'contact',ticket_version:0,ticket_actor_id:null,ticket_actor_type:'system',ticket_source:'system',mailbox_id:null});
          }
          return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])));
        }).sort();
        assert.deepEqual(final.rows[name],expected,'additional stages preserve every prior row: '+name);
      }
    }
    for(const entry of beforeAdditional.schema){
      const current=final.schema.find(candidate=>candidate.name===entry.name),added=addedColumns.filter(a=>a.table===entry.name);
      // Category creation no longer invalidates articles. Deletion now scopes
      // invalidation to linked ancestry; its behavior is exercised below on D1.
      if(replacedTriggers.has(entry.name)){
        assert.deepEqual({...current,sql:entry.sql},entry,'a replaced trigger keeps its table: '+entry.name);
        assert.equal(current.sql,replacedTriggers.get(entry.name),'a replaced trigger is exactly what its stage declares: '+entry.name);
        continue;
      }
      if(entry.name==='edition_category_insert'){
        assert.equal(current,undefined,'category creation has no blanket invalidation trigger');
        continue;
      }
      // Migration 181 redefines the message context trigger to reach its contact and author through the subject key.
      if(entry.name==='context_message_added'){
        assert.ok(current?.sql.includes('subject_id IN (SELECT contact_id FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id UNION SELECT NEW.actor_id)'),'the message context trigger reaches its subjects through the key');
        assert.deepEqual({...current,sql:entry.sql},entry,'the message context trigger keeps its schema identity');
        continue;
      }
      if(entry.name==='edition_category_delete'){
        assert.ok(current,'category deletion retains its invalidation trigger');
        assert.deepEqual({...current,sql:entry.sql},entry,'category deletion retains its schema identity');
        continue;
      }
      // M195 changes exactly three whitespace boundaries for native restore and
      // M241 only excludes the away reply. Use the same explicit expectation as
      // the released-install upgrade; every other character and property still has to match.
      if(entry.name==='conversation_record_resolution'&&remaining.some(m=>m.name==='195_restore_trigger_boundaries.sql')){
        assert.deepEqual(expectedSchema({[entry.name]:entry},{[entry.name]:current},remaining.map(m=>m.name)),[],'resolution trigger retains its exact schema except the three restore boundaries and the away reply exclusions');
        continue;
      }
      for(const {column} of added)assert.ok(current.sql.includes(', '+column),'additional stage adds '+column+' to '+entry.name);
      assert.deepEqual({...current,sql:added.reduce((sql,{column})=>sql.replace(', '+column,''),current.sql)},entry,'additional stages preserve prior schema: '+entry.name);
    }
    assert.deepEqual(final.rows.d1_migrations.map(JSON.parse).map(row=>row.name).sort(),completeMigrations.map(m=>m.name).sort(),'the actual final migration ledger is complete');
    const search=await validateStoredSearch(storage.inspect),derived=new Set(search?[search.table,...search.shadows]:[]);
    if(search){
      const canonical=row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));
      const expected=final.rows.messages.map(value=>{const {content,conversation_id,project_id}=JSON.parse(value);return canonical({content,conversation_id,project_id})}).sort();
      assert.deepEqual(final.rows[search.table],expected,'the new search projection contains exactly the retained messages');
    }
    for(const table of Object.keys(final.rows).filter(name=>!Object.hasOwn(beforeAdditional.rows,name)&&!derived.has(name))){
      if(table==='knowledge_article_history'){assertKnowledgeHistoryBackfill(final.rows[table],beforeAdditional.rows.knowledge_articles);continue;}
      if(assertReferenceUpgrade(table,final.rows[table],beforeAdditional.rows,final.rows,additionalStartedAt,additionalFinishedAt))continue;
      let expected=[];
      if(table==='ticket_statuses'){
        const statuses=[['new','New'],['open','Open'],['pending','Pending'],['on_hold','On-hold'],['solved','Solved'],['closed','Closed']];
        expected=beforeAdditional.rows.projects.flatMap(serialized=>{
          const project=JSON.parse(serialized);
          return statuses.map(([id,name])=>{
            const actual=final.rows[table].map(JSON.parse).find(row=>row.project_id===project.id&&row.id===id);
            assert.ok(actual,'upgrade seeds the default ticket status: '+project.id+'/'+id);
            assert.ok(Number.isInteger(actual.updated_at)&&actual.updated_at>=Math.floor(additionalStartedAt/1000)*1000&&actual.updated_at<=additionalFinishedAt,'default ticket status is timestamped during migration');
            const row={project_id:project.id,id,name,category:id,is_default:1,active:1,updated_at:actual.updated_at};
            return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])));
          });
        }).sort();
      }
      // Every workspace gets the published default Solved->Closed rule (migration 152) and its first immutable version.
      if(table==='workflow_rules'||table==='workflow_rule_versions'){
        const definition={name:'Close solved tickets after 4 days',kind:'time',position:1000,conditions:{all:[{field:'status_category',op:'eq',value:'solved'}],any:[]},time:{field:'solved_at',hours:96},actions:[{type:'status',status_id:'closed'}]};
        expected=beforeAdditional.rows.projects.map(serialized=>{
          const project=JSON.parse(serialized),id='workflow:auto-close:'+project.id;
          const actual=final.rows[table].map(JSON.parse).find(row=>(row.id??row.rule_id)===id);
          assert.ok(actual,'upgrade seeds the default close rule: '+project.id+'/'+table);
          const at=table==='workflow_rules'?actual.created_at:actual.published_at;
          assert.ok(Number.isInteger(at)&&at>=Math.floor(additionalStartedAt/1000)*1000&&at<=additionalFinishedAt,'default close rule is timestamped during migration');
          assert.deepEqual(JSON.parse(table==='workflow_rules'?actual.draft_json:actual.definition_json),definition,'default close rule definition');
          const row=table==='workflow_rules'
            ?{id,project_id:project.id,name:definition.name,kind:'time',position:1000,state:'published',draft_json:actual.draft_json,published_version:1,owner_id:'system',created_at:at,updated_at:at}
            :{rule_id:id,project_id:project.id,version:1,definition_json:actual.definition_json,published_by:'system',published_at:at,event_after_id:0};
          return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])));
        }).sort();
      }
      assert.deepEqual(final.rows[table],expected,'additive upgrade starts without fabricated user data: '+table);
    }
  });
  await assertCategoryUpgrade(runtime.directory);
  artifact.deploymentSpec.migrations=completeMigrations;
  await attachmentSchemaUpgrade(runtime,completeMigrations.find(m=>m.name==='257_move_in_attachment_bytes.sql'));
  await runtime.start();const health=await fetch(runtime.origin+'/health');assert.equal(health.status,200);await runtime.close();
  const receipt={oldTables:Object.keys(before.rows).length,newTables:Object.keys(after.rows).length,oldMigrations:original.length,newMigrations:migrations.length,finalTables:Object.keys(final.rows).length,finalMigrations:final.rows.d1_migrations.length,added:completeMigrations.filter(m=>!original.some(old=>old.name===m.name)).map(m=>m.name),checks:['real native Wrangler prior ledger and append-only apply','every original row retained','SQLite ledger sequence growth only','prior schema exact except two specified A110 trigger fences','historical unknown outcome','unknown first resolution retained','Base strict defaults and exact prior original bytes retained','additional stages retain every row and prior schema except added columns and category insert/delete trigger evolution','upgraded category create/delete preserves unrelated article state','upgraded linked and ancestor deletion invalidates primary and additional category article revisions','actual emitted Worker health after upgrade']};
  if(process.env.H2H_EVIDENCE_DIR){await mkdir(resolve(process.env.H2H_EVIDENCE_DIR),{recursive:true});await writeFile(join(resolve(process.env.H2H_EVIDENCE_DIR),'upgrade.json'),JSON.stringify(receipt,null,2)+'\n')}
  console.log(JSON.stringify(receipt));
}finally{artifact.deploymentSpec.migrations=completeMigrations;if(runtime)await runtime.close();await rm(directory,{recursive:true,force:true});}

}
