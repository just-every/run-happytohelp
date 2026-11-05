import assert from 'node:assert/strict'
import {webcrypto,randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {nativeHarness} from './harness.mjs'
import {generateDoorZendesk} from './generator.mjs'
const origin='https://app.example',issuer='https://business.example.test',installation='synthetic-hh-installation',email='synthetic-hh-owner@example.test',password='synthetic-hh-password-12345'
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const actions=['uploads','plan','apply','status','reconcile','undo','cancel','archive','restore-check']
/** Public-door proof carried by the existing Zendesk offline journey. The signer
 * is test-only; product code never gains signing keys or mock grant behavior. */
export async function zendeskDoorJourney(){
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey),ring={current:jwk,revoked:jwk}
 const bindings={APP_ORIGIN:origin,OWNER_EMAIL:email,H2H_SETUP_TOKEN:'synthetic-hh-setup-token',RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installation,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(ring),RER_IMPORT_DOOR:'on',RER_INSTALLATION_ID:installation,RER_MANAGEMENT_ORIGIN:issuer,INBOUND_EMAIL_TOKEN:'synthetic-hh-gateway'}
 async function grant(action,changes={},kid='current',signer=keys.privateKey){
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'ES256',typ:'rer-import-grant+jwt',kid})).toString('base64url'),body=Buffer.from(JSON.stringify({v:1,iss:issuer,aud:origin,installationId:installation,email,jti:randomUUID(),iat:now,exp:now+300,action,namespace:'zendesk',maxBytes:2*1024*1024,maxChunks:32,maxRecords:5000,...changes})).toString('base64url'),signed=header+'.'+body
  return signed+'.'+Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signer,Buffer.from(signed))).toString('base64url')
 }
 const network=async request=>{assert.equal(new URL(request.url).hostname,'api.sendgrid.com');return new Response(null,{status:202})}
 const fixture=generateDoorZendesk();assert.ok(fixture.byKind.ticket>300);assert.ok(fixture.archived.length>=30);assert.ok(Buffer.byteLength(fixture.body)<2*1024*1024);for(const record of fixture.records)if(record.ticket)for(const comment of record.ticket.comments)assert.ok(!comment.body.includes(String(record.ticket.id)),'source-id search cannot pass through matching message prose')
 async function closed(h){for(const action of actions){const r=await h.raw('/api/rer/import/'+action,{...json({}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+await grant(action)}});assert.equal(r.response.status,404);assert.equal(h.lastWrites,0)}}
 // Before claim, and without exactly "on", every grant door stays closed.
 for(const flag of [undefined,'off','ON']){
  const h=await nativeHarness({fresh:true,bindings:{...bindings,RER_IMPORT_DOOR:flag??''},network})
  try{await closed(h);const claim=await h.raw('/auth/bootstrap',json({token:bindings.H2H_SETUP_TOKEN}));assert.equal(claim.response.status,303);await closed(h);assert.equal((await h.raw('/auth/bootstrap',json({}))).response.status,409);await closed(h)}finally{await h.close()}
 }
 for(const mismatch of [{RER_OWNER_CLAIM_PUBLIC_KEYS:'{}'},{RER_OWNER_CLAIM_ISSUER:'invalid'},{RER_INSTALLATION_ID:'synthetic-hh-conflicting'},{RER_MANAGEMENT_ORIGIN:'https://wrong.example.test'},{RER_DEMO:'1'}]){
  const invalid=await nativeHarness({fresh:true,bindings:{...bindings,...mismatch},network})
  try{await closed(invalid);assert.equal((await invalid.raw('/auth/bootstrap',json({token:bindings.H2H_SETUP_TOKEN}))).response.status,303);await closed(invalid)}finally{await invalid.close()}
 }
 const h=await nativeHarness({fresh:true,bindings,network})
 try{
  await closed(h)
  // The password bootstrap shares createNativeOwner with the hosted claim and
  // gives this test a real recent native proof for destructive erasure later.
  const owner=await h.call('/api/identity/bootstrap',json({email,password,allowedOrigin:'https://synthetic-hh.example.test',setupToken:bindings.H2H_SETUP_TOKEN}))
  h.rememberSession('owner',owner.token);const project=owner.projectId,root=`/api/move-in/projects/${project}/imports`,management=`/api/management/projects/${project}`,dashboard=`/api/dashboard/projects/${project}`,setting=`/api/move-in/projects/${project}/business-imports`
  assert.equal((await h.call(setting)).enabled,true)
  assert.equal((await h.raw('/auth/bootstrap',json({}))).response.status,409)
  const second=(await h.call('/api/management/projects',json({name:'synthetic-hh-second',allowedOrigin:'https://synthetic-hh-second.example.test'}))).id
  for(const role of ['admin','operator']){
   const address=`synthetic-hh-${role}@example.test`,invite=(await h.call(management+'/agents',json({email:address,role}))).data,token=new URLSearchParams(new URL(invite.invitationUrl).hash.slice(1)).get('token')||new URL(invite.invitationUrl).searchParams.get('token')
   await h.call('/api/identity/accept-token',json({token,password,name:`synthetic-hh-${role}`}))
   const login=await h.call('/api/identity/login',json({email:address,password,projectId:project}));h.rememberSession(role,login.token)
   for(const request of [{actor:role},{...json({enabled:true}),actor:role}])assert.equal((await h.raw(setting,request)).response.status,403)
  }
  const call=async(action,body,extra={},kid='current')=>h.raw('/api/rer/import/'+action,{...json(body),headers:{'Content-Type':'application/json',Authorization:'Bearer '+await grant(action,extra,kid)}})
  const ok=async(action,body,extra={})=>{const result=await call(action,body,extra);assert.ok(result.response.ok,JSON.stringify(result.data));assert.equal(result.response.headers.get('X-Test-Widget-Effects'),'0');return result.data}
  const snapshot=async()=>({contacts:(await h.call(management+'/contacts?limit=200')).data,companies:(await h.call(management+'/companies')).companies,articles:await h.call(`/api/knowledge/${project}/articles`),tickets:await h.call(dashboard+'/conversations?view=all')})
  const initial=await snapshot(),outbound=h.outbound,queued=h.queued.length
  // Forgery, expiry, replay, action/owner/installation bindings and revocations.
  const foreign=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  for(const [changes,action,signer] of [[{},'uploads',foreign.privateKey],[{iat:1,exp:2},'uploads'],[{installationId:'synthetic-hh-other'},'uploads'],[{email:'synthetic-hh-other@example.test'},'uploads'],[{},'plan']]){
   const token=await grant(action,changes,'current',signer),r=await h.raw('/api/rer/import/uploads',{...json({}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}});assert.equal(r.response.status,403);assert.equal(h.lastWrites,0)
  }
  const unknown=await call('uploads',{}, {namespace:'intercom'});assert.equal(unknown.response.status,403);assert.equal(unknown.data.error,'unknown_import_source');assert.equal(h.lastWrites,0)
  await h.call(setting,json({enabled:true,revokedKids:['revoked']}))
  assert.equal((await call('uploads',{}, {},'revoked')).response.status,403)
  async function upload(body=fixture.body){
   const bytes=Buffer.from(body),bundleSha256=sha(bytes),totalChunks=Math.ceil(bytes.length/65536);let uploadId
   for(let index=0;index<totalChunks;index++){const chunk=bytes.subarray(index*65536,(index+1)*65536),result=await ok('uploads',{...(uploadId?{uploadId}:{}),name:'synthetic-hh-door.ndjson',bundleSha256,totalBytes:bytes.length,totalChunks,index,chunkSha256:sha(chunk),base64:chunk.toString('base64')});uploadId=result.uploadId}
   const inventory=await ok('uploads',{uploadId});assert.equal(inventory.complete,true)
   return {uploadId,bundleSha256}
  }
  const uploaded=await upload();let preview=await ok('plan',{uploadId:uploaded.uploadId})
  assert.match(preview.fingerprint,/^[a-f0-9]{64}$/);assert.equal(preview.bundleSha256,uploaded.bundleSha256);assert.deepEqual(preview.counts.byKind,fixture.byKind);assert.equal(preview.counts.rejected,0)
  for(const field of ['input','unique','duplicates','mapped','unmapped','rejected','effects'])assert.ok(Number.isInteger(preview.counts[field]))
  assert.equal(preview.counts.input,preview.counts.unique+preview.counts.duplicates);assert.ok(preview.counts.effects>0)
  const held=preview.unmapped.filter(row=>row.kind==='article');assert.deepEqual(held.map(row=>row.sourceId).sort(),['60003','60004']);for(const row of held){assert.match(row.reason,/restricted_article_held_back/);assert.deepEqual(Object.keys(row).sort(),['kind','reason','sourceId'])}
  const repeated=await ok('plan',{uploadId:uploaded.uploadId});assert.equal(repeated.planId,preview.planId);assert.equal(repeated.fingerprint,preview.fingerprint)
  assert.deepEqual(await snapshot(),initial);assert.equal(h.outbound,outbound)
  const replay=await grant('status'),request={...json({planId:preview.planId}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+replay}}
  assert.equal((await h.raw('/api/rer/import/status',request)).response.status,200);assert.equal((await h.raw('/api/rer/import/status',request)).response.status,403)
  const approval={fingerprint:preview.fingerprint,approvalRecordId:'synthetic-hh-agent-policy-approval',approvedAt:new Date().toISOString()}
  assert.equal((await call('apply',{planId:preview.planId,reviewedFingerprint:'0'.repeat(64)},approval)).response.status,403);assert.deepEqual(await snapshot(),initial)
  async function apply(plan=preview){let job;for(let count=0;count<100;count++){job=(await ok('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},{...approval,fingerprint:plan.fingerprint})).job;if(job.state==='completed')return job;assert.ok(['queued','applying'].includes(job.state),JSON.stringify(job))}assert.fail('bounded apply never completed')}
  await apply()
  const catchup=await call('plan',{uploadId:uploaded.uploadId,catchup:true});assert.equal(catchup.response.status,409);assert.equal(catchup.data.error,'happytohelp_catchup_requires_proposal')
  const status=await ok('status',{planId:preview.planId});assert.equal(status.job.state,'completed');assert.equal(status.approval.approval_id,approval.approvalRecordId);assert.equal(status.failureCode,null);assert.deepEqual(status.job.counts,preview.counts)
  const reconciled=await ok('reconcile',{planId:preview.planId});assert.equal(reconciled.ok,true);assert.equal(reconciled.fingerprint,preview.fingerprint);assert.deepEqual(reconciled.counts.byKind,preview.counts.byKind);assert.equal(reconciled.counts.present+reconciled.counts.explained,preview.summary.sourceRecords)
  for(const row of reconciled.sourceIds.filter(row=>row.status==='explained')){assert.deepEqual(Object.keys(row).sort(),['kind','reason','sourceId','status']);assert.ok(row.reason)}
  // Exact undo before any live customer session or native edit exists.
  for(let count=0;count<100;count++){const job=(await ok('undo',{planId:preview.planId})).job;if(job.state==='undone')break;assert.ok(count<99)}
  assert.deepEqual(await snapshot(),initial)
  for(const id of [fixture.archived[0],String(10000+fixture.byKind.ticket)])assert.deepEqual((await h.call(dashboard+'/conversations?q='+id)).data,[])
  preview=await ok('plan',{uploadId:uploaded.uploadId});approval.fingerprint=preview.fingerprint;await apply()
  const contacts=(await h.call(management+'/contacts?limit=200')).data,companies=(await h.call(management+'/companies')).companies,articles=await h.call(`/api/knowledge/${project}/articles`)
  assert.equal(contacts.length,12);assert.equal(companies.length,3);assert.equal(articles.length,2)
  let tickets=[];for(let page=1;;page++){const batch=(await h.call(dashboard+`/conversations?view=all&page=${page}`)).data;tickets.push(...batch);if(batch.length<30)break}assert.equal(tickets.length,fixture.byKind.ticket)
  console.log('DOOR_COUNTS '+JSON.stringify({sourceRecords:preview.summary.sourceRecords,plan:preview.counts,reconciled:reconciled.counts,native:{tickets:tickets.length,contacts:contacts.length,companies:companies.length,articles:articles.length}}))
  assert.equal((await h.call(management+'/agents')).data.filter(row=>!row.pending).length,3,'historical staff have no login/membership')
  const search=async(term,pid=project)=>(await h.call(`/api/dashboard/projects/${pid}/conversations?q=${encodeURIComponent(term)}`)).data
  for(const id of [fixture.archived[0],String(10000+fixture.byKind.ticket)])for(const term of [id,'#'+id]){const found=await search(term);assert.equal(found.length,1);const view=(await h.call(dashboard+'/conversations/'+found[0].id)).data;assert.equal(view.imported.vendor,'zendesk');assert.equal(view.imported.source_id??view.imported.sourceId,id);if(fixture.archived.includes(id))assert.equal(view.status_category,'closed');assert.deepEqual(await search(term,second),[]);assert.equal((await h.raw(`/api/dashboard/projects/${second}/conversations/${found[0].id}`)).response.status,404)}
  const thread=(await search('10002'))[0],detail=(await h.call(dashboard+'/conversations/'+thread.id)).data
  const buckets=(await h.call(dashboard+'/conversations/'+thread.id+'/buckets')).data,messages=buckets.flatMap(bucket=>bucket.messages),notes=buckets.flatMap(bucket=>bucket.events).filter(event=>event.type==='INTERNAL_NOTE')
  assert.equal(messages.length,2);assert.equal(notes.length,1);assert.equal(messages[0].source_author.role,'contact');assert.equal(messages[1].source_author.role,'operator');assert.ok(Date.parse(messages[0].created_at)<Date.parse(messages[1].created_at))
  const contact=contacts.find(row=>row.id===detail.contact_id||row.id===detail.requester_id);assert.ok(contact)
  await h.call(management+'/contacts/'+contact.id,{...json({name:'synthetic-hh-native-edit'}),method:'PUT'})
  const nativeConflict=await call('undo',{planId:preview.planId});assert.equal(nativeConflict.response.status,409);assert.equal((await h.call(management+'/contacts/'+contact.id)).data.name,'synthetic-hh-native-edit')
  const media=[...messages.flatMap(message=>message.media??[]),...notes.flatMap(note=>note.media??[])];assert.equal(media.length,2)
  for(const item of media){const got=await h.download(`/api/conversations/${thread.id}/media/${item.id}`);assert.equal(got.status,200);assert.match(got.bytes.toString(),/^synthetic-hh-(501|502) attachment$/)}
  await h.contactSession('visitor',project,contact.id)
  for(const item of messages.flatMap(message=>message.media??[]))assert.equal((await h.download(`/api/conversations/${thread.id}/media/${item.id}`,'visitor')).status,200)
  for(const item of notes.flatMap(note=>note.media??[]))assert.equal((await h.download(`/api/conversations/${thread.id}/media/${item.id}`,'visitor')).status,404)
  const publicThread=JSON.stringify(await h.call(`/api/conversations/${thread.id}/messages`,{actor:'visitor'}));assert.doesNotMatch(publicThread,/private note/);assert.equal((await h.raw(`/api/conversations/${thread.id}/imported-history`,{actor:'visitor'})).response.status,404)
  const published=await h.call(`/api/knowledge/public/${project}/articles`);assert.equal(published.length,1);assert.equal((await h.raw(`/api/knowledge/public/${project}/articles/${published[0].slug}`)).response.status,200)
  for(const query of ['synthetic-hh-60002','synthetic-hh-60003','synthetic-hh-60004']){assert.deepEqual(await h.call(`/api/knowledge/public/${project}/search?q=${query}`),[]);assert.equal((await h.raw(`/api/knowledge/${project}/search?q=${query}`,{actor:'visitor'})).response.status,403)}
  assert.equal((await h.call(dashboard+'/reports?period=7')).volume,0);assert.equal(h.outbound,outbound);assert.equal(h.queued.length,queued)
  // A second Move in authority sees real collisions and creates no duplicate.
  const conflicting=(await h.call(root+'?vendor=zendesk',{actor:'admin',method:'POST',headers:{'X-Import-Filename':'synthetic-hh-conflict.ndjson'},body:generateDoorZendesk(1).body+[{article:{id:60005,title:'synthetic-hh-60005',body:'synthetic-hh malformed audience',draft:false,user_segment_ids:'unknown',created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-01T00:00:00Z'}},{article:{id:60006,title:'synthetic-hh-60006',body:'synthetic-hh malformed draft',draft:'false',user_segment_id:9,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-01T00:00:00Z'}}].map(JSON.stringify).join('\n')})).data
  // Only drain import work; the provisioner's unrelated website-read remains queued.
  while(h.queued.some(job=>job.type==='move-in')){const index=h.queued.findIndex(job=>job.type==='move-in');await h.step(h.queued.splice(index,1))}
  const conflict=(await h.call(root+'/'+conflicting.id,{actor:'admin'})).data;assert.ok(conflict.plan.counts.rejected>0);assert.equal(conflict.plan.decisions.find(row=>row.sourceId==='60005').rejection,'article_audience_unknown');assert.equal(conflict.plan.decisions.find(row=>row.sourceId==='60006').rejection,'article_publication_required')
  // Native inbound mail matches both old notification headers and subject tokens.
  await h.call(management+'/email-settings',{...json({from_name:'synthetic-hh-support',from_address:'support@example.test',inbound_address:'synthetic-hh-inbound@example.test',is_enabled:true}),method:'PUT'})
  for(const [index,evidence] of [[1,{headers:{'In-Reply-To':'<synthetic-hh-old@example.test>'}}],[2,{subject:'Re: [Ticket #10002]'}],[3,{subject:'Re: [A123-B123]'}]]){const received=await h.call('/api/integrations/email/inbound',{...json({messageId:`synthetic-hh-reply-${index}@example.test`,to:'synthetic-hh-inbound@example.test',from:contact.email,text:`synthetic-hh-new-reply-${index}`,...evidence}),headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-hh-gateway'}});assert.equal(received.conversationId,thread.id)}
  assert.equal((await h.call(dashboard+'/conversations?view=all')).meta.pagination.total,fixture.byKind.ticket)
  // A customer session is a live native reference and must block strict undo.
  const refused=await call('undo',{planId:preview.planId});assert.equal(refused.response.status,409)
  await h.call('/api/identity/session',{method:'DELETE',actor:'visitor'})
  // Revoke the contact session through the native erasure journey below; use a
  // separate untouched import for exact undo so no native reference is destroyed.
  assert.equal((await call('undo',{planId:preview.planId})).response.status,409)
  assert.equal((await h.call(management+'/contacts/'+contact.id)).data.name,'synthetic-hh-native-edit')
  await h.call(management+'/contacts/'+contact.id+'/erase',json({}))
  for(const item of media)assert.equal((await h.download(`/api/conversations/${thread.id}/media/${item.id}`)).status,404)
  assert.equal((await h.raw(`/api/conversations/${thread.id}/imported-history`)).response.status,404)
  assert.doesNotMatch(JSON.stringify(await h.call(`/api/conversations/${thread.id}/messages`)),/historical reply|private note/)
  for(const body of [fixture.body,fixture.body.replace('synthetic-hh-10002','synthetic-hh-corrected')]){const replayed=await upload(body),refused=await call('plan',{uploadId:replayed.uploadId});assert.equal(refused.response.status,409);assert.equal(refused.data.error,'source_erased')}
  assert.equal((await call('reconcile',{planId:preview.planId})).response.status,410)
  await h.call(setting,json({enabled:false}));assert.equal((await h.call(setting)).enabled,false);await closed(h)
  await h.call('/api/identity/login',json({email,password,projectId:project}));assert.equal((await h.call(setting)).enabled,false)
  assert.equal((await h.raw('/auth/bootstrap',json({}))).response.status,409);assert.equal((await h.call(setting)).enabled,false)
  await h.call(setting,json({enabled:true}));await upload(generateDoorZendesk(1).body);await h.call(management,{method:'DELETE'});await closed(h)
  console.log('PROBE Zendesk grant door: first claim, privacy, 312 tickets, counts/search, grant fences, erasure and owner close asserted')
 }finally{await h.close()}
 // Dedicated hosted-claim public entry and an untouched exact-undo baseline.
 const clean=await nativeHarness({fresh:true,bindings,network})
 try{
  const claim=await clean.raw('/auth/bootstrap',json({token:bindings.H2H_SETUP_TOKEN}));assert.equal(claim.response.status,303)
  const token=claim.response.headers.get('Set-Cookie').match(/h2h_session=([^;]+)/)[1];clean.rememberSession('owner',token)
  const actor=await clean.call('/api/identity/session');assert.equal((await clean.call(`/api/move-in/projects/${actor.projectId}/business-imports`)).enabled,true)
 }finally{await clean.close()}
 const catalogue=JSON.parse(await readFile('importers.json','utf8'));validateSchema(catalogue,JSON.parse(await readFile('src/modules/import-kit/schema/importers.schema.json','utf8')));const row=catalogue.importers[0];assert.equal(catalogue.importers.length,1);assert.equal(row.incumbent,'Zendesk');assert.equal(row.product,'HappyToHelp');assert.equal(row.status,'documented format');assert.equal(row.evidence.validation,'synthetic-only');assert.equal(row.evidence.realExport,'not-supplied')
 const evidence=await readFile(row.evidence.link.replace(/^evidence:/,''));assert.equal(evidence.length,row.evidence.size);assert.equal(sha(evidence),row.evidence.sha256);assert.equal(sha(await readFile(row.evidence.sourcePath)),row.evidence.sourceSha256)
}

// Only the JSON Schema vocabulary used by the vendored v1 catalogue. The schema
// itself remains the source of closed keys/statuses; no hand-maintained status enum.
function validateSchema(value,schema,root=schema){
 if(schema.$ref)return validateSchema(value,schema.$ref.slice(2).split('/').reduce((part,key)=>part[key],root),root)
 if(schema.oneOf){assert.equal(schema.oneOf.filter(option=>{try{validateSchema(value,option,root);return true}catch{return false}}).length,1);return}
 if(schema.const!==undefined)assert.deepEqual(value,schema.const)
 if(schema.type==='object'){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));for(const key of schema.required??[])assert.ok(Object.hasOwn(value,key));if(schema.additionalProperties===false)assert.ok(Object.keys(value).every(key=>Object.hasOwn(schema.properties??{},key)));for(const [key,item] of Object.entries(schema.properties??{}))if(Object.hasOwn(value,key))validateSchema(value[key],item,root)}
 if(schema.type==='array'){assert.ok(Array.isArray(value));if(schema.minItems!==undefined)assert.ok(value.length>=schema.minItems);for(const item of value)validateSchema(item,schema.items,root)}
 if(schema.type==='string'){assert.equal(typeof value,'string');if(schema.minLength!==undefined)assert.ok(value.length>=schema.minLength);if(schema.pattern)assert.match(value,new RegExp(schema.pattern))}
 if(schema.type==='integer'){assert.ok(Number.isInteger(value));if(schema.minimum!==undefined)assert.ok(value>=schema.minimum)}
}
