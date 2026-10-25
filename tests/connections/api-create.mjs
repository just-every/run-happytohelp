import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {harness,body,sha} from './harness.mjs';
const settings='/api/management/projects/p/connections';
async function existingCredentialLifecycle(){
 const h=await harness();try{
  const issued=await h.issue(['contacts:read']),token=issued.token;assert.ok(/^int_[a-f0-9]{64}$/.test(token));
  const stored=await h.db.prepare('SELECT * FROM integration_tokens WHERE id=?').bind(issued.data.id).first();assert.ok(stored.token_hash===sha(token));assert.ok(!JSON.stringify(stored).includes(token));
  const list=await h.call(settings+'/tokens');assert.equal(list.data.length,1);assert.ok(!JSON.stringify(list).includes(token));assert.equal(list.data[0].last_used_at,null);
  for(const [headers,status] of [[{},401],[{Cookie:'h2h_session='+h.sessionToken('owner')},401],[{Authorization:'Bearer invalid',Cookie:'h2h_session='+h.sessionToken('owner')},401],[{Authorization:'Bearer '+token,Cookie:'h2h_session=invalid'},200]]){
   const result=await h.raw('/api/v1/contacts',{token:null,headers:{...headers,Origin:'https://app.example'}});assert.equal(result.status,status);assert.equal(result.headers.get('Access-Control-Allow-Origin'),null)
  }
  const wrong=await h.raw('/api/v1/conversations',{token});assert.equal(wrong.status,403);assert.equal((await wrong.json()).error.code,'insufficient_scope');
  for(const path of ['/api/v1/contacts','/api/v1/missing']){const r=await h.raw(path,{token,method:'OPTIONS',headers:{Origin:'https://app.example','Access-Control-Request-Headers':'Authorization'}});assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(r.headers.get('Access-Control-Allow-Headers'),null)}
  assert.ok((await h.call(settings+'/tokens')).data[0].last_used_at);
  const usage=await h.call(settings+'/tokens/usage');assert.ok(usage.data.some(x=>x.allowed)&&usage.data.some(x=>!x.allowed));assert.ok(usage.data.every(x=>x.requestId&&x.resource));assert.ok(!JSON.stringify(usage).includes(token));
  await h.db.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='owner'").run();assert.equal((await h.raw('/api/v1/contacts',{token})).status,200,'workspace grant outlives issuer membership');
  await h.db.prepare("INSERT INTO memberships VALUES('p','owner','owner')").run();
  await h.call(settings+'/tokens/'+issued.data.id,{method:'DELETE'});assert.equal((await h.raw('/api/v1/contacts',{token})).status,401);
  const expiring=await h.issue(['contacts:read'], 'p',{expires_at:new Date(Date.now()+60000).toISOString()});await h.db.prepare('UPDATE integration_tokens SET expires_at=1 WHERE id=?').bind(expiring.data.id).run();assert.equal((await h.raw('/api/v1/contacts',{token:expiring.token})).status,401);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM integration_token_events WHERE token_id=? AND action='issued'").bind(issued.data.id).first()).n,1);assert.equal((await h.db.prepare("SELECT count(*) n FROM integration_token_events WHERE token_id=? AND action='revoked'").bind(issued.data.id).first()).n,1);
 }finally{await h.close()}
}
test('machine create credentials admit one atomic ticket and replay across rotation without granting other scopes',async()=>{
 await existingCredentialLifecycle();
 const h=await harness();try{
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
  for(const secret of [stranger.token,foreignAppender.token]){
   const denied=await h.raw(appendPath,{token:secret,...body({...command,localId:'synthetic-denied'})});assert.equal(denied.status,404);
   assert.equal((await denied.json()).error.code,'not_found');
  }
  const isolated=await h.issue(['conversations:read'],'p',{source_product:'synthetic-hh-2'});assert.equal((await h.call('/api/v1/conversations',{token:isolated.token})).data.length,0);
  const management='/api/management/projects/p/conversations/'+created.data.id+'/ticket';
  for(const category of ['solved','closed']){
   const ticket=(await h.call(management)).data;
   await h.call(management,{...body({expected_version:ticket.ticket_version,status_id:category}),method:'PATCH'});
   const continued=await h.call(appendPath,{token:appender.token,...body({kind:'customer',localId:'synthetic-hh-'+category,content:'Customer follows up'})});
   if(category==='solved')assert.equal((await h.call(management)).data.status_category,'open');
   else{assert.notEqual(continued.data.conversation_id,created.data.id);assert.equal((await h.call(management)).data.status_category,'closed')}
  }
  const count=async()=>(await h.db.prepare('SELECT count(*) n FROM conversations').first()).n;
  const beforeBad=await count();
  for(const extra of [{assigned_to:'owner'},{status_id:'solved'},{tags:['synthetic-missing']},{source_ref:{...input.source_ref,product:'spoofed'}},{brand_id:'q'}]){
   const refused=await send({...input,...extra},'synthetic-invalid-'+Object.keys(extra)[0]);assert.equal(refused.status,403);assert.equal(await count(),beforeBad);
  }
  const file='Synthetic attachment bytes',fileDigest=sha(file);
  const attached={requester:{external_id:'synthetic-files'},subject:'Attachment request',body:'Attached context',attachments:[{url:'https://receiver.example.com/file',sha256:fileDigest,filename:'context.txt'}]};
  h.responses.push({status:200,body:file,headers:{'Content-Type':'text/plain'},delay:300});
  const concurrent=await Promise.all([send(attached,'synthetic-concurrent'),send(attached,'synthetic-concurrent')]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
  const rejected=concurrent.find(r=>r.status===409);assert.equal((await rejected.json()).error.code,'in_progress');assert.ok(rejected.headers.get('Retry-After'));
  const withFile=await concurrent.find(r=>r.status===201).json();
  const media=await h.db.prepare('SELECT * FROM media WHERE conversation_id=?').bind(withFile.data.id).first();assert.equal(media.size,Buffer.byteLength(file));
  const attachmentRead=await h.raw('/api/conversations/'+withFile.data.id+'/media/'+media.id);assert.equal(await attachmentRead.text(),file);
  for(const response of [{status:302,headers:{Location:'https://receiver.example.com/other'}},{status:200,body:'Changed',headers:{'Content-Type':'text/plain'}},{status:200,body:file,headers:{'Content-Type':'application/javascript'}},{status:200,body:'',headers:{'Content-Length':'20000001','Content-Type':'text/plain'}}]){
   h.responses.push(response);const before=await count(),refused=await send(attached,'synthetic-file-'+response.status+'-'+Object.keys(response.headers).join());assert.ok([400,413,415].includes(refused.status));assert.equal(await count(),before);
  }
  const privateFile=await send({...attached,attachments:[{url:'https://127.0.0.1/file',sha256:fileDigest}]},'synthetic-private');assert.equal(privateFile.status,400);
  const uploaded=await h.call('/api/v1/uploads',{token,method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'context.txt'},body:file});
  const uploadedTicket=await send({...attached,attachments:[{upload_id:uploaded.data.id}]},'synthetic-upload');assert.equal(uploadedTicket.status,201);
  await h.call('/api/management/projects/p/sender-rules',body({address:'synthetic-blocked@example.test',action:'block'}));
  const held=await send({requester:{email:'synthetic-blocked@example.test'},subject:'Held request',body:'Review this'},'synthetic-held');assert.equal(held.status,202);const heldData=await held.json();assert.equal(heldData.data.state,'held_for_review');
  const review=await h.call('/api/management/projects/p/suspended');assert.ok(review.data.some(row=>row.id===heldData.data.id));
  const released=await h.call('/api/management/projects/p/suspended/'+heldData.data.id+'/recover',body({}));assert.ok(released.conversationId);
  const limited=await h.issue(['conversations:create'],'p',{source_product:'synthetic-limit',create_per_minute:1});
  const limitedBody={requester:{external_id:'synthetic-limit'},subject:'Quota test',body:'One request'};
  assert.equal((await send(limitedBody,'synthetic-limit-1',limited.token)).status,201);
  const over=await send(limitedBody,'synthetic-limit-2',limited.token);assert.equal(over.status,429);assert.equal((await over.json()).error.code,'credential');for(const header of ['Retry-After','RateLimit-Limit','RateLimit-Remaining','RateLimit-Reset'])assert.ok(over.headers.get(header));
  await h.contact('synthetic-verified-email');await h.contact('synthetic-verified-external');
  await h.db.prepare("UPDATE contacts SET email='synthetic-verified@example.test',external_id='synthetic-verified@example.test',is_verified=1 WHERE id='synthetic-verified-email'").run();
  await h.db.prepare("UPDATE contacts SET external_id='synthetic-hh-1:synthetic-verified-external',is_verified=1 WHERE id='synthetic-verified-external'").run();
  const identityBody={subject:'Identity check',body:'No history disclosure',requester:{email:'synthetic-verified@example.test',external_id:'synthetic-verified-external'}};
  const identityConflict=await send(identityBody,'synthetic-identity-conflict');assert.equal(identityConflict.status,409);assert.deepEqual((await identityConflict.json()).error,{code:'identity_conflict',message:'identity_conflict'});
  for(const [kind,requester] of [['email',{email:'synthetic-verified@example.test'}],['external',{external_id:'synthetic-verified-external'}],['phone',{phone:'+12025550123'}]]){
   const response=await send({...identityBody,requester},'synthetic-identity-'+kind);assert.equal(response.status,201);assert.deepEqual(Object.keys((await response.json()).data).sort(),Object.keys(created.data).sort());
  }
  // Every supported identity key has both a verified match and an unverified assertion.
  // The setup rows are prior data; every match and erasure is exercised through public doors.
  for(const kind of ['email','phone','external']){
   const identity=kind==='email'?{email:'synthetic-hh-matrix@example.test'}:kind==='phone'?{phone:'+12025550129'}:{external_id:'synthetic-hh-matrix'};
   const fixture='synthetic-hh-matrix-'+kind;
   await h.contact(fixture);
   await h.db.prepare('UPDATE contacts SET email=?,external_id=?,is_verified=1,metadata_json=? WHERE id=?').bind(identity.email??null,identity.external_id?'synthetic-hh-1:'+identity.external_id:identity.email??null,JSON.stringify(identity.phone?{phone:identity.phone,phone_verified:1}:{}),fixture).run();
   const oldTicket=await h.conversation(fixture);
   const before=(await h.db.prepare('SELECT count(*) n FROM contacts').first()).n;
   const matched=await send({subject:'Verified requester',body:'New request only',requester:identity},'synthetic-hh-match-'+kind);
   assert.equal(matched.status,201);const matchedData=(await matched.json()).data;
   assert.deepEqual(Object.keys(matchedData).sort(),Object.keys(created.data).sort());
   assert.equal((await h.db.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(matchedData.id).first()).contact_id,fixture);
   assert.equal((await h.db.prepare('SELECT count(*) n FROM contacts').first()).n,before);
   assert.equal((await h.raw('/api/v1/conversations/'+oldTicket.id,{token:reader.token})).status,404);
   assert.equal((await h.raw('/api/v1/conversations/'+oldTicket.id+'/messages',{token:reader.token})).status,404);
   await h.call('/api/management/projects/p/contacts/'+fixture+'/erase',body({}));
   for(const key of ['synthetic-hh-match-'+kind,'synthetic-hh-erased-'+kind]){
    const erased=await send({subject:'Verified requester',body:'New request only',requester:identity},key);
    assert.equal(erased.status,409);assert.equal((await erased.json()).error.code,'identity_erased');
   }
   const fresh=kind==='email'?{email:'synthetic-hh-new@example.test'}:kind==='phone'?{phone:'+12025550128'}:{external_id:'synthetic-hh-new'};
   const createdResponse=await send({subject:'Asserted requester',body:'No verification supplied',requester:fresh},'synthetic-hh-new-'+kind);
   assert.equal(createdResponse.status,201);const freshData=(await createdResponse.json()).data;
   const asserted=await h.db.prepare('SELECT ct.* FROM contacts ct JOIN conversations c ON c.contact_id=ct.id WHERE c.id=?').bind(freshData.id).first();
   assert.equal(asserted.is_verified,0);assert.equal(JSON.parse(asserted.metadata_json).api_asserted_by,issued.data.id);
   assert.deepEqual(Object.keys(freshData).sort(),Object.keys(matchedData).sort());
  }
  const bound=await h.issue(['conversations:create'],'p',{source_product:'synthetic-hh-bound',bindings:{brands:['p'],mailboxes:['synthetic-hh-mailbox']}});
  await h.db.prepare("INSERT INTO mailbox_connections(id,project_id,provider,address,status,connected_by,created_at,updated_at) VALUES('synthetic-hh-mailbox','p','forwarding','synthetic-hh-mailbox@example.test','connected','owner',1,1)").run();
  const boundInput={requester:{external_id:'synthetic-hh-bound'},subject:'Bound request',body:'No adjustment',brand_id:'p',mailbox_id:'synthetic-hh-mailbox'};
  const boundCreated=await send(boundInput,'synthetic-hh-bound-valid',bound.token);assert.equal(boundCreated.status,201);
  const boundTicket=(await h.call('/api/management/projects/p/conversations/'+(await boundCreated.json()).data.id+'/ticket')).data;
  assert.equal(boundTicket.mailbox_id,'synthetic-hh-mailbox');assert.equal(boundTicket.brand_id,'p');
  for(const extra of [{brand_id:'q',mailbox_id:'synthetic-hh-mailbox'},{brand_id:'p',mailbox_id:'synthetic-hh-other'},{brand_id:'p'}]){
   const before=await count();const refused=await send({requester:{external_id:'synthetic-hh-bound'},subject:'Bound request',body:'No adjustment',...extra},'synthetic-hh-bound-'+Object.values(extra).join('-'),bound.token);
   assert.equal(refused.status,403);assert.equal((await refused.json()).error.code,'outside_credential_bounds');assert.equal(await count(),before);
  }
  const hook=await h.call(settings+'/webhooks',body({name:'Synthetic machine hook',url:'https://receiver.example.com/machine-hook',events:['conversation.created','message.created','conversation.status_changed','conversation.assigned'],credential_id:issued.data.id}));
  const hookTicket=await send({requester:{external_id:'synthetic-hook'},subject:'Hook ticket',body:'Private body must not reach webhook'},'synthetic-hook');assert.equal(hookTicket.status,201);const hookId=(await hookTicket.json()).data.id;
  const hookManagement='/api/management/projects/p/conversations/'+hookId+'/ticket';const hookState=(await h.call(hookManagement)).data;
  await h.call(hookManagement,{...body({expected_version:hookState.ticket_version,status_id:'pending',assigned_to:'owner'}),method:'PATCH'});
  await h.dispatch();const receipts=h.received.filter(r=>r.path.endsWith('/machine-hook'));assert.deepEqual(new Set(receipts.map(r=>JSON.parse(r.body).event)),new Set(['conversation.created','message.created','conversation.status_changed','conversation.assigned']));
  for(const receipt of receipts){const event=JSON.parse(receipt.body);assert.equal(event.data.conversation_id,hookId);const headers=receipt.headers;const signature=createHmac('sha256',Buffer.from(hook.secret,'hex')).update(JSON.stringify(['integrations.webhook.v1','p',hook.id,event.event,event.id,headers['webhook-timestamp'],receipt.body.toString('utf8')])).digest('hex');assert.equal(headers['webhook-signature'],'v1='+signature);assert.ok(!receipt.body.toString().includes('Private body'));assert.ok(!receipt.body.toString().includes('@'))}
  const rotated=await h.call('/api/management/projects/p/connections/tokens/'+issued.data.id+'/rotate',body({overlap_seconds:1}));
  const after=await send(input,'synthetic-hh-1',rotated.token);assert.equal(after.status,201);assert.deepEqual(await after.json(),created);
  const old=await send();assert.equal(old.status,201);
  await h.call('/api/management/projects/p/contacts/'+stored.id+'/erase',body({}));
  for(const key of ['synthetic-hh-1','synthetic-hh-3']){const erased=await send(input,key,rotated.token);assert.equal(erased.status,409);assert.equal((await erased.json()).error.code,'identity_erased')}
  assert.equal((await h.db.prepare('SELECT response_json FROM api_requests WHERE key_digest=?').bind(sha('synthetic-hh-1')).first()).response_json,null);
  await new Promise(resolve=>setTimeout(resolve,1100));assert.equal((await send()).status,401);
  await h.call(settings+'/tokens/'+rotated.data.id,{method:'DELETE'});
  assert.equal((await send(input,'synthetic-hh-1',rotated.token)).status,401);
  // Hold only the attachment network response while revocation crosses admission.
  const racing=await h.issue(['conversations:create'],'p',{source_product:'synthetic-hh-race'});
  const raceBody={requester:{external_id:'synthetic-hh-race'},subject:'Atomic authority',body:'No partial request',attachments:[{url:'https://receiver.example.com/race-file',sha256:sha('synthetic-hh-race'),filename:'race.txt'}]};
  h.responses.push({status:200,body:'synthetic-hh-race',headers:{'Content-Type':'text/plain'},delay:1000});
  const beforeRace=await count(),pending=send(raceBody,'synthetic-hh-race',racing.token);
  const deadline=Date.now()+10000;while(!h.received.some(r=>r.path.endsWith('/race-file'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(h.received.some(r=>r.path.endsWith('/race-file')));
  await h.call(settings+'/tokens/'+racing.data.id,{method:'DELETE'});
  const raced=await pending;assert.equal(raced.status,503);assert.equal(await count(),beforeRace);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM api_requests WHERE source_product=?').bind('synthetic-hh-race').first()).n,0);
  assert.equal((await send(raceBody,'synthetic-hh-race',racing.token)).status,401);
 }finally{await h.close()}
});
