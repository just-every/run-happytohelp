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
// One engineering support flow, with issue providers as transport variants.
export async function engineeringJourney(){
 const h=await escalationHarness({tickets:3}),{app,providers,records,root,token,ws}=h
 try{
  for(const [index,provider] of ['github','linear','jira'].entries()){
   const r=records[index],requestId=crypto.randomUUID(),created=await h.share(r,provider,{request_id:requestId})
   await h.share(r,provider,{request_id:requestId});assert.equal((await h.snapshot(r)).links.length,1)
   const issue=created.data.links[0],key=provider==='linear'?[...providers[provider].issues.keys()][0]:issue.key
   const writes=providers[provider].received.filter(row=>row.method==='POST'),text=JSON.stringify(writes.map(row=>row.json))
   assert.ok(text.includes(r.message.content));assert.ok(text.includes('/api/escalations/attachments/'));assert.ok(!text.includes('Private engineering note'));assert.ok(!text.includes('Unchosen sensitive account'))
   const now=Date.now()+10000,closed=await h.webhook(provider,key,{closed:true,assignee:'Avery Engineer',updatedAt:now})
   assert.equal(closed.result.status,200);assert.equal(closed.result.data.advanced,true)
   const path=`/api/escalations/webhooks/${ws.projectId}:${provider}`
   assert.equal((await app.call(path,{method:'POST',raw:true,body:closed.event.body,headers:closed.event.headers})).data.duplicate,true)
   const older=providers[provider].webhook(key,{closed:false,updatedAt:now-1000})
   assert.equal((await app.call(path,{method:'POST',raw:true,body:older.body,headers:older.headers})).data.advanced,false)
   assert.equal((await app.call(path,{method:'POST',raw:true,body:closed.event.body,headers:{'Content-Type':'application/json'}})).status,401)
   const state=await h.snapshot(r);assert.equal(state.links[0].recovery,'unconfirmed');assert.equal(state.drafts.length,1)
   assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',r.ticket.id)).n,3,'an engineering update only drafts a customer reply')
   const frontier=await app.ok(`/api/conversations/${r.ticket.id}`,{token}),content='The export fix is available. Please try again and tell us the result.'
   const approved=await h.call(root(r)+`/drafts/${state.drafts[0].id}/send`,{content,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id})
   assert.equal(approved.accepted,true)
   assert.ok((await app.ok(`/api/conversations/${r.ticket.id}/messages`,{token:r.visitorToken})).messages.some(message=>message.id===approved.message.id))
   assert.equal((await h.snapshot(r)).links[0].recovery,'unconfirmed')
   await h.call(root(r)+`/links/${state.links[0].id}/recovery`,{observation:'Customer confirmed the next export completed.'});assert.equal((await h.snapshot(r)).links[0].recovery,'observed')
  }
  const r=records[0],selection={message_ids:[r.message.id],attachment_ids:[r.file.id],request_id:crypto.randomUUID()}
  await h.call(root(r)+'/slack',{...selection,channel:'C12345678'});await h.call(root(r)+'/teams',{...selection,request_id:crypto.randomUUID()})
  for(const provider of ['slack','teams']){const text=JSON.stringify(providers[provider].received.filter(row=>row.method==='POST').map(row=>row.json));assert.ok(text.includes(r.message.content));assert.ok(!text.includes('Private engineering note'));assert.ok(!text.includes('Unchosen sensitive account'))}
  const edge=providers.teams
  await h.call('/connections',{provider:'teams',target:edge.target,base_url:edge.baseUrl,token:edge.token},{token:ws.tokens.admin})
  await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(ws.projectId,ws.users.admin).run()
  const afterInstall=edge.received.length
  assert.equal((await app.call(h.base+root(r)+'/teams',{token,body:{...selection,request_id:crypto.randomUUID()}})).status,403);assert.equal(edge.received.length,afterInstall)
  await h.call('/connections',{provider:'teams',target:edge.target,base_url:edge.baseUrl,token:edge.token})
  edge.responses.push({disconnect:true});const unknown={...selection,request_id:crypto.randomUUID()}
  assert.equal((await app.call(h.base+root(r)+'/teams',{token,body:unknown})).status,502)
  const received=edge.received.length;assert.equal((await app.call(h.base+root(r)+'/teams',{token,body:unknown})).status,409)
  await app.configure({});await app.scheduled();assert.equal(edge.received.length,received)
  assert.ok((await h.snapshot(r)).operations.some(operation=>operation.id===unknown.request_id&&operation.state==='uncertain'))
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(ws.projectId,ws.users.operator,Date.now()).run()
  assert.equal((await app.call(h.base+root(r)+'/links',{token:ws.tokens.operator,body:{provider:'github',mode:'link',key:'1',message_ids:[]}})).status,403)
  assert.equal((await app.call(h.base+root(r),{token:h.foreign.tokens.owner})).status,403)
  await app.ok(`/api/management/projects/${ws.projectId}/contacts/${r.contact.id}/erase`,{token,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM escalation_attachment_grants WHERE conversation_id=?',r.ticket.id)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM escalation_links WHERE conversation_id=?',r.ticket.id)).n,0)
  assert.equal((await h.snapshot(records[1])).links.length,1,'another customer retains their engineering case')
  const erasure=(await app.ok(`/api/management/projects/${ws.projectId}/contacts/${r.contact.id}/erasure`,{token})).data
  assert.ok(erasure.providers.requests.some(row=>row.store==='escalation:github'&&row.state==='unsupported'));assert.ok(erasure.providers.requests.some(row=>row.store==='escalation:teams'&&row.state==='unsupported'))
 }finally{await h.close()}
}
