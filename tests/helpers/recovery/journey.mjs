import assert from 'node:assert/strict';
import {seedRecoveryR4,verifyRecoveryR4} from './r4-data.mjs';
import {seedRecoveryTicket,verifyRecoveryTicket} from './tickets.mjs';

const credentials = {name: 'Recovery comparison fixture', email: 'recovery@example.test', password: 'synthetic-recovery-comparison-test-password', allowedOrigin: 'https://recovery.example.test'};
export const setupToken = 'synthetic-local-recovery-comparison-setup-token';
export async function call(runtime, path, body, token, headers = {}) {
  return fetch(runtime.origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
}
async function json(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
export async function seedJourney(runtime) {
  const owner = await json(await call(runtime, '/api/identity/bootstrap', {...credentials, setupToken}), 201);
  const project = await json(await call(runtime, `/api/identity/projects/${owner.projectId}`, undefined, owner.token), 200);
  const visitor = await json(await call(runtime, '/api/identity/widget/session', {widgetKey: project.widget_key}, undefined, {Origin: credentials.allowedOrigin}), 201);
  const conversation = await json(await call(runtime, '/api/conversations', {projectId: owner.projectId}, visitor.token), 201);
  const command = {localId: 'recovery-comparison-message', content: 'Native recovery must preserve this transcript exactly: café 日本語.', expectedRevision: 0};
  await json(await call(runtime, `/api/conversations/${conversation.id}/messages`, command, visitor.token), 200);
  const article = await json(await call(runtime, `/api/knowledge/${owner.projectId}/articles`, {title: 'Recovery fixture knowledge', slug: 'recovery-fixture', content: 'Retain the published knowledge and its scope.', status: 'published'}, owner.token), 201);
  const bytes = [0, 255, 128, 42, 13, 10, 0, 127];
  const response = await fetch(`${runtime.origin}/api/conversations/${conversation.id}/media`, {method: 'POST', headers: {Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': 'recovery.bin'}, body: Uint8Array.from(bytes)});
  const media = await json(response, 201);
  const ticket = await seedRecoveryTicket(runtime, owner, conversation);
  const r4 = await seedRecoveryR4(runtime, {owner, visitor, conversation, media, ticket});
  const state = {owner, conversation, media, bytes, command, article, ticket, r4};
  await verifyAccess(runtime, state, owner.token);
  return state;
}
export async function verifyAccess(runtime, state, token) {
  const {conversation, media, bytes, command} = state;
  const path = `/api/conversations/${conversation.id}/media/${media.id}`;
  const response = await call(runtime, path, undefined, token);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/octet-stream/);
  assert.match(response.headers.get('content-disposition'), /recovery\.bin/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], bytes);
  assert.equal((await call(runtime, path)).status, 401);
  const transcript = await json(await call(runtime, `/api/conversations/${conversation.id}/messages`, undefined, token), 200);
  assert.equal(transcript.messages[0].content, command.content);
  await json(await call(runtime, '/api/identity/session', undefined, token), 200);
  await verifyRecoveryTicket(runtime,state);
  await verifyRecoveryR4(runtime,state,token);
}
export async function verifyFreshLogin(runtime, state) {
  assert.equal((await call(runtime, '/api/identity/bootstrap', {...credentials, setupToken})).status, 409);
  const login = await json(await call(runtime, '/api/identity/login', {email: credentials.email, password: credentials.password}), 200);
  assert.notEqual(login.token, state.owner.token, 'Fresh password login must create a new session');
  await verifyAccess(runtime, state, login.token);
}
