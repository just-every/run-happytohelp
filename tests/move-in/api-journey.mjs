import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {startVendor} from '../helpers/move-in-vendors/index.mjs';
const imports='/api/move-in/projects/p/imports',connections='/api/move-in/projects/p/import-connections';
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

/** One HTTP provider edge, real owner routes, persisted queue checkpoints and native read doors. */
export async function apiVendorJourney(vendor,count=305){
 const fixture=await startVendor(vendor,{tickets:count}),vars={[`MOVE_IN_${vendor.toUpperCase()}_BASE_URL`]:fixture.baseUrl,MOVE_IN_HELPSCOUT_DOCS_BASE_URL:fixture.baseUrl},h=await nativeHarness({vars,vendorOrigin:fixture.baseUrl});
 const connect=token=>h.raw(connections,post({vendor,domain:'fixture',email:fixture.email,token,docsToken:fixture.docsToken}));
 const state=async id=>(await h.call(`${imports}/${id}`)).data;
 const apply=async run=>{assert.equal(run.state,'ready',JSON.stringify({state:run.state,error:run.error}));assert.equal(run.plan.counts.rejected,0,JSON.stringify(run.plan.decisions.filter(d=>d.rejection).slice(0,8)));await h.call(`${imports}/${run.id}/apply`,post({fingerprint:run.plan.fingerprint}));await h.drain();const done=await state(run.id);assert.equal(done.error,null);assert.equal(done.state,'completed');return done};
 try{
  for(const [token,status,reason] of [[fixture.wrongToken,401,/token|credential/i],[fixture.scopeToken,403,/permission|scope/i],[fixture.rateToken,429,/Retry-After|rate limit/i]]){const result=await connect(token);assert.equal(result.response.status,status,JSON.stringify(result.data));assert.match(JSON.stringify(result.data),reason);assert.equal((await h.db.prepare('SELECT count(*) n FROM move_in_credentials').first()).n,0)}
  const started=await connect(fixture.token);assert.equal(started.response.status,201,JSON.stringify(started.data));assert.equal(JSON.stringify(started.data).includes(fixture.token),false);await h.drain();let ready=await state(started.data.data.id);assert.equal(ready.error,null);assert.equal(ready.api.counts.tickets,count);assert.ok(ready.api.counts.agents>=5);assert.ok(ready.api.counts.companies>0);assert.ok(ready.api.counts.articles>0);assert.ok(ready.api.agents.some(a=>a.deleted));assert.equal(ready.api.cutover,false);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations').first()).n,0,'preview creates no live tickets');
  const agent=ready.api.agents.find(a=>!a.deleted);const mapping=Object.fromEntries(ready.api.agents.map(a=>[a.id,a.id===agent.id?'owner':null]));await h.call(`${imports}/${ready.id}/agents`,post({mapping}));await h.drain();ready=await state(ready.id);const first=await apply(ready);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations').first()).n,count);assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations WHERE assigned_to IS NOT NULL').first()).n,0,'mapping stays inert');
  assert.ok((await h.db.prepare('SELECT count(*) n FROM move_in_notes').first()).n>0);assert.equal((await h.db.prepare('SELECT count(*) n FROM media').first()).n,Math.min(count,45)-(count>=45?1:0));
  if(count>=45){assert.ok(first.api.attachmentFailures.some(f=>f.ticketId==='45'&&f.filename==='evidence-45.txt'));const large=await h.db.prepare("SELECT * FROM media WHERE filename='large-evidence.bin'").first();assert.equal(large.size,8*1024*1024);const file=await h.files;const source=await file.get(large.object_key);assert.equal((await source.arrayBuffer()).byteLength,large.size)}
  fixture.change({at:Date.now()+1000});fixture.stopAfter(3,{status:503});const delta=(await h.call(`${connections}/${first.api.connectionId}/sync`,post({}))).data;await h.drain();const stopped=await state(delta.id);assert.ok(stopped.error);const cursor=stopped.cursor;fixture.clearFaults();await h.call(`${imports}/${delta.id}/resume`,post({}));await h.drain();let final=await state(delta.id);assert.equal(final.error,null);assert.ok(final.cursor>=cursor);assert.ok(final.api.counts.tickets<=3,'final sync fetches changed tickets only');
  // Stop a real Worker during publication; the same reviewed delta resumes once.
  await h.call(`${imports}/${final.id}/apply`,post({fingerprint:final.plan.fingerprint}));await h.step();await h.crashDuringStep();await h.call(`${imports}/${final.id}/resume`,post({}));await h.drain();final=await state(final.id);assert.equal(final.error,null);assert.equal(final.state,'completed');assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations').first()).n,count+1);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM (SELECT id FROM messages GROUP BY id HAVING count(*)>1)').first()).n,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM (SELECT id FROM media GROUP BY id HAVING count(*)>1)').first()).n,0);
  assert.ok(final.api.channels.every(channel=>channel.instructions.length>0));await h.call(`${imports}/${final.id}/cutover`,post({confirmed:true}));assert.ok((await state(final.id)).api.cutover);assert.ok((await h.db.prepare("SELECT count(*) n FROM conversations WHERE assigned_to='owner'").first()).n>0);
  const audit=await h.db.prepare("SELECT action FROM audit_events WHERE action LIKE 'import.%'").all();assert.ok(audit.results.some(r=>r.action==='import.connected'));assert.ok(audit.results.some(r=>r.action==='import.cutover'));
  assert.equal(h.outbound,0,'no mail, webhook, model or notification delivery');assert.deepEqual(fixture.violations,[]);
 }finally{await h.close();await fixture.close()}
}

export async function apiMoveInJourney(){for(const vendor of ['zendesk','intercom','helpscout','freshdesk'])await apiVendorJourney(vendor)}
