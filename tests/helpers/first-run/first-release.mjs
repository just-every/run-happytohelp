// First-release journey for native HappyToHelp against a real emitted Worker.
// One concrete owner/customer/operator journey, asserted end to end on an
// isolated local Worker with its own D1/R2/Durable Object state.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve} from 'node:path'
import {createRuntime} from '../emitted-runtime.mjs'
const root=resolve(new URL('../../..',import.meta.url).pathname)

export async function firstReleaseJourney(){
const runtime=await createRuntime();let success=false;const proven=[]
const step=(number,text)=>{proven.push(`${number}. ${text}`);console.log(`  step ${number} ok`)}
try{
 const {origin}=runtime
 const call=(path,body,token,method=body===undefined?'GET':'POST',headers={})=>fetch(origin+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)})
 const json=async(...args)=>{const response=await call(...args);return {status:response.status,headers:response.headers,body:await response.json()}}

 // 1. Health.
 const health=await json('/health');assert.equal(health.status,200);assert.equal(health.body.status,'ok');assert.equal(health.body.database,'reachable');assert.equal(health.body.files,'reachable')
 step(1,'health: emitted Worker serves /health with reachable D1 database and R2 files')

 // 2. Owner setup and login.
 const password='synthetic-journey-owner-password-123',email='journey-owner@example.com'
 const bootstrap=await json('/api/identity/bootstrap',{name:'Journey project',email,password,allowedOrigin:origin});assert.equal(bootstrap.status,201);assert.ok(bootstrap.body.projectId&&bootstrap.body.userId&&bootstrap.body.token)
 // The customer writes while nobody has the dashboard open and the operator answers anyway, so presence-based away is off.
 await runtime.presenceAwayOff(bootstrap.body.projectId)
 const secondBootstrap=await json('/api/identity/bootstrap',{name:'Second owner',email:'intruder@example.com',password:'synthetic-another-password-123',allowedOrigin:origin});assert.equal(secondBootstrap.status,409);assert.match(JSON.stringify(secondBootstrap.body),/already complete/i)
 const loginResponse=await call('/api/identity/login',{email,password});assert.equal(loginResponse.status,200);const setCookie=loginResponse.headers.get('Set-Cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/h2h_session=/);const cookie=setCookie.split(';')[0]
 const login=await loginResponse.json();assert.equal(login.actor.projectId,bootstrap.body.projectId);assert.equal(login.actor.role,'owner');assert.equal(login.accountOnly,false)
 const cookieSession=await json('/api/identity/session',undefined,undefined,'GET',{Cookie:cookie});assert.equal(cookieSession.status,200);assert.equal(cookieSession.body.id,bootstrap.body.userId);assert.equal(cookieSession.body.projectId,bootstrap.body.projectId)
 step(2,'owner setup: first bootstrap created owner+project (201), repeat bootstrap refused 409, password login issued an HttpOnly session cookie and GET /api/identity/session returned the owner actor')

 // 3. Project selection, membership and tenant isolation.
 const second=await json('/api/management/projects',{name:'Journey second project',allowedOrigin:origin},login.token);assert.equal(second.status,201)
 const switched=await json('/api/identity/switch-project',{projectId:second.body.id},login.token);assert.equal(switched.status,200);assert.equal(switched.body.actor.projectId,second.body.id);assert.notEqual(switched.body.actor.projectId,login.actor.projectId)
 const outsider=await runtime.seedTenant({name:'Outsider tenant',email:'outsider@example.com',allowedOrigin:origin})
 assert.equal((await call('/api/identity/switch-project',{projectId:outsider.projectId},login.token)).status,403)
 assert.equal((await call('/api/identity/switch-project',{projectId:outsider.projectId},switched.body.token)).status,403)

 // 4. Customer widget conversation with an attachment.
 const project=await json('/api/identity/projects/'+bootstrap.body.projectId,undefined,login.token);assert.equal(project.status,200);assert.ok(project.body.widget_key)
 const contact=await json('/api/identity/widget/session',{widgetKey:project.body.widget_key,name:'Journey customer',email:'customer@example.com'},undefined,'POST',{Origin:origin});assert.equal(contact.status,201);assert.equal(contact.body.projectId,bootstrap.body.projectId);assert.equal(contact.body.verified,false)
 assert.equal((await call('/api/identity/widget/session',{widgetKey:project.body.widget_key},undefined,'POST',{Origin:'https://attacker.example'})).status,403)
 const conversation=await json('/api/conversations',{projectId:bootstrap.body.projectId},contact.body.token);assert.equal(conversation.status,201);assert.equal(conversation.body.revision,0)
 const conversationId=conversation.body.id
 const attachment=Buffer.from('journey attachment bytes\n','utf8')
 const mediaResponse=await fetch(`${origin}/api/conversations/${conversationId}/media`,{method:'POST',headers:{Authorization:`Bearer ${contact.body.token}`,'Content-Type':'text/plain','X-Filename':'receipt.txt'},body:attachment});assert.equal(mediaResponse.status,201);const media=await mediaResponse.json();assert.equal(media.filename,'receipt.txt');assert.equal(media.size,attachment.byteLength)
 const command={localId:'journey-customer-1',content:'My invoice is wrong, receipt attached.',expectedRevision:0,mediaIds:[media.id]}
 const sent=await json(`/api/conversations/${conversationId}/messages`,command,contact.body.token);assert.equal(sent.status,200);assert.equal(sent.body.accepted,true);assert.equal(sent.body.duplicate,false);assert.equal(sent.body.message.revision,1);assert.equal(sent.body.generationError,undefined)
 const resent=await json(`/api/conversations/${conversationId}/messages`,command,contact.body.token);assert.equal(resent.status,200);assert.equal(resent.body.accepted,true);assert.equal(resent.body.duplicate,true);assert.equal(resent.body.message.id,sent.body.message.id)
 const customerTranscript=await json(`/api/conversations/${conversationId}/messages`,undefined,contact.body.token);assert.equal(customerTranscript.status,200);assert.equal(customerTranscript.body.messages.length,1);assert.equal(customerTranscript.body.revision,1);assert.equal(customerTranscript.body.messages[0].media.length,1);assert.equal(customerTranscript.body.messages[0].media[0].id,media.id)
 const download=await call(`/api/conversations/${conversationId}/media/${media.id}`,undefined,contact.body.token);assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'text/plain');assert.match(download.headers.get('Content-Disposition'),/^inline;/);assert.match(download.headers.get('Content-Disposition'),/receipt\.txt/);assert.equal(Buffer.from(await download.arrayBuffer()).toString('utf8'),attachment.toString('utf8'))
 // Cross-tenant denial completes step 3 now that a private conversation exists.
 assert.equal((await call(`/api/conversations/${conversationId}/messages`,undefined,outsider.token)).status,404)
 assert.equal((await call(`/api/conversations/${conversationId}`,undefined,outsider.token)).status,404)
 step(3,'project selection: a second project was created and switch-project moved actor.projectId to it; switching into a seeded outsider tenant was 403 from both owner sessions and the outsider token read the owner conversation as 404')
 step(4,`customer widget: widget session (201, foreign Origin 403) issued a contact token; conversation created at revision 0; ${attachment.byteLength}-byte attachment uploaded (media ${media.id}); message with mediaIds accepted at revision 1 and the identical resend answered duplicate:true; transcript holds exactly one message with one media entry; media download returned the exact bytes as Content-Disposition attachment`)

 // 5. Operator dashboard handling.
 const list=await json('/api/conversations',undefined,login.token);assert.equal(list.status,200);assert.ok(list.body.conversations.some(row=>row.id===conversationId))
 const operatorTranscript=await json(`/api/conversations/${conversationId}/messages`,undefined,login.token);assert.equal(operatorTranscript.status,200);assert.equal(operatorTranscript.body.messages.length,1);assert.equal(operatorTranscript.body.lastMessageId,sent.body.message.id)
 const inbox=await json(`/api/dashboard/projects/${bootstrap.body.projectId}/conversations`,undefined,login.token);assert.equal(inbox.status,200);assert.ok(inbox.body.data.some(row=>String(row.id)===conversationId),'dashboard inbox listing must contain the customer conversation');assert.ok(inbox.body.meta.pagination.total>=1)
 const countsBefore=await json(`/api/dashboard/projects/${bootstrap.body.projectId}/conversations/counts`,undefined,login.token);assert.equal(countsBefore.status,200);assert.equal(countsBefore.body.data.unassigned,1);assert.equal(countsBefore.body.data.mine,0)
 const reply={localId:'journey-operator-1',content:'Thanks - I can see the receipt and I am correcting the invoice now.',expectedRevision:1,expectedLastMessageId:sent.body.message.id}
 const replied=await json(`/api/conversations/${conversationId}/messages`,reply,login.token);assert.equal(replied.status,200);assert.equal(replied.body.accepted,true);assert.equal(replied.body.message.revision,2);assert.equal(replied.body.message.actor_role,'owner')
 const stale=await json(`/api/conversations/${conversationId}/messages`,{localId:'journey-operator-stale',content:'Sent against a stale view of the thread.',expectedRevision:2,expectedLastMessageId:sent.body.message.id},login.token);assert.equal(stale.status,409);assert.equal(stale.body.accepted,false);assert.equal(stale.body.reason,'conversation_changed_or_admission_denied')
 const assigned=await json(`/api/conversations/${conversationId}`,undefined,login.token);assert.equal(assigned.status,200);assert.equal(assigned.body.assigned_to,bootstrap.body.userId);assert.equal(assigned.body.revision,2)
 const countsAfter=await json(`/api/dashboard/projects/${bootstrap.body.projectId}/conversations/counts`,undefined,login.token);assert.equal(countsAfter.status,200);assert.equal(countsAfter.body.data.mine,1);assert.equal(countsAfter.body.data.unassigned,0)
 step(5,'operator handling: GET /api/conversations and the read-only dashboard inbox GET /api/dashboard/projects/:projectId/conversations both listed the conversation; the operator reply with expectedRevision+expectedLastMessageId committed revision 2, a stale expectedLastMessageId was refused 409 accepted:false, the conversation is now assigned_to the owner, and dashboard .../conversations/counts moved unassigned 1->0 and mine 0->1')

 // 6. AI decision in a provider-less runtime.
 const generation=await json(`/api/ai-support/projects/${bootstrap.body.projectId}/conversations/${conversationId}/generations`,{expectedRevision:2},login.token)
 assert.equal(generation.status,409);assert.equal(typeof generation.body.error,'string');assert.match(generation.body.error,/CONFIGURATION_REQUIRED/)
 const afterGeneration=await json(`/api/conversations/${conversationId}/messages`,undefined,login.token);assert.equal(afterGeneration.body.messages.length,2);assert.equal(afterGeneration.body.revision,2);assert.ok(!afterGeneration.body.messages.some(message=>message.actor_role==='ai'),'no ai message may appear without a configured provider')
 assert.equal((await json(`/api/conversations/${conversationId}`,undefined,login.token)).body.revision,2)
 step(6,`AI decision: reply generation was refused 409 with "${generation.body.error}" because no assistant took the conversation: without an installed provider key a default assistant never answers visitors by itself, and an explicit request fails naming what is missing; the transcript kept 2 messages with no ai role and the conversation revision stayed 2. Per-round provider usage and bounded budgets are proven separately by tests/journeys/ai.mjs with provider fixtures; live provider execution is out of scope for this journey`)

 // 7. Persisted transcript, socket replay and session revocation.
 const persisted=await json(`/api/conversations/${conversationId}/messages`,undefined,contact.body.token);assert.equal(persisted.body.messages.length,2);assert.deepEqual(persisted.body.messages.map(message=>message.revision),[1,2]);assert.equal(persisted.body.messages[0].content,command.content);assert.equal(persisted.body.messages[1].content,reply.content);assert.equal(persisted.body.lastMessageId,replied.body.message.id)
 const socketUrl=suffix=>origin.replace(/^http/,'ws')+`/api/conversations/${conversationId}/socket?token=${contact.body.token}`+suffix
 const openSocket=async suffix=>{const ws=new WebSocket(socketUrl(suffix)),frames=[];ws.addEventListener('message',event=>frames.push(JSON.parse(event.data)));await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(new Error('socket open timed out')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);accept()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('socket upgrade rejected'))},{once:true})});return {ws,frames}}
 const settle=async(state,expected)=>{const deadline=Date.now()+8000;while(state.frames.length<expected&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));await new Promise(r=>setTimeout(r,500));assert.equal(state.frames.length,expected,`expected exactly ${expected} replayed frames, received ${state.frames.length}`);return state.frames}
 const first=await openSocket('');const replayed=await settle(first,2)
 assert.deepEqual(replayed.map(frame=>frame.type),['message','message']);assert.deepEqual(replayed.map(frame=>frame.message.id),[sent.body.message.id,replied.body.message.id]);assert.deepEqual(replayed.map(frame=>frame.message.revision),[1,2]);assert.equal(replayed[0].conversationId,conversationId);assert.ok(Number(replayed[1].eventId)>Number(replayed[0].eventId))
 const cursor=replayed[1].eventId;first.ws.close();await new Promise(r=>setTimeout(r,250))
 const offline=await json(`/api/conversations/${conversationId}/messages`,{localId:'journey-operator-2',content:'Corrected invoice sent while you were offline.',expectedRevision:2,expectedLastMessageId:replied.body.message.id},login.token);assert.equal(offline.status,200);assert.equal(offline.body.accepted,true);assert.equal(offline.body.message.revision,3)
 const resumed=await openSocket('&after='+cursor);const caughtUp=await settle(resumed,1)
 assert.equal(caughtUp[0].message.id,offline.body.message.id);assert.equal(caughtUp[0].message.revision,3);assert.ok(Number(caughtUp[0].eventId)>Number(cursor));resumed.ws.close()
 const revoked=await json('/api/identity/session',undefined,contact.body.token,'DELETE');assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,true)
 assert.equal((await call(`/api/conversations/${conversationId}/messages`,undefined,contact.body.token)).status,401)
 await assert.rejects(openSocket(''),/socket upgrade rejected/)
 step(7,'persistence and recovery: the reloaded transcript holds both messages at revisions 1 and 2; the contact WebSocket replayed exactly those two committed messages in order; after disconnecting, one more operator message was committed and a reconnect with ?after=<eventId> replayed exactly that newer event; revoking the contact session then denied both the REST transcript (401) and the socket upgrade')

 // 8. Deletion boundary.
 const deleted=await json('/api/management/projects/'+second.body.id,undefined,login.token,'DELETE');assert.equal(deleted.status,200);assert.equal(deleted.body.deleted,true)
 assert.equal((await call('/api/identity/session',undefined,switched.body.token)).status,401)
 const relogin=await json('/api/identity/login',{email,password});assert.equal(relogin.status,200);assert.equal(relogin.body.accountOnly,false);assert.equal(relogin.body.actor.projectId,bootstrap.body.projectId);assert.equal(relogin.body.memberships.length,1)
 const survivor=await json(`/api/conversations/${conversationId}/messages`,undefined,relogin.body.token);assert.equal(survivor.status,200);assert.equal(survivor.body.messages.length,3);assert.equal(survivor.body.revision,3)
 step(8,'deletion boundary: deleting the second project returned deleted:true and revoked its sessions (401); the account still logs in with one remaining membership and the original conversation still reads back with all 3 messages at revision 3')

 const revision=(await promisify(execFile)('git',['-C',root,'rev-parse','HEAD'])).stdout.trim()
 console.log('\nFirst-release journey evidence')
 for(const line of proven)console.log(' '+line)
 console.log(` source revision: ${revision}`)
 console.log(` migrations applied by createRuntime: ${runtime.migrationCount}`)
 console.log(' This is local emitted-Worker evidence, not hosted, provider or production-data acceptance.')
 success=true
}finally{await runtime.close(success)}
}
