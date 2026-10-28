import assert from 'node:assert/strict';
import {createHash, pbkdf2Sync, randomBytes} from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const kinds = ['assignment', 'group', 'follower', 'mention', 'customer_updated'];
function api(runtime, token, projectId) {
  return async (path, body, method = body === undefined ? 'GET' : 'POST', absolute = false) => {
    const response = await fetch(runtime.origin + (absolute ? path : `/api/dashboard/projects/${projectId}${path}`), {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    assert.ok(response.ok, `${method} ${path}: ${await response.clone().text()}`);
    const result = await response.json();
    return result.data ?? result;
  };
}

/** Populate native R4 state before the existing every-row/every-object snapshot.
 * Only partner delivery history is synthetic; it never calls a mail provider.
 * The storage owner is opened exclusively while the packaged Worker is stopped. */
export async function seedRecoveryR4(runtime, {owner, visitor, conversation, media, ticket}, prepareStorage) {
  const request = api(runtime, owner.token, owner.projectId);
  const bootstrap = await request('/api/management/bootstrap', undefined, 'GET', true);
  const actorId = bootstrap.currentAgent.id, now = Date.now();
  const ids = Object.fromEntries(['teammate', 'forward', 'reply', 'file', 'identity'].map(kind => [kind, `recovery-r4-${kind}`]));
  const teammateToken = 'synthetic-recovery-r4-teammate-session';
  const teammatePassword = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
  const passwordHash = salt+':'+pbkdf2Sync(teammatePassword,salt,100000,32,'sha256').toString('hex');
  const partnerBytes = [...Buffer.from('Private supplier analysis: retain café and 日本語 bytes.\n')];
  const partnerKey = `${owner.projectId}/partner-replies/${ids.reply}/${ids.file}`;
  await request('/notification-triggers', {triggers: ['request_received', 'ticket_solved'].map(event => ({
    event, channel: '*', brand_id: '*', enabled: false, subject: 'Recovery ticket {{ticket.id}}',
    body: 'Hello {{requester.first_name | there}}, your request remains with the team.', expected_reply_time: 'within one business day',
  }))}, 'PUT');
  await request('/notification-preferences', {preferences: kinds.map(kind => ({kind, inbox: true, email: false}))}, 'PUT');

  await runtime.close();
  await runtime.withStorage(async storage => {
    const write = (sql, values = []) => storage.inspect({sql, values});
    // Retained, informational identity history is portable; it conveys no
    // session or combined customer-history access in the restored install.
    await write('INSERT INTO contacts(id,project_id,name,external_id,created_at) VALUES(?,?,?,?,?)',[ids.identity,owner.projectId,'Recovery identity','synthetic-happytohelp-50',now]);
    const linked=[visitor.contactId,ids.identity].sort();
    await write('INSERT INTO customer_identity_links VALUES(?,?,?,?,?,?)',[owner.projectId,...linked,'synthetic-happytohelp-51',actorId,now]);
    await write('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)', [ids.teammate, 'recovery-teammate@example.test', 'Recovery teammate', now]);
    await write('INSERT INTO credentials VALUES(?,?,?)',[ids.teammate,passwordHash,now]);
    await write('INSERT INTO memberships(project_id,user_id,role) VALUES(?,?,?)', [owner.projectId, ids.teammate, 'operator']);
    await write('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)', [digest(teammateToken), ids.teammate, owner.projectId, 'operator', now + 3_600_000]);
    await write('INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,?,?)', [digest(teammateToken), ids.teammate, 'password', now]);
    for (const kind of kinds) await write('INSERT INTO notification_preferences(project_id,user_id,kind,inbox,email) VALUES(?,?,?,1,0)', [owner.projectId, ids.teammate, kind]);
    await write(`INSERT INTO partner_forwards(id,project_id,conversation_id,actor_id,command_key,intent_hash,recipient,subject,content,message_ids_json,grant_hash,created_at,state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [ids.forward, owner.projectId, conversation.id, actorId, 'recovery-partner-forward', digest('recovery-partner-forward-intent'),
      'supplier@example.test', 'Replacement batch inspection', 'Please review the selected customer-visible evidence.', JSON.stringify([ticket.last_message_id]), digest('synthetic-recovery-partner-reply-grant'), now, 'sent']);
    await write(`INSERT INTO partner_replies(id,project_id,conversation_id,forward_id,receipt_id,local_id,intent_hash,content,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [ids.reply, owner.projectId, conversation.id, ids.forward, 'recovery-partner-inbound-receipt', 'recovery-private-partner-reply', digest('recovery-private-analysis'), 'Private supplier analysis: replacement batch approved.', now + 1]);
    await write(`INSERT INTO partner_reply_files(id,project_id,conversation_id,reply_id,object_key,filename,content_type,size,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [ids.file, owner.projectId, conversation.id, ids.reply, partnerKey, 'supplier-analysis.txt', 'text/plain', partnerBytes.length, now + 1]);
    await storage.inspect({key: partnerKey, bytes: partnerBytes, options: {
      httpMetadata: {contentType: 'text/plain', cacheControl: 'private, no-store'},
      customMetadata: {purpose: 'recovery-private-partner-analysis', fixture: 'synthetic'},
    }});
    if(prepareStorage)await prepareStorage(storage,owner);
  });
  await runtime.start();

  await request(`/conversations/${conversation.id}/followers`, {user_ids: [actorId, ids.teammate]}, 'PUT');
  const definition = {
    title: 'Recovery return instructions', content: 'Hello {{requester.first_name | there}}, retain ticket {{ticket.id}} and its attachment.',
    actions: {reply_type: 'note', attachments: [media.id]},
    scope: {visibility: 'shared', roles: [], groups: [], brands: [owner.projectId]},
  };
  let macro = await request('/macros', definition);
  const apply = async command => {
    const current = await request(`/conversations/${conversation.id}/ticket`);
    const response = await request(`/macros/${macro.id}/apply`, {version: macro.version, command_id: command, tickets: [{id: conversation.id, expected_version: current.ticket_version}]});
    assert.equal(response.results[0].status, 'applied', JSON.stringify(response));
    return response.results[0];
  };
  const first = await apply('recovery-r4-first-macro');
  const note = await request(`/conversations/${conversation.id}/notes`, {
    content: `${first.draft.content}\n@[Recovery teammate](user:${ids.teammate}) please check the private instructions.`, media_ids: first.draft.media_ids,
  });
  assert.equal(note.media.length, 1);
  macro = await request(`/macros/${macro.id}`, {...definition, expected_version: macro.version, title: 'Recovery return instructions, revised', content: definition.content + '\nKeep the final draft for review.'}, 'PUT');
  const draft = await apply('recovery-r4-persisted-macro-draft');
  assert.equal(draft.draft.media.length, 1);

  const duplicate = async text => {
    const created = await request('/api/conversations', {projectId: owner.projectId, contactId: visitor.contactId}, 'POST', true);
    const send = api(runtime, visitor.token, owner.projectId);
    await send(`/api/conversations/${created.id}/messages`, {localId: `recovery-${created.id}`, content: text, expectedRevision: 0}, 'POST', true);
    return request(`/conversations/${created.id}/ticket`);
  };
  const target = await duplicate('Recovery survivor: two reports concern the same replacement.'), source = await duplicate('Recovery duplicate: retain the separate source transcript.');
  const merged = await request(`/conversations/${target.id}/merge`, {source_id: source.id, source_version: source.ticket_version, target_version: target.ticket_version});
  const teammateRequest = api(runtime, teammateToken, owner.projectId);
  const notices = await teammateRequest('/notification-inbox');
  const mention = notices.find(row => row.kind === 'mention' && row.conversation_id === conversation.id);
  assert.ok(mention, 'The native mention must create the persisted teammate notification');
  await teammateRequest(`/notification-inbox/${mention.id}/read`, {}, 'PUT');
  const r4 = {identity:{contactId:visitor.contactId,linkedId:ids.identity},readNoticeId: mention.id, actorId, teammateToken, teammatePassword, teammateId: ids.teammate, macroId: macro.id, draft: draft.draft, noteId: note.id, mergeId: merged.id, mergeTarget: target.id, mergeSource: source.id, partner: {...ids, bytes: partnerBytes}};
  await verifyRecoveryR4(runtime, {owner, conversation, r4}, owner.token);
  return r4;
}

/** Reads supplement the exact snapshot comparison with retained native authority,
 * a usable draft, private notes/partner bytes, notification audience and merge links. */
export async function verifyRecoveryR4(runtime, state, token) {
  const {owner, conversation, r4} = state, request = api(runtime, token, owner.projectId);
  const identity=await request(`/contacts/${r4.identity.contactId}/identity-links`);
  assert.equal(identity.grants_customer_access,false);assert.equal(identity.links[0].contact.id,r4.identity.linkedId);assert.equal(identity.links[0].provenance,'synthetic-happytohelp-51');
  const versions = await request(`/macros/${r4.macroId}/versions`);
  assert.equal(versions.length, 2);
  const usage = await request(`/macros/${r4.macroId}/usage`);
  assert.equal(usage.reduce((count, row) => count + row.uses, 0), 2);
  const draft = await request(`/conversations/${conversation.id}/macro-draft`);
  assert.deepEqual(draft.media, r4.draft.media);
  assert.equal(draft.content, r4.draft.content);
  const collaboration = await request(`/conversations/${conversation.id}/collaboration`);
  assert.ok(collaboration.followers.some(user => user.id === r4.teammateId));
  const buckets = await request(`/conversations/${conversation.id}/buckets`);
  assert.ok(JSON.stringify(buckets).includes(r4.noteId));
  const inbox = await api(runtime, r4.teammateToken, owner.projectId)('/notification-inbox');
  assert.ok(inbox.some(row => row.id === r4.readNoticeId && row.kind === 'mention' && row.conversation_id === conversation.id && row.read_at));
  const merges = await request(`/conversations/${r4.mergeTarget}/merges`);
  assert.ok(merges.some(row => row.id === r4.mergeId && row.source_id === r4.mergeSource));
  const partner = await request(`/conversations/${conversation.id}/partner-forwards`);
  assert.ok(partner.forwards.some(row => row.id === r4.partner.forward));
  assert.ok(partner.replies.some(row => row.id === r4.partner.reply));
  const url = `${runtime.origin}/api/dashboard/projects/${owner.projectId}/conversations/${conversation.id}/partner-files/${r4.partner.file}`;
  const file = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
  assert.equal(file.status, 200);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], r4.partner.bytes);
  assert.equal((await fetch(url)).status, 401);
}
