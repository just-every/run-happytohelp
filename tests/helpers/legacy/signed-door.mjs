import {legacyUnitJourney,unitFixture,verifyLegacyUnitStorage} from './unit-journey.mjs'
import {legacyPrivacyProof} from './door-privacy.mjs'
import {businessLegacySender} from './business-sender.mjs'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {webcrypto,randomUUID,KeyObject,sign} from 'node:crypto'
import {nativeHarness} from '../../move-in/harness.mjs'
import {doorFixture,packageFixture,sha} from './door-fixture.mjs'
const origin='https://app.example',issuer='https://business.example.test',installation='legacy-test-installation',email='legacy-owner@example.test',password='synthetic-legacy-owner-password'
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export async function legacyDoorJourney(){
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey),bindings={APP_ORIGIN:origin,OWNER_EMAIL:email,H2H_SETUP_TOKEN:'synthetic-setup',RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installation,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify({current:jwk,revoked:jwk}),RER_IMPORT_DOOR:'on',RER_INSTALLATION_ID:installation,RER_MANAGEMENT_ORIGIN:issuer}
 const signingKey=KeyObject.from(keys.privateKey)
 function mint(action,changes={},kid='current'){const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'ES256',typ:'rer-import-grant+jwt',kid})).toString('base64url'),body=Buffer.from(JSON.stringify({v:1,iss:issuer,aud:origin,installationId:installation,email,jti:randomUUID(),iat:now,exp:now+300,action,namespace:'happytohelp-legacy',maxBytes:2*1024*1024,maxChunks:32,maxRecords:100000,...changes})).toString('base64url'),signed=header+'.'+body;return signed+'.'+sign('sha256',Buffer.from(signed),{key:signingKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}
 const grant=async(action,changes={})=>mint(action,changes)
 const h=await nativeHarness({fresh:true,bindings,network:async request=>{assert.equal(new URL(request.url).hostname,'api.sendgrid.com');return new Response(null,{status:202})}})
 try{
  assert.equal((await h.raw('/api/rer/import/uploads',{...json({}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+mint('uploads')}})).response.status,404)
  const owner=await h.call('/api/identity/bootstrap',json({email,password,allowedOrigin:'https://legacy-test.example.test',setupToken:bindings.H2H_SETUP_TOKEN}));h.rememberSession('owner',owner.token);const project=owner.projectId
  const call=async(action,body,extra={})=>h.raw('/api/rer/import/'+action,{...json(body),headers:{'Content-Type':'application/json',Authorization:'Bearer '+await grant(action,extra)}})
  const ok=async(action,body,extra={})=>{const r=await call(action,body,extra);assert.ok(r.response.ok,JSON.stringify({action,status:r.response.status,data:r.data,limits:r.response.headers.get('X-Test-Limits')}));return r.data}
  async function upload(bytes,name,extra={}){const totalChunks=Math.ceil(bytes.length/65536),bundleSha256=sha(bytes),uploadId=randomUUID();for(let index=0;index<totalChunks;index++){const chunk=bytes.subarray(index*65536,(index+1)*65536);await ok('uploads',{uploadId,name,bundleSha256,totalBytes:bytes.length,totalChunks,index,chunkSha256:sha(chunk),base64:chunk.toString('base64')},extra)}return uploadId}
  async function transfer(fixture,extra={},probe=true){const before=(await h.db.prepare('SELECT COUNT(*) n FROM ik_door_plans').first()).n,prepared=packageFixture(fixture),uploadId=await upload(prepared.manifestBytes,'rer-package.json',extra);if(probe){const missing=await call('plan',{uploadId},extra);assert.equal(missing.response.status,409);assert.equal(missing.data.error,'package_segment_missing');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_door_plans').first()).n,before)}for(const bytes of prepared.segments)await upload(bytes,'rer-segment',extra);return {uploadId,prepared}}
  for(const change of [{iat:1,exp:2},{installationId:'foreign-installation'},{email:'foreign@example.test'},{namespace:'other-source'},{aud:'https://foreign.example.test'},{action:'plan'}]){const refusal=await call('uploads',{},change);assert.equal(refusal.response.status,403);assert.equal(h.lastWrites,0)}
  const forged=mint('uploads').split('.');forged[2]=(forged[2][0]==='A'?'B':'A')+forged[2].slice(1);assert.equal((await h.raw('/api/rer/import/uploads',{...json({}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+forged.join('.')}})).response.status,403);assert.equal(h.lastWrites,0)
  await h.call(`/api/move-in/projects/${project}/business-imports`,json({enabled:true,revokedKids:['revoked']}));assert.equal((await h.raw('/api/rer/import/uploads',{...json({}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+mint('uploads',{},'revoked')}})).response.status,403)
  const unsupported=packageFixture(doorFixture(email,{large:false}));unsupported.manifest.source.format='undeclared-format';const unsupportedId=await upload(Buffer.from(JSON.stringify(unsupported.manifest)),'rer-package.json');assert.equal((await call('plan',{uploadId:unsupportedId})).data.error,'seed_package_unsupported')
  const credential=packageFixture(doorFixture(email,{large:false,mutate:tables=>{tables.users[0].password='synthetic-refused-credential'}}));for(const bytes of credential.segments){await upload(bytes,'rer-segment');await upload(bytes,'rer-segment')}await assert.rejects(()=>upload(credential.manifestBytes,'rer-package.json'),/source_credential/);for(const segment of credential.manifest.segments)assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_door_uploads WHERE bundle_sha256=?').bind(segment.sha256).first()).n,0)
  const baseline=await h.snapshot(),fixture=unitFixture(email),outbound=h.outbound,queued=h.queued.length
  assert.ok(fixture.manifest.chunks.some(part=>part.bytes===4*1024*1024));assert.ok(fixture.bytes.length>2*1024*1024)
  const small=doorFixture(email,{large:false}),limited=await transfer(small),quota=await call('plan',{uploadId:limited.uploadId},{maxRecords:small.sourceCount});assert.equal(quota.response.status,413);assert.equal(quota.data.error,'legacy_native_expansion_exceeds_grant');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_door_plans').first()).n,0)
  const boundedPlan=await ok('plan',{uploadId:limited.uploadId}),boundedApproval={fingerprint:boundedPlan.fingerprint,approvalRecordId:'synthetic-lower-grant',approvedAt:'2026-11-05T00:00:00.000Z',maxRecords:small.sourceCount};assert.equal((await call('plan',{uploadId:limited.uploadId},{maxRecords:small.sourceCount})).data.error,'legacy_native_expansion_exceeds_grant');assert.equal((await call('apply',{planId:boundedPlan.planId,reviewedFingerprint:boundedPlan.fingerprint},boundedApproval)).data.error,'legacy_native_expansion_exceeds_grant');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0);await ok('cancel',{planId:boundedPlan.planId})
  const plan=await businessLegacySender(h,fixture,(action,namespace,changes)=>mint(action,{...changes,namespace})),uploaded={uploadId:plan.uploadId}
  const compiledUnits=await legacyUnitJourney({h,project,ownerId:owner.userId,email,installation,uploadId:uploaded.uploadId,fixture,transfer})
  assert.equal(plan.summary.sourceRecords,fixture.sourceCount);assert.equal(plan.counts.rejected,0);assert.ok(plan.counts.effects>fixture.manifest.objects.length);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM legacy_door_blob_chunks').first()).n,0)
  assert.equal((await ok('plan',{uploadId:uploaded.uploadId})).planId,plan.planId)
  const approval=plan=>({fingerprint:plan.fingerprint,approvalRecordId:'synthetic-policy-approval',approvedAt:'2026-11-05T00:00:00.000Z'})
  async function apply(plan){for(let i=0;i<100;i++){const result=await ok('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},approval(plan));if(result.job.state==='completed')return result;assert.ok(i<99)}}
  const replayGrant=mint('status'),replayRequest={...json({planId:plan.planId}),headers:{'Content-Type':'application/json',Authorization:'Bearer '+replayGrant}};assert.equal((await h.raw('/api/rer/import/status',replayRequest)).response.status,200);assert.equal((await h.raw('/api/rer/import/status',replayRequest)).response.status,403)
  assert.equal((await call('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},approval(plan))).response.status,403);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0)
  await apply(plan)
  await verifyLegacyUnitStorage(h,compiledUnits,project)
  assert.equal((await ok('reconcile',{planId:plan.planId})).ok,true)
  const messages=await h.call('/api/conversations/legacy-conversation/messages');assert.deepEqual(messages.messages.map(row=>row.content),['A retained historical message','An original answer'])
  assert.deepEqual((await h.db.prepare('SELECT role FROM memberships WHERE project_id=? ORDER BY role').bind(project).all()).results.map(row=>row.role),['admin','operator','owner'])
  assert.deepEqual(await h.call(`/api/knowledge/public/${project}/articles`),[])
  assert.equal((await h.call(`/api/dashboard/projects/${project}/macros`)).data.find(row=>row.id==='legacy-macro').content,'Prior saved guidance')
  const media=await h.download('/api/conversations/legacy-conversation/media/legacy-media');assert.equal(media.status,200);assert.deepEqual(media.bytes,fixture.bytes)
  assert.equal((await h.db.prepare("SELECT amount_minor FROM billing_ledger WHERE id='legacy-charge'").first()).amount_minor,-1234567)
  assert.equal((await h.db.prepare("SELECT status FROM local_jobs WHERE id='legacy-work'").first()).status,'revoked');assert.equal(h.outbound,outbound);assert.equal(h.queued.length,queued)
  const native=state=>Object.fromEntries(Object.entries(state).filter(([table])=>!table.startsWith('ik_')&&!table.startsWith('h2h_import_')&&!table.startsWith('sqlite_')&&!table.startsWith('_cf_')&&!['audit_events','sessions','session_factors'].includes(table)));const after=native(await h.snapshot());await apply(plan);assert.deepEqual(native(await h.snapshot()),after)
  const cumulative=await transfer(doorFixture(email,{update:true,mutate:tables=>{tables.contacts=tables.contacts.filter(row=>row.id!=='legacy-peer')}})),bounded=await call('plan',{uploadId:cumulative.uploadId,catchup:true},{catchup:'bounded',approvalRecordId:'standing',approvedAt:'2026-11-05T00:00:00.000Z'});assert.equal(bounded.response.status,409)
  const next=await ok('plan',{uploadId:cumulative.uploadId,catchup:true});assert.equal(next.counts.rejected,0);assert.ok(next.differences.gone.length>0);await apply(next);assert.equal((await h.db.prepare("SELECT name FROM contacts WHERE id='legacy-peer'").first()).name,'Preserved peer');assert.equal((await h.call('/api/conversations/legacy-conversation/messages')).messages.length,3)
  async function undo(p){for(let i=0;i<100;i++){const result=await ok('undo',{planId:p.planId});if(result.job.state==='undone')return;assert.ok(i<99)}}
  await undo(next);assert.deepEqual((await h.call('/api/conversations/legacy-conversation/messages')).messages.map(row=>row.content),messages.messages.map(row=>row.content));assert.deepEqual((await h.download('/api/conversations/legacy-conversation/media/legacy-media')).bytes,fixture.bytes)
  for(let i=0;i<100;i++){const result=await ok('undo',{planId:plan.planId});if(result.job.state==='undone')break;assert.ok(i<99)}
  const undone=await h.snapshot();for(const table of ['contacts','conversations','messages','media','memberships','users','context_subjects','billing_ledger','billing_operations','local_grants','local_devices','local_jobs','reporting_legacy_conversations','legacy_door_blob_chunks'])assert.deepEqual(undone[table],baseline[table],table)
  assert.equal((await h.download('/api/conversations/legacy-conversation/media/legacy-media')).status,404)
  await legacyPrivacyProof({h,project,email,plan:{...plan,uploadId:uploaded.uploadId},fixture,call,ok,upload,transfer,apply})
  const beforeHuge=(await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,huge=unitFixture(email,{large:false});huge.manifest.source.rowCounts.conversations=157478;huge.manifest.source.cloneCounts.conversations=157478;huge.files.set('manifest.json',Buffer.from(JSON.stringify(huge.manifest)));await assert.rejects(()=>transfer(huge,{},false),/plan_exceeds_grant_quota/);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,beforeHuge)
  await h.call(`/api/move-in/projects/${project}/business-imports`,json({enabled:false}));assert.equal((await call('uploads',{})).response.status,404)
  console.log('Legacy signed door: complete source/native accounting, multi-segment media, inert history, replay and exact Undo')
 }finally{await h.close()}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await legacyDoorJourney()
