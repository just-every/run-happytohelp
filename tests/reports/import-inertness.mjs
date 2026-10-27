import {runSteps} from '../journeys/kit/steps.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from '../move-in/harness.mjs';
import {generate} from '../move-in/generator.mjs';
const base='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const tables=['message_authorship','conversation_tracking','conversation_handoffs','conversation_resolutions','conversation_ratings','conversation_rating_history','reporting_legacy_conversations'];
async function imported(h){const run=(await h.call(base+'?vendor=intercom',{method:'POST',headers:{'X-Import-Filename':'ratings-safety.jsonl','X-Import-Schema':'2.16'},body:generate('intercom',1)})).data;await h.drain();const ready=(await h.call(base+'/'+run.id)).data;await h.call(base+'/'+run.id+'/apply',post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(base+'/'+run.id)).data.state,'completed');for(const table of tables)assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,'import remains inert: '+table);return {run,conversation:await h.db.prepare('SELECT * FROM conversations').first(),message:await h.db.prepare('SELECT * FROM messages ORDER BY revision DESC LIMIT 1').first()}}

test("import undo journey: imported history stays inert and every native outcome ledger blocks destructive undo",()=>runSteps([
  ['Move in and complete undo never create native outcome, rating or authorship rows',async()=>{const h=await nativeHarness();try{const {run}=await imported(h);await h.call(base+'/'+run.id+'/undo',post({}));await h.drain();assert.equal((await h.call(base+'/'+run.id)).data.state,'undone');for(const table of tables)assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);assert.equal(h.outbound,0)}finally{await h.close()}}],
  ['native custody blocks import undo without a revision bump for every outcome ledger',()=>runSteps(['authorship','tracking','handoff','resolution and ratings','legacy marker'].map(kind=>[kind,async()=>{const h=await nativeHarness();try{const {run,conversation:c,message:m}=await imported(h);
 if(kind==='authorship')await h.db.prepare("INSERT INTO message_authorship VALUES(?,'p','unknown','native-audit',NULL,NULL,1)").bind(m.id).run();
 if(kind==='tracking')await h.db.prepare("INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_at) VALUES(?,'p',0,0,1)").bind(c.id).run();
 if(kind==='handoff')await h.db.prepare("INSERT INTO conversation_handoffs VALUES('handoff','p',?,'owner',?,1,0)").bind(c.id,c.revision).run();
 if(kind==='resolution and ratings'){await h.db.prepare("INSERT INTO conversation_resolutions VALUES('resolution','p',?,?,1,1,?,0,'unknown','{}',NULL)").bind(c.id,c.contact_id,c.revision).run();await h.db.prepare("INSERT INTO conversation_ratings VALUES('resolution',1,'Native rating',2,1)").run();await h.db.prepare("INSERT INTO conversation_rating_history VALUES('history','resolution',1,'Native rating',2,1)").run()}
 if(kind==='legacy marker')await h.db.prepare("INSERT INTO reporting_legacy_conversations VALUES('p',?,'native-custody')").bind(c.id).run();
 const before={};for(const table of tables)before[table]=(await h.db.prepare('SELECT * FROM '+table).all()).results;
 await h.call(base+'/'+run.id+'/undo',post({}));await h.drain();const state=(await h.call(base+'/'+run.id)).data;assert.equal(state.state,'undoing');assert.equal(state.error,'NATIVE_EDIT_CONFLICT');assert.deepEqual(await h.db.prepare('SELECT * FROM conversations WHERE id=?').bind(c.id).first(),c);for(const table of tables)assert.deepEqual((await h.db.prepare('SELECT * FROM '+table).all()).results,before[table]);assert.equal(h.outbound,0)
 }finally{await h.close()}}]))]
]));
