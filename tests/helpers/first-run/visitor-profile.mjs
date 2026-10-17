import assert from 'node:assert/strict'
import {profileApp,hash,literal} from './profile-app.mjs'


// Expected identity is declared before session creation or collector writes.
const trusted={name:'Trusted account name',email:'trusted-account@example.test',identifier:'account-verified-42'};
const signedMetadata={plan:'gold',private_note:'Keep this private',source:'https://example.test/é'};
const canonical=row=>({name:row.name,email:row.email,identifier:row.external_id,verified:row.is_verified===1});
const row=(h,id)=>h.db.prepare('SELECT * FROM contacts WHERE id=?').bind(id).first();
const profile=(id,expected)=>({id,name:expected.name,email:expected.email,verified:expected.verified});
// Session admission collects request context before the collector runs. Its
// server time is bounded by this request, and collector edits must retain it.
async function observedContext(h,id,admittedAfter){
 const metadata=JSON.parse((await row(h,id)).metadata_json);
 assert.ok(metadata.last_seen_at>=admittedAfter&&metadata.last_seen_at<=Date.now());
 assert.equal(typeof metadata.ip_address,'string');assert.ok(metadata.ip_address.length);
 assert.match(metadata.country_code,/^[A-Z]{2}$/);
 assert.equal(typeof metadata.user_agent,'string');assert.ok(metadata.user_agent.length);
 return {last_seen_at:metadata.last_seen_at,ip_address:metadata.ip_address,country_code:metadata.country_code,user_agent:metadata.user_agent};
}

async function visitor(h,key,options={}){
 const session=await h.widgetSession(key,options);
 const response=await h.raw('/api/conversations',{actor:key,method:'POST',body:{projectId:session.projectId}});
 assert.equal(response.status,201);return {...session,conversationId:(await response.json()).id};
}
const collect=(h,key,id,data)=>h.raw('/api/conversations/'+id+'/widget-events',{actor:key,method:'POST',body:{action:'contact',data}});
async function owner(h){
 await h.db.prepare("INSERT INTO users VALUES('owner','owner@example.test','Owner',1)").run();
 await h.db.prepare("INSERT INTO memberships VALUES('p','owner','owner')").run();await h.session('owner','p','owner',{role:'owner'});
}
// A write committed by a concurrent request just before the collector's contact update.
const racing=command=>({'x-test-before-statement':literal(command.sql,...(command.params||[])),'x-test-statement':'UPDATE contacts SET'})

// A visitor's saved profile: the widget reads its current saved fields without writes or disclosure under current
// authority only, and signed identity stays canonical while the collector keeps what the visitor provided apart.
export async function visitorProfileJourney(){
 for(const part of [savedFields,refusals,noDatabase,corsAndErasure,readRaces,signedIdentity,signedEmail,collectorFences,collectorRaces,verifiedMidway])await part()
}

// Visitor profile reads current saved fields without writes, metadata disclosure, or verification promotion.
async function savedFields(){
 const h=await profileApp();
 try{
  await h.contact('visitor');await h.contact('signed','p',{verified:true});await h.contact('foreign','q');
  const before=await h.snapshot();
  for(const [actor,verified] of [['visitor',false],['signed',true]]){
   const response=await h.raw(undefined,{actor});assert.equal(response.status,200);
   assert.match(response.headers.get('Cache-Control'),/no-store/);
   assert.deepEqual(await response.json(),{contact:{id:actor,name:'Saved '+actor,email:actor+'@example.test',verified}});
  }
  const own=await h.raw('/api/identity/widget/profile?contactId=foreign&projectId=q');
  assert.equal(own.status,200);assert.equal((await own.json()).contact.id,'visitor','caller IDs cannot select a profile');
  for(const id of ['foreign','missing'])assert.equal((await h.raw('/api/identity/widget/profile/'+id)).status,404);
  assert.deepEqual(await h.snapshot(),before,'profile hydration is a read, including native authority epochs and outboxes');
  assert.equal(h.external,0);
 }finally{await h.close();}
}

// Visitor profile refuses non-visitor, missing, expired, revoked, blocked, deleted and cross-project authority.
async function refusals(){
 const h=await profileApp();
 try{
  await h.contact('visitor');await h.contact('foreign','q');
  await h.db.prepare("INSERT INTO users VALUES('owner','owner@example.test','Owner',1)").run();
  await h.db.prepare("INSERT INTO memberships VALUES('p','owner','owner')").run();await h.session('owner','p','owner',{role:'owner'});
  for(const headers of [{},{Cookie:'h2h_session='+h.token('visitor')},{Authorization:'Bearer invalid',Cookie:'h2h_session='+h.token('visitor')}])assert.equal((await h.raw(undefined,{actor:null,headers})).status,401);
  assert.equal((await h.raw(undefined,{actor:'owner'})).status,404);
  await h.session('mismatched','p','foreign');assert.equal((await h.raw(undefined,{actor:'mismatched'})).status,404);
  for(const [field,value] of [['expires_at',Date.now()-1],['revoked_at',Date.now()]]){
   await h.db.prepare('UPDATE sessions SET '+field+'=? WHERE token_hash=?').bind(value,hash(h.token('visitor'))).run();
   assert.equal((await h.raw()).status,401);await h.session('visitor','p','visitor');
  }
  for(const flag of ['is_blocked','is_deleted','is_erasing','is_erased']){
   await h.db.prepare('UPDATE contacts SET metadata_json=? WHERE id=?').bind(JSON.stringify({[flag]:true}),'visitor').run();
   const response=await h.raw();assert.ok([401,404].includes(response.status));assert.doesNotMatch(await response.text(),/Saved visitor|visitor@example/);
  }
  await h.db.prepare("UPDATE contacts SET metadata_json='{}' WHERE id='visitor'").run();
  await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"deleted_at\":1}',1)").run();
  assert.equal((await h.raw()).status,401);assert.equal(h.external,0);
 }finally{await h.close();}
}

// Native integration bearer and cookie-only profile requests do no database work.
async function noDatabase(){
 const h=await profileApp();
 try{
  for(const [headers,status] of [[{Authorization:'Bearer int_'+'a'.repeat(64)},404],[{Cookie:'h2h_session=untrusted'},401],[{Authorization:'Bearer int_'+'a'.repeat(64),Origin:'https://foreign.example'},404],[{Cookie:'h2h_session=untrusted',Origin:'https://foreign.example'},401]]){
   // Any database access would fail the request: the answer comes from the credential's shape alone.
   const response=await h.raw(undefined,{actor:null,headers:{...headers,'x-test-fault':'no-database'}});
   assert.equal(response.status,status);assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
 }finally{await h.close();}
}

// Profile obeys native widget CORS and actual contact erasure permanently removes read authority.
async function corsAndErasure(){
 const h=await profileApp();
 try{
  await h.contact('visitor');
  await h.db.prepare("UPDATE projects SET allowed_origin='https://widget.example' WHERE id='p'").run();
  const allowed=await h.raw(undefined,{headers:{Origin:'https://widget.example'}});assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://widget.example');assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'),null);
  const foreign=await h.raw(undefined,{headers:{Origin:'https://foreign.example'}});assert.equal(foreign.status,403);assert.doesNotMatch(await foreign.text(),/Saved visitor|visitor@example/);
  await h.db.prepare("INSERT INTO users VALUES('owner','owner@example.test','Owner',1)").run();await h.db.prepare("INSERT INTO memberships VALUES('p','owner','owner')").run();await h.session('owner','p','owner',{role:'owner'});
  const erased=await h.raw('/api/management/projects/p/contacts/visitor/erase',{actor:'owner',method:'POST'});assert.equal(erased.status,200);
  assert.equal((await h.raw()).status,401);
  const row=await h.db.prepare("SELECT name,email,metadata_json FROM contacts WHERE id='visitor'").first();assert.equal(row.name,null);assert.equal(row.email,null);assert.equal(JSON.parse(row.metadata_json).is_erased,1);
  await h.session('visitor','p','visitor');assert.equal((await h.raw()).status,401,'even a newly injected session cannot disclose erased identity');assert.equal(h.external,0);
 }finally{await h.close();}
}

// Profile extraction rechecks current authority after admission, including erasure and epoch-changing races.
async function readRaces(){
 const h=await profileApp();
 try{
  await h.contact('visitor');await h.contact('foreign','q');
  const races=[
   {sql:'UPDATE sessions SET revoked_at=1 WHERE token_hash=?',params:[hash(h.token('visitor'))]},
   {sql:'UPDATE sessions SET expires_at=1 WHERE token_hash=?',params:[]},
   {sql:"UPDATE sessions SET project_id='q' WHERE token_hash=?",params:[]},
   {sql:"UPDATE sessions SET actor_id='foreign',contact_id='foreign' WHERE token_hash=?",params:[]},
   {sql:"UPDATE contacts SET metadata_json='{\"is_erasing\":1}' WHERE id='visitor'",expectedContactMetadata:{is_erasing:1}},
   {sql:"UPDATE contacts SET metadata_json='{\"is_erased\":1}' WHERE id='visitor'",expectedContactMetadata:{is_erased:1}},
   {sql:"UPDATE contacts SET metadata_json='{\"is_blocked\":1}' WHERE id='visitor'",expectedContactMetadata:{is_blocked:1}},
   {sql:"UPDATE contacts SET metadata_json='{\"is_deleted\":1}' WHERE id='visitor'",expectedContactMetadata:{is_deleted:1}},
   {sql:"INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"deleted_at\":1}',1) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json"},
  ];
  for(const race of races){
   await h.db.prepare("UPDATE contacts SET metadata_json='{}' WHERE id='visitor'").run();await h.db.prepare("DELETE FROM project_settings WHERE project_id='p'").run();await h.session('visitor','p','visitor');
   const epoch=await h.db.prepare('SELECT revision FROM integration_authority_epoch WHERE id=1').first();
   const command={...race,...(race.sql.includes('token_hash=?')?{params:[hash(h.token('visitor'))]}:{})};
   const response=await h.raw(undefined,{headers:{'x-test-before-statement':literal(command.sql,...(command.params||[])),'x-test-statement':'JOIN contacts profile_contact'}});
   assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/Saved visitor|visitor@example|foreign@example/);
   const currentEpoch=await h.db.prepare('SELECT revision FROM integration_authority_epoch WHERE id=1').first();
   if(race.expectedContactMetadata){
    assert.deepEqual(JSON.parse((await h.db.prepare("SELECT metadata_json FROM contacts WHERE id='visitor'").first()).metadata_json),race.expectedContactMetadata,'the declared contact privacy mutation committed before extraction');
    assert.equal(currentEpoch.revision,epoch.revision,'contact privacy is fenced directly, not by the integration issuance epoch');
   }else assert.ok(currentEpoch.revision>epoch.revision,'native session/workspace authority mutation occurred before extraction');
  }
  assert.equal(h.external,0);
 }finally{await h.close();}
}

// Actual HMAC identity keeps canonical fields while signed and unsigned collectors retain distinct provided data.
async function signedIdentity(){
 const h=await profileApp();
 try{
  const admittedAfter=Date.now(),signed=await visitor(h,'signed',{signed:true,...trusted,metadata:signedMetadata}),environment=await observedContext(h,signed.contactId,admittedAfter);assert.equal(signed.verified,true);
  assert.deepEqual(canonical(await row(h,signed.contactId)),{...trusted,verified:true});
  const invalid=await h.raw('/api/identity/widget/session',{actor:null,method:'POST',headers:{Origin:'https://app.example'},body:{widgetKey:'widget-p',identifier:trusted.identifier,contact_hash:'0'.repeat(64)}});
  assert.equal(invalid.status,403);
  for(const data of [
   {name:'Visitor alias',email:'visitor-alias@example.test'},
   {name:'Ignored alias',email:'ignored@example.test',provided_name:'Provided name',provided_email:'provided@example.test',external_id:'forged',is_verified:0,metadata:{plan:'forged'}},
  ]){
   const response=await collect(h,'signed',signed.conversationId,data);assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{updated:true,contact:profile(signed.contactId,{...trusted,verified:true})});
   const current=await row(h,signed.contactId);assert.deepEqual(canonical(current),{...trusted,verified:true});
   assert.deepEqual(JSON.parse(current.metadata_json),{...signedMetadata,...environment,provided_name:data.provided_name??data.name,provided_email:data.provided_email??data.email,provided_email_source:'widget',email_unproven:1});
   const saved=await h.raw(undefined,{actor:'signed'});assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{contact:profile(signed.contactId,{...trusted,verified:true})});
  }
  const refreshedMetadata={plan:'platinum',fresh_private_note:'New signed metadata',provided_email_source:'operator'};
  const resumedAfter=Date.now(),resumed=await h.widgetSession('resumed',{signed:true,...trusted,metadata:refreshedMetadata});assert.equal(resumed.contactId,signed.contactId);assert.equal(resumed.verified,true);
  assert.deepEqual(JSON.parse((await row(h,signed.contactId)).metadata_json),{...refreshedMetadata,...await observedContext(h,resumed.contactId,resumedAfter),provided_name:'Provided name',provided_email:'provided@example.test',provided_email_source:'widget',email_unproven:1});
  assert.deepEqual(await (await h.raw(undefined,{actor:'resumed'})).json(),{contact:profile(signed.contactId,{...trusted,verified:true})});
  const guestAfter=Date.now(),unsigned=await visitor(h,'unsigned',{name:'Guest',email:'guest@example.test'}),guestEnvironment=await observedContext(h,unsigned.contactId,guestAfter);assert.equal(unsigned.verified,false);
  for(const data of [{name:'New guest',email:'new-guest@example.test'},{provided_name:'Collected guest',provided_email:'collected@example.test',is_verified:1,verified:true,external_id:trusted.identifier}]){
   const expected={name:data.provided_name??data.name,email:data.provided_email??data.email,identifier:null,verified:false};
   const response=await collect(h,'unsigned',unsigned.conversationId,data);assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{updated:true,contact:profile(unsigned.contactId,expected)});
   const current=await row(h,unsigned.contactId);assert.deepEqual(canonical(current),expected);
   assert.deepEqual(JSON.parse(current.metadata_json),{...guestEnvironment,provided_name:expected.name,provided_email:expected.email,provided_email_source:'widget',email_unproven:1});
   assert.deepEqual(await (await h.raw(undefined,{actor:'unsigned'})).json(),{contact:profile(unsigned.contactId,expected)});
  }
  await owner(h);
  const edited={name:'Operator correction',email:'operator-corrected@example.test',identifier:'operator-corrected-id',verified:true};
  const update=await h.raw('/api/management/projects/p/contacts/'+signed.contactId,{actor:'owner',method:'PUT',body:{name:edited.name,email:edited.email,external_id:edited.identifier,provided_email:'operator-note@example.test'}});
  assert.equal(update.status,200);assert.deepEqual(canonical(await row(h,signed.contactId)),edited);
  assert.equal(JSON.parse((await row(h,signed.contactId)).metadata_json).provided_email_source,'operator');
  const afterOwner=await collect(h,'signed',signed.conversationId,{provided_email:'new-visitor-note@example.test'});assert.equal(afterOwner.status,200);
  assert.deepEqual((await afterOwner.json()).contact,profile(signed.contactId,edited));
  assert.deepEqual(await (await h.raw(undefined,{actor:'signed'})).json(),{contact:profile(signed.contactId,edited)});
  assert.equal(JSON.parse((await row(h,signed.contactId)).metadata_json).provided_email,'new-visitor-note@example.test');assert.equal(h.external,0);
  assert.equal(JSON.parse((await row(h,signed.contactId)).metadata_json).provided_email_source,'widget');
 }finally{await h.close();}
}

// Email-identified HMAC session preserves its signed email through collector updates and profile hydration.
async function signedEmail(){
 const expected={name:'Email account name',email:'verified-email@example.test',identifier:'verified-email@example.test',verified:true};
 const h=await profileApp();
 try{
  // No identifier is supplied: the actual native fallback signs this email and
  // stores it as external_id. The name remains canonical data, not an HMAC claim.
  const admittedAfter=Date.now(),signed=await visitor(h,'email-signed',{signed:true,name:expected.name,email:expected.email}),environment=await observedContext(h,signed.contactId,admittedAfter);
  assert.equal(signed.verified,true);assert.deepEqual(canonical(await row(h,signed.contactId)),expected);
  for(const data of [
   {name:'Untrusted replacement',email:'replacement@example.test'},
   {provided_name:'Self-provided name',provided_email:'self-provided@example.test',external_id:'forged-email-id',is_verified:0},
  ]){
   const response=await collect(h,'email-signed',signed.conversationId,data);assert.equal(response.status,200);
   assert.deepEqual((await response.json()).contact,profile(signed.contactId,expected));
   const current=await row(h,signed.contactId);assert.deepEqual(canonical(current),expected);
   assert.deepEqual(JSON.parse(current.metadata_json),{...environment,provided_name:data.provided_name??data.name,provided_email:data.provided_email??data.email,provided_email_source:'widget',email_unproven:1});
   const hydrated=await h.raw(undefined,{actor:'email-signed'});assert.equal(hydrated.status,200);
   assert.deepEqual(await hydrated.json(),{contact:profile(signed.contactId,expected)});
  }
  assert.equal(h.external,0);
 }finally{await h.close();}
}

// Signed collector rejects foreign ownership and revocation; actual erasure fences canonical and provided identities.
async function collectorFences(){
 const h=await profileApp();
 try{
  const signed=await visitor(h,'signed',{signed:true,...trusted});
  const other=await visitor(h,'other',{name:'Other'}),foreign=await visitor(h,'foreign',{project:'q',name:'Foreign'});
  const before=(await h.db.prepare('SELECT * FROM contacts ORDER BY id').all()).results;
  for(const conversationId of [other.conversationId,foreign.conversationId,'missing']){
   const response=await collect(h,'signed',conversationId,{provided_email:'forged@example.test'});assert.equal(response.status,404);
  }
  assert.deepEqual((await h.db.prepare('SELECT * FROM contacts ORDER BY id').all()).results,before);
  const provided='erase-provided@example.test';assert.equal((await collect(h,'signed',signed.conversationId,{provided_name:'Erase alias',provided_email:provided})).status,200);
  const refreshed=await h.widgetSession('signed',{signed:true,...trusted,metadata:{plan:'refreshed before erasure'}});assert.equal(refreshed.contactId,signed.contactId);
  assert.equal(JSON.parse((await row(h,signed.contactId)).metadata_json).provided_email,provided);
  await h.db.prepare('UPDATE sessions SET revoked_at=1 WHERE token_hash=?').bind(hash(h.token('signed'))).run();
  assert.equal((await collect(h,'signed',signed.conversationId,{email:'revoked@example.test'})).status,401);
  assert.equal((await h.raw(undefined,{actor:'signed'})).status,401);
  assert.deepEqual(canonical(await row(h,signed.contactId)),{...trusted,verified:true});
  assert.equal(JSON.parse((await row(h,signed.contactId)).metadata_json).provided_email,provided);
  await h.session('signed','p',signed.contactId);await owner(h);
  assert.equal((await h.raw('/api/management/projects/p/contacts/'+signed.contactId+'/erase',{actor:'owner',method:'POST'})).status,200);
  const erased=await row(h,signed.contactId);assert.deepEqual(canonical(erased),{name:null,email:null,identifier:null,verified:false});
  const metadata=JSON.parse(erased.metadata_json);assert.equal(metadata.is_erased,1);assert.equal(metadata.provided_name,undefined);assert.equal(metadata.provided_email,undefined);
  for(const [kind,value] of [['email',trusted.email],['email',provided],['external',trusted.identifier]]){
   const digest=hash(JSON.stringify(['move-in-erasure','p',kind,value]));
   assert.ok(await h.db.prepare('SELECT 1 FROM move_in_erased_identities WHERE project_id=? AND digest=?').bind('p',digest).first(),'actual erasure retains the canonical and provided identity fences');
  }
  for(const renewed of [false,true]){
   if(renewed)await h.session('signed','p',signed.contactId);
   assert.equal((await collect(h,'signed',signed.conversationId,{email:'revived@example.test'})).status,401);
   assert.equal((await h.raw(undefined,{actor:'signed'})).status,401);
  }
  assert.deepEqual(await row(h,signed.contactId),erased);assert.equal(h.external,0);
 }finally{await h.close();}
}

// Collector commit rechecks live session, privacy, workspace and conversation authority after admission.
async function collectorRaces(){
 const h=await profileApp();
 try{
  const signed=await visitor(h,'signed',{signed:true,...trusted}),foreign=await visitor(h,'foreign',{project:'q',name:'Foreign'});
  const races=[
   {sql:'UPDATE sessions SET revoked_at=1 WHERE token_hash=?',token:true},
   {sql:'UPDATE sessions SET expires_at=1 WHERE token_hash=?',token:true},
   {sql:"UPDATE sessions SET project_id='q' WHERE token_hash=?",token:true},
   {sql:'UPDATE sessions SET actor_id=?,contact_id=? WHERE token_hash=?',params:[foreign.contactId,foreign.contactId],token:true},
   ...['is_erasing','is_erased','is_blocked','is_deleted'].map(flag=>({sql:"UPDATE contacts SET metadata_json=json_set(metadata_json,?,1) WHERE id=?",params:['$.'+flag,signed.contactId]})),
   {sql:"INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"deleted_at\":1}',1)"},
   {sql:'UPDATE conversations SET contact_id=? WHERE id=?',params:[foreign.contactId,signed.conversationId]},
  ];
  for(const race of races){
   await h.db.prepare("UPDATE contacts SET metadata_json='{}' WHERE id=?").bind(signed.contactId).run();await h.db.prepare("DELETE FROM project_settings WHERE project_id='p'").run();
   await h.db.prepare('UPDATE conversations SET contact_id=? WHERE id=?').bind(signed.contactId,signed.conversationId).run();await h.session('signed','p',signed.contactId);
   const command={sql:race.sql,params:[...(race.params||[]),...(race.token?[hash(h.token('signed'))]:[])]};
   const response=await h.raw('/api/conversations/'+signed.conversationId+'/widget-events',{actor:'signed',body:{action:'contact',data:{name:'Stale write',email:'stale@example.test'}},headers:racing(command)});
   assert.equal(response.status,409);assert.doesNotMatch(await response.text(),/trusted-account|Stale write|stale@example/);
   const current=await row(h,signed.contactId);assert.deepEqual(canonical(current),{...trusted,verified:true});assert.equal(JSON.parse(current.metadata_json).provided_email,undefined);
  }
  assert.equal(h.external,0);
 }finally{await h.close();}
}

// Verification established between collector admission and commit protects the new canonical identity.
async function verifiedMidway(){
 const h=await profileApp();
 try{
  const admittedAfter=Date.now(),guest=await visitor(h,'guest',{name:'Before verification',email:'before@example.test'}),environment=await observedContext(h,guest.contactId,admittedAfter);
  const response=await h.raw('/api/conversations/'+guest.conversationId+'/widget-events',{actor:'guest',body:{action:'contact',data:{provided_name:'Untrusted alias',provided_email:'untrusted@example.test'}},headers:racing({sql:'UPDATE contacts SET name=?,email=?,external_id=?,is_verified=1 WHERE id=?',params:[trusted.name,trusted.email,trusted.identifier,guest.contactId]})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).contact,profile(guest.contactId,{...trusted,verified:true}));
  const current=await row(h,guest.contactId);assert.deepEqual(canonical(current),{...trusted,verified:true});assert.deepEqual(JSON.parse(current.metadata_json),{...environment,provided_name:'Untrusted alias',provided_email:'untrusted@example.test',provided_email_source:'widget',email_unproven:1});
  assert.deepEqual(await (await h.raw(undefined,{actor:'guest'})).json(),{contact:profile(guest.contactId,{...trusted,verified:true})});assert.equal(h.external,0);
 }finally{await h.close();}
}
