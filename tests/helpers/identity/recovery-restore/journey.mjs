import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {command,run,stopOwnedServer} from '../../rer-command.mjs'
import {recoveryStorage} from './storage.mjs'
import {totp} from '../two-factor.mjs'
const rootPath='/api/identity/owner-recovery'
export async function recoveryRestoreJourney(){
 // Local storage inspection must never fetch edge metadata from a provider.
 const priorCfFetch=process.env.CLOUDFLARE_CF_FETCH_ENABLED
 process.env.CLOUDFLARE_CF_FETCH_ENABLED='false'
 const scratch=await mkdtemp(join(tmpdir(),'h2h-identity-restore-')),checkout=join(scratch,'checkout'),email='recovery-restore@example.test',password='synthetic-recovery-restore-password',key=randomBytes(32).toString('hex')
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const origin=`http://127.0.0.1:${port}`;let server,serverReady=false
 const call=async(path,body,token,capability)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...(capability?{'X-Recovery-Capability':capability}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();return {response,data}}
 const ok=async(...args)=>{const result=await call(...args);assert.ok(result.response.ok,`${args[0]} returned ${result.response.status}`);return result.data}
 const start=async()=>{serverReady=false;server=command(checkout,['dev']);await server.waitFor(event=>event.event==='ready',240000);serverReady=true}
 const stop=async()=>{if(!server)return;try{if(serverReady){await stopOwnedServer(server.child);await server.result()}}finally{await server.stop();server=undefined;serverReady=false}}
 try{
  await promisify(execFile)('git',['clone','--quiet','--no-local','--depth','1',resolve('.'),checkout])
  await run(checkout,['install'])
  await mkdir(join(checkout,'.seed'),{recursive:true})
  await writeFile(join(checkout,'.seed/answers.json'),JSON.stringify({WORKSPACE_NAME:'Recovery restore support',WIDGET_ORIGIN:origin,OWNER_NAME:'Casey Owner',OWNER_PASSWORD:password,EMAIL_PROVIDER:'later'}),{mode:0o600})
  await run(checkout,['setup','--owner-email',email,'--answers','.seed/answers.json','--port',String(port)])
  // Set the documented private local binding as a synthetic test input. Setup
  // owns generation of its hidden key; the test never reads that generated value.
  await appendFile(join(checkout,'.dev.vars'),'\nH2H_OWNER_RECOVERY_KEY='+key+'\n',{mode:0o600})
  await start()
  const login=await ok('/api/identity/login',{email,password}),owner=login.actor
  // Spend a manual key through the real recovery transaction, leaving its fence portable.
  const manual=await ok(rootPath,{email,password,recoveryKey:key})
  const setup=await ok(rootPath+'/enrol/totp',{},undefined,manual.capability)
  const completed=await call(rootPath+'/complete',{factorId:setup.factorId,code:totp(setup.secret)},undefined,manual.capability)
  assert.equal(completed.response.status,200)
  const ownerSession=completed.response.headers.get('set-cookie').match(/h2h_session=([^;]+)/)[1]
  const invited=await ok(`/api/management/projects/${owner.projectId}/agents`,{email:'shared-restore@example.test'},ownerSession)
  await ok('/api/identity/accept-token',{token:new URL(invited.data.invitationUrl).searchParams.get('token'),name:'Taylor Support',password})
  const target=await ok('/api/identity/login',{email:'shared-restore@example.test',password})
  const pending=await ok(rootPath+'/account/request',{email:'shared-restore@example.test',password})
  await ok(rootPath+'/account/approve',{requestId:pending.requestId},ownerSession)
  const pendingFactor=await ok(rootPath+'/enrol/totp',{},undefined,pending.capability)
  assert.ok(pendingFactor.secret)
  await stop()
  console.info('Recovery restore: offline snapshot')
  const before=await recoveryStorage(checkout,db=>({members:db.prepare('SELECT * FROM memberships ORDER BY user_id,project_id').all(),credentials:db.prepare('SELECT * FROM credentials ORDER BY user_id').all(),spent:db.prepare('SELECT * FROM owner_recoveries').all(),approvals:db.prepare('SELECT count(*) n FROM identity_recovery_approvals').get().n}))
  assert.equal(before.approvals,1);assert.equal(before.spent.length,1)
  console.info('Recovery restore: public export/reset/import')
  await run(checkout,['export','--output','exports/recovery.rer'])
  console.info('Recovery restore: public reset')
  await run(checkout,['reset','--yes'])
  console.info('Recovery restore: public import')
  await run(checkout,['import','--input','exports/recovery.rer','--yes'])
  // The documented restore path completes local configuration with setup. It
  // preserves restored owners/credentials instead of claiming a fresh owner.
  console.info('Recovery restore: post-import setup')
  await run(checkout,['setup','--owner-email',email,'--answers','.seed/answers.json','--port',String(port)])
  await recoveryStorage(checkout,db=>{
   for(const table of ['identity_recovery_requests','identity_recovery_approvals','identity_recovery_nonces'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0)
   assert.deepEqual(db.prepare('SELECT * FROM memberships ORDER BY user_id,project_id').all(),before.members)
   assert.deepEqual(db.prepare('SELECT * FROM credentials ORDER BY user_id').all(),before.credentials)
   assert.deepEqual(db.prepare('SELECT * FROM owner_recoveries').all(),before.spent)
  })
  console.info('Recovery restore: restored access and fresh recovery')
  await start()
  // Public maintenance wakes the real post-restore knowledge queue. Recovery
  // remains closed until conversion finishes; never replay a recovery command.
  const readyBy=Date.now()+60000
  for(;;){
   const response=await fetch(origin+'/api/knowledge/public');await response.arrayBuffer()
   if(response.status!==503)break
   assert.ok(Number(response.headers.get('Retry-After'))>0)
   assert.ok(Date.now()<readyBy,'the real restored queue finishes conversion')
   await new Promise(done=>setTimeout(done,100))
  }
  assert.equal((await call(rootPath+'/status',undefined,undefined,pending.capability)).response.status,401)
  assert.equal((await call(rootPath+'/complete',{factorId:pendingFactor.factorId,code:totp(pendingFactor.secret)},undefined,pending.capability)).response.status,401)
  const restored=await ok('/api/identity/login',{email,password})
  assert.equal(restored.twoFactor,'verify')
  await ok('/api/identity/two-factor/verify',{recoveryCode:completed.data.recoveryCodes[0]},restored.token)
  const fresh=await ok(rootPath+'/account/request',{email:'shared-restore@example.test',password})
  await ok(rootPath+'/account/approve',{requestId:fresh.requestId},restored.token)
  const replacement=await ok(rootPath+'/enrol/totp',{},undefined,fresh.capability)
  assert.equal((await call(rootPath+'/complete',{factorId:replacement.factorId,code:totp(replacement.secret)},undefined,fresh.capability)).response.status,200)
  assert.equal((await ok('/api/identity/login',{email:'shared-restore@example.test',password})).twoFactor,'verify')
  // The existing eligible member erase door retires pending credential state;
  // retained opaque recovery history does not keep a capability alive.
  console.info('Recovery restore: guarded member erase')
  const retiring=await ok(rootPath+'/account/request',{email:'shared-restore@example.test',password})
  await ok(rootPath+'/account/approve',{requestId:retiring.requestId},restored.token)
  await ok(rootPath+'/enrol/totp',{},undefined,retiring.capability)
  await ok(`/api/management/projects/${owner.projectId}/agents/${target.actor.id}/erase`,{},restored.token)
  assert.equal((await call(rootPath+'/status',undefined,undefined,retiring.capability)).response.status,401)
  assert.equal((await call('/api/identity/session',undefined,restored.token)).response.status,200)
  await stop()
  await recoveryStorage(checkout,db=>{
   assert.equal(db.prepare('SELECT count(*) n FROM identity_recovery_requests WHERE user_id=?').get(target.actor.id).n,0)
   assert.equal(db.prepare('SELECT count(*) n FROM identity_recovery_approvals WHERE request_id=?').get(retiring.requestId).n,0)
   assert.ok(db.prepare('SELECT count(*) n FROM identity_recovery_events WHERE user_id=?').get(target.actor.id).n>0)
  })
 }finally{try{try{await stop()}finally{await rm(scratch,{recursive:true,force:true})}}finally{if(priorCfFetch===undefined)delete process.env.CLOUDFLARE_CF_FETCH_ENABLED;else process.env.CLOUDFLARE_CF_FETCH_ENABLED=priorCfFetch}}
}
