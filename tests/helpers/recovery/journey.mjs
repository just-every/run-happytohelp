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
  const machine=await json(await call(runtime,`/api/management/projects/${owner.projectId}/connections/tokens`,{name:'Synthetic recovery machine',source_product:'synthetic-hh-restore',scopes:['conversations:create','messages:append','conversations:read']},owner.token),201);
  const request={requester:{external_id:'synthetic-hh-restore'},subject:'API recovery',body:'Retained machine request',source_ref:{product:'synthetic-hh-restore',ref:'synthetic-hh-restore',url:'https://example.test/restore'}};
  const apiTicket=await json(await call(runtime,'/api/v1/conversations',request,machine.token,{'Idempotency-Key':'synthetic-hh-restore'}),201);
  const erasedRequest={requester:{external_id:'synthetic-hh-restore-erased'},subject:'Erase before restore',body:'Remove this API content'};
  const erasedTicket=await json(await call(runtime,'/api/v1/conversations',erasedRequest,machine.token,{'Idempotency-Key':'synthetic-hh-restore-erased'}),201);
  const erasedState=await json(await call(runtime,`/api/management/projects/${owner.projectId}/conversations/${erasedTicket.data.id}/ticket`,undefined,owner.token),200);
  await json(await call(runtime,`/api/management/projects/${owner.projectId}/contacts/${erasedState.data.contact_id}/erase`,{},owner.token),200);
  const api={machine,request,apiTicket,erasedRequest};
  const state = {api,owner, conversation, media, bytes, command, article, ticket, r4};
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

export async function verifyRestoredApi(runtime,state){
 const {owner,api}=state;
 const settings=`/api/management/projects/${owner.projectId}/connections/tokens`;
 const list=await json(await call(runtime,settings,undefined,owner.token),200);
 const credential=list.data.find(row=>row.id===api.machine.data.id);assert.ok(credential.revokedAt);assert.equal(credential.source_product,'synthetic-hh-restore');
 assert.equal((await call(runtime,'/api/v1/conversations',api.request,api.machine.token,{'Idempotency-Key':'synthetic-hh-restore'})).status,401);
 const ticket=await json(await call(runtime,`/api/management/projects/${owner.projectId}/conversations/${api.apiTicket.data.id}/ticket`,undefined,owner.token),200);
 assert.equal(ticket.data.channel,'api:synthetic-hh-restore');assert.equal(ticket.data.api.credential_name,'Synthetic recovery machine');assert.equal(ticket.data.api.source_ref,api.request.source_ref.ref);
 const erasedIssuer=list.data.find(row=>row.id===api.erasedIssuer.data.id);assert.equal(erasedIssuer.issuer_id,null);assert.ok(erasedIssuer.revokedAt);
 assert.equal((await call(runtime,'/api/v1/conversations',api.request,api.erasedIssuer.token,{'Idempotency-Key':'synthetic-hh-inert-issuer'})).status,401);
 const audit=await json(await call(runtime,`/api/management/projects/${owner.projectId}/audit/export?format=json`,undefined,owner.token),200);
 for(const id of api.issuerEvents){const event=audit.events.find(event=>event.id===id);assert.ok(event);assert.equal(event.actor,'Former teammate')}
 const issuerTicket=await json(await call(runtime,`/api/management/projects/${owner.projectId}/conversations/${api.issuerTicketId}/ticket`,undefined,owner.token),200);assert.equal(issuerTicket.data.api.credential_name,'Synthetic retained recovery machine');
 const reissued=await json(await call(runtime,settings,{name:'Synthetic restored machine',source_product:'synthetic-hh-restore',scopes:['conversations:create']},owner.token),201);
 for(const [request,key] of [[api.request,'synthetic-hh-restore'],[api.erasedRequest,'synthetic-hh-new-after-restore']]){
  const result=await call(runtime,'/api/v1/conversations',request,reissued.token,{'Idempotency-Key':key});assert.equal(result.status,409);assert.equal((await result.json()).error.code,'identity_erased');
 }
}

export async function eraseRecoveryIssuer(runtime,state,issuerId,issuerSession){
 const {owner,api}=state,settings=`/api/management/projects/${owner.projectId}/connections/tokens`;
 api.erasedIssuer=await json(await call(runtime,settings,{name:'Synthetic retained recovery machine',source_product:'synthetic-hh-issuer-restore',scopes:['conversations:create','messages:append']},issuerSession),201);
 const created=await json(await call(runtime,'/api/v1/conversations',{requester:{external_id:'synthetic-hh-issuer-restore'},subject:'Retained issuer ticket',body:'Customer request'},api.erasedIssuer.token,{'Idempotency-Key':'synthetic-hh-issuer-restore'}),201);
 api.issuerTicketId=created.data.id;
 await json(await call(runtime,`/api/v1/conversations/${created.data.id}/append`,{kind:'customer',localId:'synthetic-hh-issuer-restore-append',content:'Retained followup'},api.erasedIssuer.token),200);
 await json(await call(runtime,`/api/management/projects/${owner.projectId}/agents/${issuerId}/erase`,{},owner.token),200);
 const audit=await json(await call(runtime,`/api/management/projects/${owner.projectId}/audit/export?format=json`,undefined,owner.token),200);
 api.issuerEvents=audit.events.filter(event=>event.actor_id===issuerId).map(event=>event.id);assert.ok(api.issuerEvents.length);
 assert.ok(audit.events.filter(event=>api.issuerEvents.includes(event.id)).every(event=>event.actor==='Former teammate'));
}
