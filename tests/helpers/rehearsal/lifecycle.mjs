import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runnerRuntime} from '../../move-in/legacy-adoption-integration/runtime.mjs'
import {fakeZendesk} from '../../move-in/zendesk-pull-fixture.mjs'
import {prepareAcceptedAdoption,createNativeRehearsal} from './legacy-fixture.mjs'
import {prepareAcceptedZendesk} from './zendesk.mjs'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
async function withConsent(work){
 const directory=await mkdtemp(join(tmpdir(),'rehearsal-lifecycle-')),zendesk=fakeZendesk(),bindings={INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}
 const app=await runnerRuntime({bindings,network:zendesk.handler})
 try{
  const f=await prepareAcceptedAdoption(app,directory),base=await prepareAcceptedZendesk(app,{setup:f.setup,token:f.owner.token,zendesk}),initial=await createNativeRehearsal(app,{...f,zendeskProjectId:f.setup,zendeskPullId:base.id})
  const input={originManifestSha256:f.origin.manifestSha256,zendeskProjectId:f.setup,zendeskPullId:base.id,copierId:'synthetic-lifecycle-copier',expiresAt:Date.now()+3600000},root=`/api/move-in/projects/${f.setup}/rehearsals`
  const mint=async()=>{const r=(await app.call(root,{token:f.owner.token,body:input,headers:{Origin:app.origin},status:201})).data.data;return {...r,root:root+'/'+r.grant.id}}
  const closed=async g=>{
   assert.equal((await app.call(g.root+'/copy/zendesk',{token:g.credential})).status,401)
   const status=(await app.call(g.root,{token:f.owner.token,status:200})).data.data
   assert.equal(status.state,'closed');assert.ok(status.generation>g.grant.generation)
   assert.ok(!JSON.stringify(status).includes(g.credential))
   return status
  }
  await work({app,f,base,bindings,initial,input,root,mint,closed})
 }finally{await app.close();await rm(directory,{recursive:true,force:true})}
}
export async function rehearsalLifecycleJourney(){
 await withConsent(async({app,f,initial,bindings,input,root,mint,closed})=>{
  await app.call('/agents/api/pause',{body:{paused:true},headers:{Cookie:'h2h_session='+f.owner.token,Origin:app.origin},status:200})
  await closed(initial)
  await app.call('/agents/api/pause',{body:{paused:false},headers:{Cookie:'h2h_session='+f.owner.token,Origin:app.origin},status:200})
  await closed(initial)
  let g=await mint()
  // Upstream Business policy is fixture input; native closure and refusal run in the actual app.
  await app.db.prepare('INSERT INTO bs_settings(singleton,stopped) VALUES(1,1) ON CONFLICT(singleton) DO UPDATE SET stopped=1').run();await closed(g)
  await app.db.prepare('UPDATE bs_settings SET stopped=0 WHERE singleton=1').run();await closed(g)
  g=await mint()
  await app.db.prepare('UPDATE rehearsal_grants SET expiry_at=0 WHERE id=?').bind(g.grant.id).run()
  assert.equal((await app.call(g.root+'/copy/zendesk',{token:g.credential})).status,403)
  await closed(g)
  g=await mint()
  await app.db.prepare('UPDATE identity_recovery_epochs SET epoch=epoch+1 WHERE user_id=?').bind(f.owner.userId).run();await closed(g)
  g=await mint()
  await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.two_factor_roles',json('[\"owner\"]')) WHERE project_id=?").bind(f.setup).run();await closed(g)
  g=await mint()
  bindings.H2H_SETUP_OWNER_EMAIL='synthetic-other-owner@example.test';await app.crash()
  assert.equal((await app.call(g.root+'/copy/zendesk',{token:g.credential})).status,403)
  bindings.H2H_SETUP_OWNER_EMAIL='synthetic-wire@example.test';await app.crash();await closed(g)
  g=await mint()
  await app.call('/auth/signout',{token:f.owner.token,body:{},headers:{Origin:app.origin},status:204})
  assert.equal((await app.call(g.root+'/copy/zendesk',{token:g.credential})).status,401)
  const login=(await app.call('/api/identity/login',{body:{email:'synthetic-wire@example.test',password:'Synthetic wire password 42!',projectId:f.setup},status:200})).data
  f.owner.token=login.token
  assert.equal((await app.call(root,{token:f.owner.token,body:input,headers:{Origin:app.origin}})).status,401,'an unproven factor cannot mint consent')
  await app.db.prepare('INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET method=excluded.method,verified_at=excluded.verified_at').bind(hash(f.owner.token),f.owner.userId,'webauthn',Date.now()).run()
  await closed(g)
  g=await mint()
  await app.db.prepare("UPDATE memberships SET role='admin' WHERE project_id=? AND user_id=?").bind(f.source,f.owner.userId).run();await closed(g)
  await app.db.prepare("UPDATE memberships SET role='owner' WHERE project_id=? AND user_id=?").bind(f.source,f.owner.userId).run()
  const foreign=await app.seedWorkspace('rehearsal-foreign')
  assert.equal((await app.call(root,{token:foreign.tokens.owner,body:input,headers:{Origin:app.origin}})).status,403)
  await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(f.origin.manifestSha256).run()
  for(let n=0;n<30;n++){await app.scheduled();await app.runJobs(await app.takeJobs());if((await app.first('SELECT status FROM legacy_package_custody WHERE manifest_sha256=?',f.origin.manifestSha256)).status==='purged')break;await app.db.prepare('UPDATE legacy_package_custody SET next_cleanup_at=0 WHERE manifest_sha256=?').bind(f.origin.manifestSha256).run()}
  assert.equal(await (await app.files).head(`legacy-package/${f.origin.manifestSha256}/manifest.json`),null)
  g=await mint() // immutable non-content provenance, never raw-source revival
  await app.call(g.root+'/copy/stop',{token:g.credential,body:{},status:202});await closed(g)
  const audit=await app.sql("SELECT detail_json FROM audit_events WHERE action LIKE 'rehearsal.%'")
  assert.equal(JSON.stringify(audit).includes(g.credential),false);assert.equal(JSON.stringify(audit).includes(f.owner.token),false)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox')).n,0)
 })
}
export async function rehearsalPortabilityJourney(){
 await withConsent(async({app,f,initial,closed})=>{
  const live=await app.first('SELECT * FROM rehearsal_grants WHERE id=?',initial.grant.id)
  const exported=archivePolicy.exportRow('rehearsal_grants',live),restored=archivePolicy.importRow('rehearsal_grants',exported)
  assert.equal(exported.state,'closed');assert.equal(exported.credential_hash,null);assert.equal(exported.issuing_session_hash,'')
  // Actual restore sanitizer also closes a staged archive that still contains live metadata.
  await archivePolicy.validateStaged({db:app.db,tables:{rehearsal_grants:'rehearsal_grants'}})
  await closed(initial)
  assert.equal(restored.credential_hash,null);assert.equal(restored.owner_email,'')
  const status=(await app.call(initial.root+'/cleanup',{token:f.owner.token,body:{},headers:{Origin:app.origin},status:200})).data.data
  assert.equal(status.cleanup.drafts,'not_implemented')
 })
}
