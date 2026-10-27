import {upgradeSteps as upgrade0} from './empty-upgrade.mjs';
import {upgradeSteps as upgrade1} from './envelope-upgrade.mjs';
import {upgradeSteps as upgrade2} from './nested-upgrade.mjs';
import {upgradeSteps as upgrade3} from './record-upgrade.mjs';
import {upgradeSteps as upgrade4} from './shape-upgrade.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {assertUnchangedTable} from './equality.mjs';
import {snapshotDatabase} from './snapshot.mjs';

import {step} from './steps.mjs';

test("upgrade: imports recorded before the identity audit upgrade conservatively: prior rows stay byte-equal, old originals are reindexed or fenced, and erasure still holds",async()=>{
 await step('empty-upgrade',upgrade0);
 await step('envelope-upgrade',upgrade1);
 await step('nested-upgrade',upgrade2);
 await step('record-upgrade',upgrade3);
 await step('shape-upgrade',upgrade4);
await step('native additive import migrations preserve prior business rows and their route access',async()=>{let before,beforeRuntime;const h=await nativeHarness({async beforeMoveIn(db,directory){await db.batch([
 db.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('prior-project','Prior workspace','prior-widget','https://prior.example',5)"),
 db.prepare("INSERT INTO users VALUES('prior-owner','prior@example.test','Prior owner',5)"),
 db.prepare("INSERT INTO memberships VALUES('prior-project','prior-owner','owner')"),
 db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at,is_verified,metadata_json) VALUES('prior-contact','prior-project','Prior visitor','visitor@example.test',6,1,'{\"custom\":\"preserve\"}')"),
 db.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,assigned_to,resolved_at,created_at,updated_at) VALUES('prior-conversation','prior-project','prior-contact',1,'prior-message','prior-owner',20,10,20)"),
 db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,citations_json) VALUES('prior-message','prior-project','prior-conversation','prior-local','prior-contact','contact','Existing customer message',1,12,'[]')"),
 db.prepare("INSERT INTO conversation_notes VALUES('prior-note','prior-conversation','prior-owner','Existing private note',15)"),
 db.prepare("INSERT INTO macros VALUES('prior-macro','prior-project','Existing reply','Do not change','prior-owner',10,11)"),
 db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('prior-article','prior-project','existing-guide','Existing guide','Existing published content','published',15)"),
 db.prepare("INSERT INTO magic_signins VALUES('noncredential-digest','prior-owner','prior-project','prior@example.test',9999999999999,NULL)")]);before=(await snapshotDatabase(directory,db)).tables},async afterMoveIn(db,directory){const after=(await snapshotDatabase(directory,db)).tables;for(const [table,rows] of Object.entries(before))assertUnchangedTable(table,rows,after[table]);},async beforeRuntimeUpgrade(db,directory){
 await db.prepare(`INSERT INTO ik_jobs(id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,plan_json,state,total) VALUES('prior-job','prior-project','zendesk','prior-map','prior-owner','prior-fingerprint','prior-operation','{}','completed',0)`).run();
 await db.prepare(`INSERT INTO ik_original_sets VALUES('prior-job',1)`).run();
 await db.prepare(`INSERT INTO ik_originals VALUES('prior-job','artifact','prior-original','original.txt','prior-hash',3,X'0001FF')`).run();
 beforeRuntime=(await snapshotDatabase(directory,db)).tables;
 },async afterRuntimeUpgrade(db,directory){const after=(await snapshotDatabase(directory,db)).tables;for(const [table,rows] of Object.entries(beforeRuntime))assertUnchangedTable(table,rows,after[table]);}
 });try{await h.contactSession('prior-visitor','prior-project','prior-contact');const transcript=await h.call('/api/conversations/prior-conversation/messages',{actor:'prior-visitor'});assert.equal(transcript.messages[0].content,'Existing customer message');assert.equal(h.outbound,0)}finally{await h.close()}});
});
