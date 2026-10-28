import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
import {startProviders} from './providers.mjs';
export async function escalationHarness({tickets=8}={}){
 const providers=await startProviders();let app;
 try{
 app=await startApp({bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async req=>{if(!Object.values(providers).some(p=>p.baseUrl&&new URL(req.url).origin===p.baseUrl))throw Error('Network edge refused');return fetch(req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()})}});
 const ws=await app.seedWorkspace('escalations'),foreign=await app.seedWorkspace('foreign'),token=ws.tokens.owner,base=`/api/escalations/projects/${ws.projectId}`;
 // Customers write while nobody has the dashboard open and this team answers anyway, so presence-based away is off.
 await app.presenceAwayOff(ws.projectId);
 const call=(path,body,options={})=>app.ok(base+path,{token,body,...options});
 for(const name of ['github','linear','jira','slack','teams']){const p=providers[name];await call('/connections',{provider:name,target:p.target,base_url:p.baseUrl,token:p.token,webhook_secret:p.secret})}
 const records=[];
 for(let n=0;n<tickets;n++){
  const visitorHeaders={Origin:ws.allowedOrigin,'CF-Connecting-IP':`198.51.100.${n+1}`};
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey,name:`Customer ${n+1}`,email:`customer-${n+1}@example.test`},headers:visitorHeaders}),contact={id:visitor.contactId};
  const ticket=await app.ok('/api/conversations',{token:visitor.token,headers:visitorHeaders,body:{projectId:ws.projectId}});
  const sent=await app.ok(`/api/conversations/${ticket.id}/messages`,{token:visitor.token,headers:visitorHeaders,body:{localId:'opening',content:`Customer ${n+1}: exports hang on the progress screen.`,expectedRevision:0}});
  const omitted=await app.ok(`/api/conversations/${ticket.id}/messages`,{token,body:{localId:'omitted',content:`Unchosen sensitive account detail ${n+1}`,expectedRevision:1}});
  await app.ok(`/api/dashboard/projects/${ws.projectId}/conversations/${ticket.id}/notes`,{token,body:{content:`Private engineering note ${n+1}`}});
  const file=await app.ok(`/api/conversations/${ticket.id}/media`,{token:visitor.token,body:new Uint8Array([65,66,67]),raw:true,headers:{...visitorHeaders,'Content-Type':'text/plain','X-Filename':`diagnostic-${n+1}.txt`}});
  await app.ok(`/api/conversations/${ticket.id}/messages`,{token:visitor.token,headers:visitorHeaders,body:{localId:'attachment',content:'Public diagnostic attachment',mediaIds:[file.id],expectedRevision:2}});
  records.push({ticket,contact,message:sent.message,omitted:omitted.message,file,visitorToken:visitor.token});
 }
 const root=r=>`/conversations/${r.ticket.id}`;
 const share=(r,p='github',extra={})=>call(root(r)+'/links',{provider:p,mode:'create',title:'Export progress freezes',message_ids:[r.message.id],attachment_ids:[r.file.id],dependency:'Waiting for engineering',request_id:crypto.randomUUID(),...extra});
 const snapshot=async r=>(await call(root(r))).data;
 const webhook=async(p,key,options={})=>{const edge=providers[p],event=edge.webhook(key,options),payload=JSON.parse(event.body);edge.issues.set(String(p==='github'?payload.issue.number:p==='linear'?payload.data.id:payload.issue.key),payload.data??payload.issue);const result=await app.call(`/api/escalations/webhooks/${ws.projectId}:${p}`,{method:'POST',body:event.body,raw:true,headers:event.headers});return {event,result}};
 return {app,providers,ws,foreign,token,base,call,records,root,share,snapshot,webhook,async close(){await app.close();await providers.close()}};
 }catch(e){await app?.close();await providers.close();throw e}
}
export async function escalationJourney(){const h=await escalationHarness({tickets:5});try{
 const {app,providers,records,share,call,root}=h;
 for(const [index,provider] of ['github','linear','jira'].entries())await share(records[index],provider);
 const first=(await h.snapshot(records[0])).links[0];
 await share(records[0],'github',{mode:'link',key:first.key});assert.equal((await h.snapshot(records[0])).links.length,1);
 await call(root(records[0])+'/slack',{channel:'C12345678',message_ids:[records[0].message.id],attachment_ids:[records[0].file.id],request_id:crypto.randomUUID()});
 await teamsSharing(h);
 for(const name of ['github','linear','jira','slack','teams']){
  const writes=providers[name].received.filter(r=>r.method==='POST');assert.ok(writes.length);
  const text=JSON.stringify(writes.map(x=>x.json));assert.ok(!text.includes('Private engineering note'));assert.ok(!text.includes('Unchosen sensitive account'));assert.ok(text.includes('/projects/'));assert.ok(text.includes('/api/escalations/attachments/'));
 }
 const preview=await call(root(records[0])+'/preview',{message_ids:[records[0].message.id],attachment_ids:[]});assert.ok(preview.data.body.includes(records[0].message.content));assert.ok(!preview.data.body.includes(records[0].omitted.content));
 assert.equal((await app.call(h.base+root(records[0])+'/links',{token:h.token,body:{provider:'github',mode:'create',title:'Denied',message_ids:[records[1].message.id],attachment_ids:[]}})).status,400);
 const payload=JSON.stringify(await call('/connections'));for(const p of Object.values(providers))if(p.token)assert.ok(!payload.includes(p.token));
 await updates(h);await erase(h);
 }finally{await h.close()}}
async function updates(h){const sockets=[];try{
 const {records,share,app,webhook}=h;
 for(const [index,p] of ['github','linear','jira'].entries()){
  const r=records[index],created={data:await h.snapshot(r)},issue=created.data.links[0],key=p==='linear'?[...h.providers[p].issues.keys()][0]:issue.key;
  const beforeNotices=new Set((await app.ok(`/api/management/projects/${h.ws.projectId}/notification-inbox`,{token:h.token})).data.map(x=>x.id));
  const now=Date.now()+10000,closed=await webhook(p,key,{closed:true,assignee:'Avery Engineer',updatedAt:now});assert.equal(closed.result.status,200);assert.equal(closed.result.data.advanced,true);
  const path=`/api/escalations/webhooks/${h.ws.projectId}:${p}`;
  assert.equal((await app.call(path,{method:'POST',raw:true,body:closed.event.body,headers:closed.event.headers})).data.duplicate,true);
  const older=h.providers[p].webhook(key,{closed:false,updatedAt:now-1000});assert.equal((await app.call(path,{method:'POST',raw:true,body:older.body,headers:older.headers})).data.advanced,false);
  const unsigned=await app.call(path,{method:'POST',raw:true,body:closed.event.body,headers:{'Content-Type':'application/json'}});assert.equal(unsigned.status,401);
  const forged=await app.call(path,{method:'POST',raw:true,body:closed.event.body+' ',headers:closed.event.headers});assert.equal(forged.status,401);
  const state=await h.snapshot(r);assert.equal(state.links[0].assignee,'Avery Engineer');assert.equal(state.links[0].recovery,'unconfirmed');assert.equal(state.drafts.length,1);assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',r.ticket.id)).n,3,'closure sends no message');
  assert.ok(await app.first('SELECT id FROM notification_inbox WHERE conversation_id=? AND user_id=?',r.ticket.id,h.ws.users.owner));
  const inbox=(await app.ok(`/api/management/projects/${h.ws.projectId}/notification-inbox`,{token:h.token})).data;assert.ok(inbox.some(x=>x.conversation_id===r.ticket.id&&!beforeNotices.has(x.id)),'the owner sees a new notice through the inbox API');
  const upgrade=await app.request(`/api/conversations/${r.ticket.id}/socket?token=${r.visitorToken}`,{headers:{Upgrade:'websocket',Origin:h.ws.allowedOrigin}});assert.equal(upgrade.status,101);const socket=upgrade.webSocket,frames=[];sockets.push(socket);socket.accept();socket.addEventListener('message',event=>frames.push(JSON.parse(event.data)));
  const frontier=await app.ok(`/api/conversations/${r.ticket.id}`,{token:h.token}),text='The export fix is available. Please try your next export and tell us how it goes.';
  const sent=await h.call(h.root(r)+`/drafts/${state.drafts[0].id}/send`,{content:text,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id});assert.equal(sent.accepted,true);
  await app.until(()=>frames.find(f=>f.type==='message'&&f.message.id===sent.message.id),{timeout:3000,message:'approved customer update on its live visitor channel'});const transcript=await app.ok(`/api/conversations/${r.ticket.id}/messages`,{token:r.visitorToken});assert.equal(transcript.messages.filter(m=>m.id===sent.message.id).length,1);
  assert.equal((await h.snapshot(r)).drafts[0].state,'sent');assert.equal((await h.snapshot(r)).links[0].recovery,'unconfirmed');
  assert.equal((await app.first('SELECT content FROM messages WHERE id=?',sent.message.id)).content,text);
  await h.call(h.root(r)+`/links/${state.links[0].id}/recovery`,{observation:'Customer confirmed the next export completed.'});assert.equal((await h.snapshot(r)).links[0].recovery,'observed');
 }
 const audits=await app.sql("SELECT action FROM audit_events WHERE action LIKE 'escalation.%'");assert.ok(audits.some(x=>x.action==='escalation.customer_update_approved'));assert.ok(audits.some(x=>x.action==='escalation.webhook_refused'));
}finally{for(const socket of sockets)socket.close()}}
async function erase(h){
 const {app,records,share}=h,r=records[0];await share(records[1],'github',{mode:'link',key:'1'});await h.call(h.root(r)+'/teams',{message_ids:[r.message.id],attachment_ids:[r.file.id],request_id:crypto.randomUUID()});
 await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(h.ws.projectId,h.ws.users.operator,Date.now()).run();
 for(const path of ['/links','/slack','/teams','/drafts/unknown/send'])assert.equal((await app.call(h.base+h.root(r)+path,{token:h.ws.tokens.operator,body:{provider:'github',mode:'link',key:'1',message_ids:[],attachment_ids:[]}})).status,403);
 assert.equal((await app.call(h.base+h.root(r),{token:h.foreign.tokens.owner})).status,403);
 await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${r.contact.id}/erase`,{token:h.token,body:{}});
 assert.equal((await app.first('SELECT count(*) n FROM escalation_links WHERE conversation_id=?',r.ticket.id)).n,0);assert.equal((await app.first('SELECT count(*) n FROM escalation_operations WHERE conversation_id=?',r.ticket.id)).n,0);assert.equal((await app.first('SELECT count(*) n FROM escalation_attachment_grants WHERE conversation_id=?',r.ticket.id)).n,0);assert.equal((await h.snapshot(records[1])).links.length,2);
 const erasure=await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${r.contact.id}/erasure`,{token:h.token});assert.ok(erasure.data.providers.requests.some(x=>x.store==='escalation:github'&&x.state==='unsupported'));assert.ok(erasure.data.providers.requests.some(x=>x.store==='escalation:teams'&&x.state==='unsupported'));assert.equal((await app.first('SELECT count(*) n FROM escalation_handoffs WHERE conversation_id=?',r.ticket.id)).n,0);assert.equal((await app.call(h.base+h.root(r),{token:h.token})).status,404);
 // A participant's incoming mail can own an attachment in another requester's ticket.
 const primary=records[2],participant=records[4];
 await app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${primary.ticket.id}/participants`,{token:h.token,body:{email:'customer-5@example.test'}});
 await app.db.batch([app.db.prepare('UPDATE media SET uploaded_by=? WHERE id=?').bind(participant.contact.id,primary.file.id),app.db.prepare("UPDATE messages SET actor_id=?,actor_role='contact' WHERE id=(SELECT message_id FROM media WHERE id=?)").bind(participant.contact.id,primary.file.id)]);
 await share(primary);
 await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${participant.contact.id}/erase`,{token:h.token,body:{}});
 assert.equal(await app.first('SELECT 1 FROM escalation_attachment_grants WHERE media_id=?',primary.file.id),null,'erasing a participant revokes their shared attachment grant');assert.equal((await h.snapshot(primary)).links.length,2,'the other requester keeps the engineering link');
 const participantErasure=await app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${participant.contact.id}/erasure`,{token:h.token});assert.ok(participantErasure.data.providers.requests.some(x=>x.store==='escalation:github'));

}

async function teamsSharing(h){
 const {app,providers,records,root}=h,r=records[3],edge=providers.teams;
 const malformed=await app.call(h.base+'/connections',{token:h.token,method:'POST',raw:true,body:'[]',headers:{'Content-Type':'application/json'}});assert.equal(malformed.status,400);
 for(const target of [edge.target.replace('/',' / '),edge.target]){
  const response=await app.call(h.base+'/connections',{token:h.token,body:{provider:'teams',target,base_url:edge.baseUrl,token:edge.token}});
  assert.equal(response.status,201,'both displayed and compact Teams targets connect');
  assert.equal(response.data.data.target,edge.target,'the stored Teams target is normalized');
  assert.equal((await app.first('SELECT target FROM escalation_teams_connections WHERE project_id=?',h.ws.projectId)).target,edge.target);
 }
 const body={message_ids:[r.message.id],attachment_ids:[r.file.id],request_id:crypto.randomUUID()};
 const send=(payload=body,token=h.token)=>app.call(h.base+root(r)+'/teams',{token,body:payload});
 const results=await Promise.all([send(),send()]);assert.ok(results.some(r=>r.status===201));assert.ok(results.every(r=>[200,201,409].includes(r.status)),JSON.stringify(results));
 assert.equal(edge.issues.size,1,'concurrent intent is claimed once');
 assert.equal((await send()).status,200);assert.equal(edge.issues.size,1,'completed intent replays locally');
 const state=await h.snapshot(r);assert.equal(state.handoffs.length,1);assert.equal(state.handoffs[0].provider,'teams');assert.equal(state.handoffs[0].state,'complete');assert.equal(state.handoffs[0].url,[...edge.issues.values()][0].webUrl);
 const outbound=[...edge.issues.values()][0].body;assert.equal(outbound.contentType,'text');assert.ok(outbound.content.includes(r.message.content));assert.ok(outbound.content.includes(`/projects/${h.ws.projectId}/conversations/${r.ticket.id}`));assert.ok(!outbound.content.includes(r.omitted.content));assert.ok(!outbound.content.includes('Private engineering note'));
 assert.equal((await send({...body,message_ids:[r.omitted.id]})).status,409);
 assert.equal((await send({...body,request_id:crypto.randomUUID(),message_ids:[records[4].message.id]})).status,400);
 // Reconnecting records the installing administrator; revoking that role denies
 // another authorized operator before any provider request.
 const admin=h.ws.users.admin;
 await h.call('/connections',{provider:'teams',target:edge.target,base_url:edge.baseUrl,token:edge.token},{token:h.ws.tokens.admin});
 await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(h.ws.projectId,admin).run();
 const count=edge.received.length;assert.equal((await send({...body,request_id:crypto.randomUUID()})).status,403);assert.equal(edge.received.length,count);
 await h.call('/connections',{provider:'teams',target:edge.target,base_url:edge.baseUrl,token:edge.token});
 edge.responses.push({disconnect:true});const unknown={...body,request_id:crypto.randomUUID()};assert.equal((await send(unknown)).status,502);const after=edge.received.length;assert.equal((await send(unknown)).status,409);assert.equal(edge.received.length,after);
 assert.ok((await h.snapshot(r)).operations.some(o=>o.id===unknown.request_id&&o.state==='uncertain'));
 edge.authorizations.clear();const revoked={...body,request_id:crypto.randomUUID()};assert.equal((await send(revoked)).status,502);const refused=edge.received.length;assert.equal((await send(revoked)).status,409);assert.equal(edge.received.length,refused);edge.authorizations.add(`Bearer ${edge.token}`);assert.ok((await h.snapshot(r)).operations.some(o=>o.id===revoked.request_id&&o.state==='failed'));
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',r.ticket.id)).n,3,'handoff and failures never publish a customer update');
 const frontier=await app.ok(`/api/conversations/${r.ticket.id}`,{token:h.token});
 const content='I have shared the selected export details with our Teams channel. Recovery is not yet confirmed.';
 const approved=await app.ok(`/api/conversations/${r.ticket.id}/messages`,{token:h.token,body:{localId:'teams-approved',content,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}});
 const transcript=await app.ok(`/api/conversations/${r.ticket.id}/messages`,{token:r.visitorToken});assert.ok(transcript.messages.some(m=>m.id===approved.message.id&&m.content===content));
}
