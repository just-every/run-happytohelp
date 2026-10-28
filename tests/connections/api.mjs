import assert from 'node:assert/strict';
import {harness,body,sha,allScopes} from './harness.mjs';
const settings='/api/management/projects/p/connections';
export async function apiJourney(){const h=await harness();try{

  const issued=await h.issue(['conversations:create'], 'p',{name:'Synthetic support',source_product:'synthetic-hh-1',create_per_minute:60}),token=issued.token;
  const metadata=(await h.call(settings+'/tokens')).data.find(row=>row.id===issued.data.id);
  assert.equal(metadata.source_product,'synthetic-hh-1');assert.equal(metadata.issuer_id,'owner');assert.ok(metadata.display_prefix);
  assert.deepEqual(metadata.scopes,['conversations:create']);assert.deepEqual(JSON.parse(metadata.bindings_json),{});
  assert.ok(!JSON.stringify(metadata).includes(token));assert.ok(!JSON.stringify(metadata).includes(sha(token)));
  const input={requester:{email:'synthetic-hh-1@example.test'},subject:'Support request',body:'Please help',source_ref:{product:'synthetic-hh-1',ref:'synthetic-hh-1',url:'https://example.test/support/1'}};
  const send=(value=input,key='synthetic-hh-1',secret=token)=>h.raw('/api/v1/conversations',{token:secret,...body(value),headers:{'Content-Type':'application/json',...(key===null?{}:{'Idempotency-Key':key})}});
  assert.equal((await send(input,null)).status,400);
  const first=await send();assert.equal(first.status,201);const created=await first.json();
  const replay=await send();assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),created);
  const conflict=await send({...input,body:'Changed'});assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'idempotency_conflict');
  const reference=await send(input,'synthetic-hh-2');assert.equal(reference.status,409);assert.equal((await reference.json()).error.conversation_id,created.data.id);
  for(let i=0;i<3;i++)assert.equal((await h.raw('/api/v1/conversations/'+created.data.id,{token})).status,403);
  const denials=(await h.call('/api/management/projects/p/audit/export?format=json')).events.filter(event=>event.action==='credential.denied'&&event.target_id===issued.data.id);
  assert.equal(denials.reduce((sum,event)=>sum+event.detail.count,0),3);
  assert.ok(!JSON.stringify(denials).includes(token));
  const stored=await h.db.prepare('SELECT * FROM contacts WHERE email=?').bind(input.requester.email).first();assert.equal(stored.is_verified,0);assert.equal(JSON.parse(stored.metadata_json).api_asserted_by,issued.data.id);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations').first()).n,1);
  assert.equal((await h.db.prepare('SELECT content FROM messages WHERE conversation_id=?').bind(created.data.id).first()).content,input.body);
  const appender=await h.issue(['messages:append'],'p',{source_product:'synthetic-hh-1',bindings:{credentials:[issued.data.id]}});
  const appendPath='/api/v1/conversations/'+created.data.id+'/append';
  const command={kind:'customer',localId:'synthetic-hh-append-1',content:'More information'};
  assert.equal((await h.raw(appendPath,{token,...body(command)})).status,403);
  const appended=await h.call(appendPath,{token:appender.token,...body(command)});assert.ok(appended.data.id);
  const appendReplay=await h.call(appendPath,{token:appender.token,...body(command)});assert.equal(appendReplay.duplicate,true);assert.equal(appendReplay.data.id,appended.data.id);
  const note=await h.call(appendPath,{token:appender.token,...body({kind:'note',localId:'synthetic-hh-note-1',content:'Machine context'})});assert.ok(note.data.id);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM api_notes WHERE conversation_id=?').bind(created.data.id).first()).n,1);
  const appendBytes='synthetic-hh-append-attachment';
  await h.session('synthetic-hh-requester','p',stored.id);
  for(const kind of ['customer','note']){
   const upload=await h.call('/api/v1/uploads',{token:appender.token,method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'append.txt'},body:appendBytes});
   const value={kind,localId:'synthetic-hh-file-'+kind,content:'Attached context',attachments:[{upload_id:upload.data.id}]};
   const attached=await h.call(appendPath,{token:appender.token,...body(value)});
   const file=await h.db.prepare(kind==='customer'?'SELECT * FROM media WHERE message_id=?':'SELECT m.* FROM media m JOIN api_note_media n ON n.media_id=m.id WHERE n.note_id=?').bind(attached.data.id).first();
   assert.ok(file);assert.equal(await (await h.raw('/api/conversations/'+created.data.id+'/media/'+file.id)).text(),appendBytes);
   assert.equal((await h.raw('/api/conversations/'+created.data.id+'/media/'+file.id,{actor:'synthetic-hh-requester'})).status,kind==='note'?404:200);
   assert.equal((await h.call(appendPath,{token:appender.token,...body(value)})).data.id,attached.data.id);
  }
  const beforeAppendFailure=await h.db.prepare('SELECT (SELECT count(*) FROM messages) messages,(SELECT count(*) FROM media) media,(SELECT count(*) FROM api_notes) notes').first();
  h.responses.push({status:200,body:'changed',headers:{'Content-Type':'text/plain'}});
  const badAppend=await h.raw(appendPath,{token:appender.token,...body({kind:'customer',localId:'synthetic-hh-bad-append',content:'Atomic refusal',attachments:[{url:'https://receiver.example.com/append-file',sha256:sha(appendBytes)}]})});
  assert.equal(badAppend.status,400);assert.deepEqual(await h.db.prepare('SELECT (SELECT count(*) FROM messages) messages,(SELECT count(*) FROM media) media,(SELECT count(*) FROM api_notes) notes').first(),beforeAppendFailure);
  const reader=await h.issue(['conversations:read'],'p',{source_product:'synthetic-hh-1',bindings:{credentials:[issued.data.id]}});
  assert.equal((await h.call('/api/v1/conversations',{token:reader.token})).data.length,1);
  const stranger=await h.issue(['messages:append'],'p',{source_product:'synthetic-hh-other'});
  const foreignAppender=await h.issue(['messages:append'],'q',{source_product:'synthetic-hh-1',bindings:{credentials:[issued.data.id]}});
  const refusedUpload=await h.call('/api/v1/uploads',{token:appender.token,method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'refused.txt'},body:'Synthetic refused attachment'});
  const beforeRefusedMedia=(await h.db.prepare('SELECT count(*) n FROM media').first()).n;
  for(const secret of [stranger.token,foreignAppender.token])for(const kind of ['customer','note']){
   const denied=await h.raw(appendPath,{token:secret,...body({...command,kind,localId:'synthetic-denied-'+kind,attachments:[{upload_id:refusedUpload.data.id}]})});assert.equal(denied.status,404);
   assert.equal((await denied.json()).error.code,'not_found');assert.equal((await h.db.prepare('SELECT count(*) n FROM media').first()).n,beforeRefusedMedia);
  }
  const isolated=await h.issue(['conversations:read'],'p',{source_product:'synthetic-hh-2'});assert.equal((await h.call('/api/v1/conversations',{token:isolated.token})).data.length,0);
  const management='/api/management/projects/p/conversations/'+created.data.id+'/ticket';
  assert.deepEqual((await h.call(management)).data.api,{credential_name:'Synthetic support',source_product:'synthetic-hh-1',source_ref:input.source_ref.ref,source_url:input.source_ref.url});


  // Rotation keeps the same machine request identity; erasure fences both keys.
  const rotated=await h.call(settings+'/tokens/'+issued.data.id+'/rotate',body({overlap_seconds:0}));
  assert.deepEqual(await (await send(input,'synthetic-hh-1',rotated.token)).json(),created);
  await h.call('/api/management/projects/p/contacts/'+stored.id+'/erase',body({}));
  assert.equal((await h.db.prepare('SELECT count(*) n FROM api_requests WHERE contact_id=? AND response_json IS NOT NULL').bind(stored.id).first()).n,0);
  for(const key of ['synthetic-hh-1','synthetic-hh-new']){const erased=await send(input,key,rotated.token);assert.equal(erased.status,409);assert.equal((await erased.json()).error.code,'identity_erased');}
  await h.call(settings+'/tokens/'+rotated.data.id,{method:'DELETE'});assert.equal((await send(input,'synthetic-hh-1',rotated.token)).status,401);
  await nativeOperations(h);
 }finally{await h.close()}
}

async function nativeOperations(h){
 const outboundBefore=h.external;
 await h.contact();await h.contact('foreign-visitor','q');
 const c=await h.conversation(),foreign=await h.conversation('foreign-visitor','q'),issued=await h.issue(allScopes),token=issued.token;
 const readOnly=await h.issue(['contacts:read']);
 const persisted=await h.db.prepare('SELECT token_hash FROM integration_tokens WHERE id=?').bind(issued.data.id).first();assert.equal(persisted.token_hash,sha(token));
 const expiring=await h.issue(['contacts:read'],'p',{expires_at:new Date(Date.now()+60000).toISOString()});await h.db.prepare('UPDATE api_credentials SET expires_at=1 WHERE id=?').bind(expiring.data.id).run();assert.equal((await h.raw('/api/v1/contacts',{token:expiring.token})).status,401);
 assert.equal((await h.raw('/api/v1/contacts',{token:null,headers:{Cookie:'h2h_session='+h.sessionToken('owner')}})).status,401);
 assert.equal((await h.raw('/api/v1/contacts',{token,headers:{Origin:'https://app.example'}})).headers.get('Access-Control-Allow-Origin'),null);

 assert.equal((await h.raw('/api/v1/conversations',{token:readOnly.token})).status,403);
 for(const kind of ['tokens','webhooks','slack','deliveries'])assert.equal((await h.raw(settings+'/'+kind,{token})).status,404,'a machine grant is not a native settings session');
 assert.equal((await h.raw('/api/v1/conversations/'+foreign.id,{token})).status,404);
 assert.equal((await h.raw('/api/v1/contacts/foreign-visitor',{token})).status,404);
 const command={content:'Native API reply',localId:'api-reply',expectedRevision:0,expectedLastMessageId:null};
 const first=await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body(command)});
 const replay=await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body(command)});assert.equal(replay.duplicate,true);assert.equal(replay.data.id,first.data.id);
 await h.call('/api/v1/conversations/'+c.id+'/resolve',{token,...body({})});assert.ok((await h.db.prepare('SELECT resolved_at FROM conversations WHERE id=?').bind(c.id).first()).resolved_at);
 const contact=await h.call('/api/v1/contacts',{token,...body({name:'API customer',email:'api@example.test'})});
 await h.call('/api/v1/contacts/'+contact.data.id,{token,...body({name:'Updated customer'}),method:'PUT'});assert.equal((await h.call('/api/v1/contacts/'+contact.data.id,{token})).data.name,'Updated customer');
 const article=await h.call('/api/v1/articles',{token,...body({title:'Integration guide',content:'Guide body',status:'draft'})});
 await h.call('/api/v1/articles/'+article.data.id,{token,...body({title:'Integration guide',content:'Published guide',status:'published'}),method:'PUT'});assert.equal((await h.call('/api/v1/articles/'+article.data.id,{token})).data.status,'published');
 const seen=[];let cursor=null;
 do{const page=await h.call('/api/v1/conversations?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token});seen.push(...page.data.map(row=>row.id));cursor=page.next_cursor;}while(cursor);
 assert.ok(seen.includes(c.id));assert.ok(!seen.includes(foreign.id));assert.equal(new Set(seen).size,seen.length);
 const now=Math.floor(Date.now()/60000)*60000;
 await h.db.prepare('UPDATE abuse_counters SET window_start=?,used=120,expires_at=? WHERE key=?').bind(now,now+60000,'rate:apiRequestsPerTokenMinute:'+sha(readOnly.data.id)).run();
 const limited=await h.raw('/api/v1/contacts',{token:readOnly.token});assert.equal(limited.status,429);assert.ok(limited.headers.get('Retry-After'));
 await h.call(settings+'/tokens/'+issued.data.id,{method:'DELETE'});assert.equal((await h.raw('/api/v1/contacts',{token})).status,401);
 assert.ok((await h.db.prepare("SELECT count(*) n FROM integration_token_events WHERE token_id=? AND action='revoked'").bind(issued.data.id).first()).n);
 assert.ok(!(JSON.stringify(await h.call(settings+'/tokens'))).includes(token));assert.equal(h.external,outboundBefore);
}
