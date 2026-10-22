import {migrationStatements} from './helpers/migration-statements.mjs';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Node has no Workers runtime module; the demo guard reads only RER_DEMO from it, which is off here.
registerHooks({resolve(specifier, context, next) { if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env={}', shortCircuit: true }; if (specifier.startsWith('.') && context.parentURL) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(url)) return next(url.href, context); } return next(specifier, context); }});
const { demoStories, demoStoryBaselineMessageCounts } = await import('../src/modules/management/demo-inbox-content.ts');
const { demoInbox } = await import('../src/modules/management/demo-inbox.ts');
const { dashboard } = await import('../src/modules/management/dashboard.ts');
const { projects } = await import('../src/modules/management/projects.ts');
const { hashToken } = await import('../src/platform/auth.ts');
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy({persist: false});
try {
  const env = proxy.env, db = env.DB;
  for (const file of ['0001_identity.sql','0002_conversations.sql','0003_identity_credentials.sql','0004_message_intent.sql','0005_widget_identity.sql','0007_conversation_history.sql','0070_management.sql','0071_management_preferences.sql','0080_integrations.sql','0050_knowledge.sql','0060_customer_context.sql','0060_customer_context_engine.sql','020_ai_support.sql','0103_contact_erasure.sql','0110_move_in.sql','111_move_in_identity_audit.sql','112_conversation_outcomes.sql','180_account_security.sql','142_collaboration.sql','143_conversation_actions.sql','153_workflow_schedules.sql','161_suspended_email.sql','240_operator_presence.sql']) {
    for (const sql of migrationStatements(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'))) await db.prepare(sql).run();
  }
  await db.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('original','Original','original-widget','https://original.test',1)").run();
  for (const [user, role] of [['owner','owner'],['other','owner'],['operator','operator'],['admin','admin']]) {
    await db.batch([
      db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(user, user + '@example.test', user),
      db.prepare("INSERT INTO memberships VALUES('original',?,?)").bind(user,role),
      db.prepare("INSERT INTO sessions VALUES(?,?,'original',?,NULL,?,NULL)").bind(await hashToken(user),user,role,Date.now()+999999),
      db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(await hashToken(user),user,Date.now()),
    ]);
  }
  const request = (app,path,token='owner',method='GET') => app.request('https://app.test'+path,{method,headers:token?{Authorization:'Bearer '+token}:{}},env);
  const create = token => request(demoInbox,'/demo-inbox',token,'POST');
  assert.equal((await create('')).status,401);
  for (const token of ['operator','admin']) assert.equal((await create(token)).status,403);
  const responses = await Promise.all(Array.from({length:4},()=>create('owner')));
  for (const response of responses) assert.ok(response.ok, await response.clone().text());
  const created = await Promise.all(responses.map(response=>response.json()));
  const demoId = created[0].id;
  assert.equal(new Set(created.map(result=>result.id)).size,1,'concurrent requests reuse one demo');
  assert.equal((await db.prepare("SELECT count(*) n FROM projects WHERE id LIKE 'demo-%'").first()).n,1);
  assert.match((await db.prepare('SELECT verification_secret FROM projects WHERE id=?').bind(demoId).first()).verification_secret,/^[0-9a-f]{64}$/,'the demo project has a server secret');
  const settings = JSON.parse((await db.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(demoId).first()).settings_json);
  assert.equal(settings.default_visitor_ai_id,`${demoId}-assistant`);
  assert.equal(settings.default_verified_user_ai_id,`${demoId}-assistant`);
  assert.equal((await db.prepare('SELECT count(*) n FROM ai_profiles WHERE project_id=?').bind(demoId).first()).n,1);
  const knowledge = (await db.prepare('SELECT d.* FROM knowledge_documents d JOIN knowledge_datasets k ON k.published_version=d.version_id WHERE k.project_id=?').bind(demoId).all()).results;
  assert.equal(knowledge.length,3);
  assert.ok(knowledge.every(article=>article.content.includes('Fictional Northstar') && article.content.length>300));
  await db.batch([
    db.prepare("UPDATE ai_profiles SET prompt='Owner customized prompt' WHERE id=?").bind(`${demoId}-assistant`),
    db.prepare("UPDATE knowledge_documents SET content='Owner customized article' WHERE id=?").bind(knowledge[0].id),
    db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.default_visitor_ai_id',NULL) WHERE project_id=?").bind(demoId),
  ]);
  await create('owner');
  assert.equal((await db.prepare('SELECT prompt FROM ai_profiles WHERE id=?').bind(`${demoId}-assistant`).first()).prompt,'Owner customized prompt');
  assert.equal((await db.prepare('SELECT content FROM knowledge_documents WHERE id=?').bind(knowledge[0].id).first()).content,'Owner customized article');
  assert.equal(JSON.parse((await db.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(demoId).first()).settings_json).default_visitor_ai_id,null);
  const conversations = (await db.prepare('SELECT * FROM conversations WHERE project_id=?').bind(demoId).all()).results;
  assert.equal(conversations.length,8);
  for (const conversation of conversations) {
    const messages = (await db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY revision').bind(conversation.id).all()).results;
    assert.equal(messages.length,demoStories.some(story=>conversation.id===`${demoId}-${story.key}`)?10:16);
    assert.deepEqual(messages.map(message=>message.revision),messages.map((_,index)=>index+1));
    assert.equal(conversation.revision,messages.length);
    assert.equal(conversation.last_message_id,messages.at(-1).id);
    assert.equal(conversation.updated_at,messages.at(-1).created_at);
    const response = await request(dashboard,`/projects/${demoId}/conversations/${conversation.id}/buckets`);
    assert.equal(response.status,200);
    const buckets = await response.json();
    assert.equal(buckets.data.flatMap(bucket=>bucket.messages).length,messages.length);
    assert.ok(buckets.data.flatMap(bucket=>bucket.messages).every(message=>message.contact || message.agent));
  }
  const counts = await (await request(dashboard,`/projects/${demoId}/conversations/counts`)).json();
  assert.deepEqual(counts.data,{mine:3,open:6,unassigned:3,ai:0,closed:2,unread:6,snoozed:0,suspended:0});
  assert.equal((await request(dashboard,`/projects/${demoId}/conversations/${conversations[0].id}`,'other')).status,404);
  const richIds = ['group-hike','strap-followup'].map(key=>`${demoId}-${key}`);
  const richRows = async () => ({
    messages:(await db.prepare('SELECT * FROM messages WHERE conversation_id IN (?,?) ORDER BY id').bind(...richIds).all()).results,
    notes:(await db.prepare('SELECT * FROM conversation_notes WHERE conversation_id IN (?,?) ORDER BY id').bind(...richIds).all()).results,
    events:(await db.prepare('SELECT * FROM context_tracked_events WHERE project_id=? ORDER BY id').bind(demoId).all()).results,
    buckets:(await db.prepare('SELECT * FROM conversation_buckets WHERE conversation_id IN (?,?) ORDER BY id').bind(...richIds).all()).results,
  });
  const rich = await richRows();
  assert.equal(rich.messages.length,32);
  assert.equal(rich.notes.length,3);
  assert.equal(rich.events.filter(event=>event.type==='PAGE_VIEW').length,14);
  assert.equal(rich.events.filter(event=>event.type==='AGENT_ASSIGNED').length,1);
  assert.equal(rich.buckets.length,2);
  for (const conversationId of richIds) {
    const buckets = await (await request(dashboard,`/projects/${demoId}/conversations/${conversationId}/buckets`)).json();
    assert.equal(buckets.data.length,2);
    assert.deepEqual(buckets.data.map(bucket=>bucket.messages.length).sort((a,b)=>a-b),[7,9]);
    assert.ok(buckets.data.every(bucket=>bucket.events.some(event=>event.type==='PAGE_VIEW')));
    assert.ok(buckets.data.flatMap(bucket=>bucket.events).some(event=>event.type==='INTERNAL_NOTE'));
    assert.equal((await request(dashboard,`/projects/${demoId}/conversations/${conversationId}/buckets`,'other')).status,404);
  }
  await db.batch([
    db.prepare("UPDATE messages SET content='Owner rich message edit' WHERE id=?").bind(rich.messages[0].id),
    db.prepare("UPDATE conversation_notes SET content='Owner note edit' WHERE id=?").bind(rich.notes[0].id),
    db.prepare("UPDATE context_tracked_events SET payload=json_set(payload,'$.url','https://northstar.example/owner-change') WHERE id=?").bind(rich.events.find(event=>event.type==='PAGE_VIEW').id),
  ]);
  const editedRich = await richRows();
  const richRepeats = await Promise.all(Array.from({length:3},()=>create('owner')));
  for (const response of richRepeats) assert.equal(response.status,200);
  assert.deepEqual(await richRows(),editedRich,'rich transcript artifacts and owner edits remain unchanged on repeated concurrent seeding');
  const otherDemo = await (await create('other')).json();
  assert.notEqual(otherDemo.id,demoId);
  await db.prepare("UPDATE messages SET content='Owner edit' WHERE id=?").bind(conversations[0].last_message_id).run();
  assert.equal((await (await create('owner')).json()).id,demoId);
  assert.equal((await db.prepare('SELECT content FROM messages WHERE id=?').bind(conversations[0].last_message_id).first()).content,'Owner edit');
  assert.equal((await db.prepare("SELECT count(*) n FROM conversations WHERE project_id='original'").first()).n,0);
  assert.equal((await db.prepare("SELECT name FROM projects WHERE id='original'").first()).name,'Original');
  for (const table of ['conversation_outbox','ai_generations','context_jobs','identity_tokens']) assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0,table+' stays empty');
  // Reconstruct the shipped version-one transcripts, then exercise the upgrade
  // with both untouched stories and histories the owner has started using.
  for (const story of demoStories) {
    const conversationId = `${otherDemo.id}-${story.key}`, baseline = demoStoryBaselineMessageCounts[story.key];
    const original = await db.prepare('SELECT created_at FROM conversations WHERE id=?').bind(conversationId).first();
    const finished = original.created_at + (baseline-1)*60000;
    await db.batch([
      db.prepare('DELETE FROM messages WHERE conversation_id=? AND revision>?').bind(conversationId,baseline),
      db.prepare('UPDATE conversations SET revision=?,last_message_id=?,updated_at=?,resolved_at=? WHERE id=?').bind(baseline,`${conversationId}-message-${baseline-1}`,finished,'resolved' in story?finished:null,conversationId),
    ]);
  }
  const editedId = `${otherDemo.id}-first-hike`, repliedId = `${otherDemo.id}-delivery`;
  await db.prepare("UPDATE messages SET content='Owner changed the original story' WHERE id=?").bind(`${editedId}-message-0`).run();
  const replied = await db.prepare('SELECT * FROM conversations WHERE id=?').bind(repliedId).first();
  await db.batch([
    db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('owner-reply',?,?,'owner-reply','other','operator','A real owner reply',4,?)").bind(otherDemo.id,repliedId,replied.updated_at+60000),
    db.prepare("UPDATE conversations SET revision=4,last_message_id='owner-reply',updated_at=? WHERE id=?").bind(replied.updated_at+60000,repliedId),
  ]);
  await db.prepare('INSERT INTO conversation_reads(conversation_id,user_id,revision) VALUES(?,?,?)').bind(`${otherDemo.id}-import`,'other',2).run();
  const upgrades = await Promise.all(Array.from({length:3},()=>create('other')));
  for (const response of upgrades) assert.equal(response.status,200);
  assert.equal((await db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').bind(editedId).first()).n,2);
  assert.equal((await db.prepare('SELECT content FROM messages WHERE id=?').bind(`${editedId}-message-0`).first()).content,'Owner changed the original story');
  assert.equal((await db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').bind(repliedId).first()).n,4);
  assert.equal((await db.prepare('SELECT last_message_id FROM conversations WHERE id=?').bind(repliedId).first()).last_message_id,'owner-reply');
  assert.equal((await db.prepare('SELECT revision FROM conversation_reads WHERE conversation_id=? AND user_id=?').bind(`${otherDemo.id}-import`,'other').first()).revision,2,'upgrades preserve existing read markers');
  for (const story of demoStories.filter(story=>!['first-hike','delivery'].includes(story.key))) {
    const conversationId = `${otherDemo.id}-${story.key}`;
    const row = await db.prepare('SELECT * FROM conversations WHERE id=?').bind(conversationId).first();
    const messages = (await db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY revision').bind(conversationId).all()).results;
    assert.equal(messages.length,10,'untouched legacy story upgraded exactly once');
    assert.equal(row.revision,10);
    assert.equal(row.last_message_id,messages.at(-1).id);
    assert.deepEqual(messages.map(message=>message.revision),Array.from({length:10},(_,index)=>index+1));
    const transcript = await (await request(dashboard,`/projects/${otherDemo.id}/conversations/${conversationId}/buckets`,'other')).json();
    assert.equal(transcript.data[0].messages.length,10);
    assert.deepEqual(messages.map(message=>message.content),story.messages.map(message=>message[1]));
  }
  assert.equal((await request(projects,`/projects/${demoId}`,'owner','DELETE')).status,200);
  await db.prepare("CREATE TRIGGER reject_demo_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'intentional test failure'); END").run();
  const beforeFailure = (await db.prepare('SELECT count(*) n FROM projects').first()).n;
  const originalError = console.error;
  let failed;
  try { console.error = () => {}; failed = await create('owner'); } finally { console.error = originalError; }
  assert.equal(failed.status,500);
  assert.equal((await db.prepare('SELECT count(*) n FROM projects').first()).n,beforeFailure,'failed transaction leaves no partial demo project');
  await db.prepare('DROP TRIGGER reject_demo_message').run();
  const replacement = await (await create('owner')).json();
  assert.notEqual(replacement.id,demoId,'deleted demo gets a new project');
  assert.equal((await db.prepare('SELECT count(*) n FROM conversations WHERE project_id=?').bind(demoId).first()).n,8,'deleted history retained');
  assert.equal((await request(dashboard,`/projects/${demoId}/conversations/${conversations[0].id}`)).status,404);
  assert.equal((await db.prepare('SELECT count(*) n FROM conversations WHERE project_id=?').bind(replacement.id).first()).n,8);
  console.log('Demo inbox D1 passed: concurrent idempotence, owner authorization, tenant separation, real transcripts/counts and history events, edit/read preservation, safe upgrades, no queued side effects, deletion/recreation.');
} finally { await proxy.dispose(); }
