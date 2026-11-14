import assert from 'node:assert/strict';
import {interruptedErasure} from './upgrade-interrupted-erasure.mjs';

// Released sources an installation may upgrade from, as published in the public
// repository. The 0.3.0 and 0.3 fix-line trees equal the private release sources
// 160aee3f56898ac091097655aaa1c06a802f75c9 and 751c36e3404aa2cf49db8a6b25452393030dc940;
// the 0.4.0 tree equals private 0452618504dd286cfb6a75fabefa279d08bc7428.
// `previous` marks RELEASE.json's previousVersion line, which must receive exactly
// the listed release migrations and keep every prior schema definition.
export const repository = 'https://github.com/just-every/run-happytohelp';
export const baselines = {
  '0.2.1': {commit: '59c6e2e1beb321e9f1cb5493efd05e20fc068638', tree: 'a6d7254014b1ea996b386d765c4c6813b79c3f60', migrations: 37, tables: 97, populate: populate021},
  '0.3.0': {commit: '60e9a84688ea41575d56a8f692bbb8173366c7c5', tree: 'c329b580464b084d1899f7ba77fe52dad7daa091', migrations: 42, populate: populate03},
  '0.3.x': {commit: 'a6dc18da5fa8500ad3607210ecff09aedfecb825', tree: 'b9f889b14b289f7c0bf9df2e99c4bae823dabc8c', migrations: 42, populate: populate03},
  // 0.4.0 keeps the 0.3 API used to populate it.
  '0.4.0': {commit: 'ee8d38e743fb8b0eb8c9af16b4d178133292d05e', tree: '0b9b6db9198ebde4100e183e5f2ba6bd1f70d882', migrations: 52, tables: 189, populate: populate03},
  // Published 0.4.1 retains the same real population API and schema.
  '0.4.1': {commit: 'dd1ea8c3d085cc4382bde018b095ff4d464a04fb', tree: '73964a643b50f74eb5c0731b58117ce279bcca8f', migrations: 52, tables: 189, populate: populate041},
  '0.4.2': {commit: '7672fb937abdc445d26438ee75b9bdcbd5b901ce', tree: 'e235c979276414c1216906df82a42aac321070bc', migrations: 66, populate: populate03},
  '0.4.3': {commit: '0ad45cd50cf5813eb726ac3ccedf0eda271abc06', tree: '677b0f3e54521108bc336a6c7c0c3a4921993385', migrations: 73, populate: populate03},
  '0.4.4': {commit: '99ffbbea844632d883a46f95df74ef2502cafdc5', tree: '854b431d4449e52e7e85e7e87b016c6a79e17b9d', migrations: 73, populate: populate03},
  '0.4.5': {commit: 'a614393281f71fd604fcfe3eddac3d238f52e10b', tree: '9838e58df00436a6e669809c453021f3be67993a', migrations: 73, populate: populate03},
  '0.4.6': {commit: '14cdfcb01553081c84932e9132d70e578f318d9e', tree: 'f7f5f0994c1bb34702636f2422928edd20f47878', migrations: 88, populate: populate03},
  '0.4.25': {commit: '333af4b0580c4284616783f1d79fcc9aad3aefc5', tree: '4d73aed9e44bfd052495c92b4e9b9f8446f46dc6', migrations: 195, previous: true, populate: populate03},
  '0.4.24': {commit: '6acf8a4c50dfeb94ca9ab705b1e386d282ea8e0f', tree: '3fef27a02c18080ab8e6b83c840be986b79a5720', migrations: 195, populate: populate03},
  '0.4.23': {commit: '3c45a60a6debb0886ae8c41eee18a95e6fee694d', tree: '57e373f61651f5befb0bbfbb965d4a6bac40f102', migrations: 191, populate: populate03},
  '0.4.22': {commit: '4dee2432081a64cee0bd12c59a31cb84371c3ab3', tree: '926a36fba2929bdc8a6139e923e98906c4f24305', migrations: 190, populate: populate03},
  '0.4.21': {commit: '51492e5d3cbaa94b42df1bef063fb00131038a19', tree: 'e2dc6701ceab868a072e8898638aaa29558cf7b6', migrations: 188, populate: populate03},
  '0.4.20': {commit: '1c9051307419c22530c4b1f7aab80a53bd4eb9d8', tree: '307675b12e7542932a28c906573ec9187ca512be', migrations: 188, populate: populate03},
  '0.4.19': {commit: '63b6217aae78be1cdaf5d1b8f8ac6f1d04ce83ad', tree: '4c100c3d3fb9f697a21fa5a817e9946aef80ceef', migrations: 186, populate: populate03},
  '0.4.18': {commit: 'e1c1b41a79c67b4b4298bea0eed17a28b2914d02', tree: '13485b4e02c50b7e5dc697bf250ddba47ffb7df4', migrations: 186, populate: populate03},
  '0.4.17': {commit: '81915ea5d02337723d78d08bf3c93c66e502ddae', tree: '7d2b3b979a4ec3b25b8792a8176f2d0569a4c240', migrations: 185, populate: populate03},
  '0.4.16': {commit: 'b4791d89276fce34837ef22fb2c513ca3053572f', tree: 'a06880e7100b68c5334e61bd0f6bd921600f29b2', migrations: 184, populate: populate03},
  '0.4.13': {commit: '704c50b8fdcd552af13aad76029135361fdc2125', tree: 'ab22339e59de20212c1459f516e079ce731ed832', migrations: 133, tables: 363, populate: populate03},
  '0.4.12': {commit: '449dd0420844fa60bdfc9ff06e409f974c00951a', tree: '451a2b83c2557b2c3d3fee7465d5d55fff287de7', migrations: 107, tables: 323, populate: populate03},
  '0.4.11': {commit: '173101c4ce196ebb344f35f9d21cc3132efe980d', tree: '0ee1142ed1533408d02dea362e0aa347d3da2728', migrations: 107, tables: 323, populate: populate03},
  '0.4.10': {commit: '9b4f61eb6566a0a68770bfb3b3cefb1dec26a947', tree: 'd96d6e2576e3d9087480c101af313bcb1a1f8a05', migrations: 95, tables: 295, populate: populate03},
  '0.4.9': {commit: 'bde2457bea34e72c4ce38315cd2aa64ce4bac183', tree: 'c514ab49c66069be32fb992c6c3e1524ae8f9b16', migrations: 95, tables: 295, populate: populate03},
  '0.4.8': {commit: '5f76b9583dca618ce222c81ed1a63cef621a168c', tree: '70caffc6e51cb9281b7205c9868ad14cf4c839b6', migrations: 95, tables: 295, populate: populate03},
  '0.4.7': {commit: 'cd1f188b751fd2a39fd31fe0ee75c4bc855cb6bc', tree: 'bfc1d5263ee1814315b0ed8140af4b10b0c7bb21', migrations: 88, populate: populate03},
};

async function populate041(origin, runtime) {
  const data = await populate03(origin);
  data.interruptedErasure = await interruptedErasure(runtime, client(origin), data.owner);
  return data;
}

export function client(origin) {
  return async (path, {body, token, method, headers = {}, raw} = {}) => {
    const response = await fetch(origin + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {...(raw ? {} : {'Content-Type': 'application/json'}), ...(token ? {Authorization: `Bearer ${token}`} : {}), ...headers}, ...(body === undefined ? {} : {body: raw ? body : JSON.stringify(body)})});
    const value = (response.headers.get('content-type') || '').includes('json') ? await response.json() : await response.text();
    assert.ok(response.ok, `${method || ''} ${path}: ${response.status} ${JSON.stringify(value).slice(0, 500)}`);
    return value;
  };
}

// Genuine v0.2.1 setup and journey API writes, with no direct fixture INSERTs.
async function populate021(origin) {
  const call = client(origin);
  const owner = await call('/api/identity/bootstrap', {body: {name: 'Upgrade owner workspace', email: 'upgrade@example.test', password: 'synthetic-upgrade-proof-password-2026', allowedOrigin: origin}});
  const project = await call(`/api/identity/projects/${owner.projectId}`, {token: owner.token});
  const visitor = await call('/api/identity/widget/session', {body: {widgetKey: project.widget_key, name: 'Upgrade customer', email: 'customer@example.test'}, headers: {Origin: origin}});
  const conversation = await call('/api/conversations', {body: {projectId: owner.projectId}, token: visitor.token});
  await call(`/api/conversations/${conversation.id}/messages`, {body: {localId: 'upgrade-customer-message', content: 'Retain this exact transcript through upgrade.', expectedRevision: 0}, token: visitor.token});
  await call(`/api/knowledge/${owner.projectId}/articles`, {body: {title: 'Upgrade knowledge', slug: 'upgrade-knowledge', content: 'Retain this published article through upgrade.', status: 'published'}, token: owner.token});
  return {owner: {email: 'upgrade@example.test', password: 'synthetic-upgrade-proof-password-2026', projectId: owner.projectId}, visitor: {token: visitor.token, conversationId: conversation.id, transcript: ['Retain this exact transcript through upgrade.']}, article: {projectId: owner.projectId, slug: 'upgrade-knowledge', content: 'Retain this published article through upgrade.'}};
}

// A populated 0.3 installation, written only through its own API: owner with a
// password, an accepted member and a pending invitation, two workspaces with
// saved appearance, contacts, a visitor conversation with an attachment and
// operator replies, and a published article in a category.
async function populate03(origin) {
  const call = client(origin);
  const owner = {email: 'owner-03@example.test', password: 'synthetic-upgrade-03-owner-password'};
  const setup = await call('/api/identity/bootstrap', {body: {name: 'Upgrade 0.3 desk', ownerName: 'Upgrade Owner', email: owner.email, password: owner.password, allowedOrigin: origin, primaryColor: '#204b3a'}});
  const token = setup.token, projectId = setup.projectId;
  const appearance = {brand_name: 'Upgrade Desk', welcome_message: 'Hello from 0.3', primary_color: '#204b3a', color: '#f4efe6', timezone: 'Europe/London', display_mode: 'light'};
  await call(`/api/management/projects/${projectId}/settings`, {method: 'PUT', body: appearance, token});
  await call(`/api/management/projects/${projectId}/appearance`, {method: 'PUT', body: {artwork_enabled: false}, token});
  const second = await call('/api/management/projects', {body: {name: 'Upgrade 0.3 second desk', allowed_origin: origin}, token});
  const member = {email: 'member-03@example.test', password: 'synthetic-upgrade-03-member-password'};
  const invitation = await call(`/api/management/projects/${projectId}/agents`, {body: {email: member.email, role: 'operator'}, token});
  await call('/api/identity/accept-token', {body: {token: new URL(invitation.data.invitationUrl).searchParams.get('token'), name: 'Upgrade Member', password: member.password}});
  await call(`/api/management/projects/${projectId}/agents`, {body: {email: 'pending-03@example.test', role: 'operator'}, token});
  const contact = await call(`/api/management/projects/${projectId}/contacts`, {body: {name: 'Dashboard Contact', email: 'dashboard-contact@example.test'}, token});
  const project = await call(`/api/identity/projects/${projectId}`, {token});
  const visitor = await call('/api/identity/widget/session', {body: {widgetKey: project.widget_key, name: 'Upgrade Visitor', email: 'visitor-03@example.test'}, headers: {Origin: origin}});
  const conversation = await call('/api/conversations', {body: {projectId}, token: visitor.token});
  const attachment = Buffer.from('%PDF-1.4\n% HappyToHelp 0.3 upgrade attachment\n');
  const media = await call(`/api/conversations/${conversation.id}/media`, {body: attachment, raw: true, token: visitor.token, headers: {'Content-Type': 'application/pdf', 'X-Filename': 'receipt-03.pdf'}});
  const transcript = ['My order arrived damaged; receipt attached.', 'Sorry about that. A replacement is on its way.', 'Thank you!', 'Glad to help. Closing this for now.'];
  const authored = [];
  for (const [index, content] of transcript.entries()) {
    const fromVisitor = index % 2 === 0;
    const actorToken = fromVisitor ? visitor.token : token;
    const frontier = await call(`/api/conversations/${conversation.id}/messages`, {token: actorToken});
    const sent = await call(`/api/conversations/${conversation.id}/messages`, {body: {localId: `upgrade-03-${index}`, content, expectedRevision: frontier.revision, ...(index === 0 ? {mediaIds: [media.id]} : {})}, token: actorToken});
    assert.equal(sent.accepted, true);
    assert.notEqual(sent.duplicate, true);
    const expected = {local_id: `upgrade-03-${index}`, content, actor_role: fromVisitor ? 'contact' : 'owner', actor_id: fromVisitor ? visitor.contactId : setup.userId, project_id: projectId, conversation_id: conversation.id, revision: frontier.revision + 1};
    assert.ok(sent.message.id);
    for (const [field, value] of Object.entries(expected)) assert.equal(sent.message[field], value, `authored acknowledgement ${index}: ${field}`);
    authored.push({id: sent.message.id, ...expected});
  }
  const {messages} = await call(`/api/conversations/${conversation.id}/messages`, {token});
  assert.ok(messages.length === authored.length || messages.length === authored.length + 1, 'complete predecessor transcript has only the authored messages and optional away reply');
  assert.equal(new Set(messages.map(message => message.id)).size, messages.length, 'distinct predecessor message identities');
  assert.equal(new Set(messages.map(message => message.local_id)).size, messages.length, 'distinct predecessor command identities');
  const hasAway = messages.length === authored.length + 1;
  if (hasAway) {
    // The unchanged no-presence fixture earns this standard notice in releases
    // with presence-based away; older releases retain the four authored rows.
    const away = messages[1];
    const expected = {local_id: 'away:reply', actor_role: 'system', actor_id: 'away', project_id: projectId, conversation_id: conversation.id, revision: authored[0].revision + 1, content: "Thanks for your message. Upgrade Desk is away right now. We'll reply here. Responds within 24 hours"};
    assert.ok(away.id);
    for (const [field, value] of Object.entries(expected)) assert.equal(away[field], value, `predecessor away reply: ${field}`);
    if ('media' in away) assert.deepEqual(away.media, []);
    transcript.splice(1, 0, expected.content);
  }
  for (const [index, expected] of authored.entries()) {
    const message = messages[index + (hasAway && index > 0 ? 1 : 0)];
    for (const [field, value] of Object.entries(expected)) assert.equal(message[field], value, `predecessor authored message ${index}: ${field}`);
    if ('media' in message) assert.deepEqual(message.media.map(item => item.id), index === 0 ? [media.id] : []);
  }
  assert.deepEqual(messages.map(message => message.content), transcript);
  console.log('Validated predecessor transcript:', JSON.stringify(messages.map(({id, local_id, actor_role, actor_id, content, revision, media}) => ({id, local_id, actor_role, actor_id, content, revision, ...(media ? {mediaIds: media.map(item => item.id)} : {})}))));
  const category = await call(`/api/knowledge/${projectId}/categories`, {body: {name: 'Orders', slug: 'orders'}, token});
  const article = {title: 'Returning a damaged order', slug: 'damaged-order', content: 'Reply in chat with a photo and we send a replacement.'};
  await call(`/api/knowledge/${projectId}/articles`, {body: {...article, status: 'published', categoryIds: [category.id]}, token});
  return {owner: {...owner, projectId, secondProjectId: second.id}, member, pendingEmail: 'pending-03@example.test', appearance, contactId: contact.data?.id, visitor: {token: visitor.token, conversationId: conversation.id, transcript}, attachment: {id: media.id, bytes: attachment.toString('base64')}, article: {projectId, slug: article.slug, content: article.content, categoryId: category.id}};
}
