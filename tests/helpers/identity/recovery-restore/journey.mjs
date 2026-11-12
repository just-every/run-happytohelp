import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {command,run,stopOwnedServer} from '../../rer-command.mjs'
import {archiveStorage} from '../../rer-archive.mjs'
import {totp} from '../two-factor.mjs'
const rootPath='/api/identity/owner-recovery'
export async function recoveryRestoreJourney(){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-identity-restore-')),checkout=join(scratch,'checkout'),email='recovery-restore@example.test',password='synthetic-recovery-restore-password',key=randomBytes(32).toString('hex')
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const origin=`http://127.0.0.1:${port}`;let server
 const call=async(path,body,token,capability)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...(capability?{'X-Recovery-Capability':capability}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();return {response,data}}
 const ok=async(...args)=>{const result=await call(...args);assert.ok(result.response.ok,`${args[0]} returned ${result.response.status}`);return result.data}
 const start=async()=>{server=command(checkout,['dev']);await server.waitFor(event=>event.event==='ready',240000)}
 const stop=async()=>{if(!server)return;await stopOwnedServer(server.child);await server.result();await server.stop();server=undefined}
 try{
  await promisify(execFile)('git',['clone','--quiet','--no-local','--depth','1',resolve('.'),checkout])
  await symlink(resolve('node_modules'),join(checkout,'node_modules'),'dir')
  await mkdir(join(checkout,'.seed'),{recursive:true})
  await writeFile(join(checkout,'.seed/answers.json'),JSON.stringify({WORKSPACE_NAME:'Recovery restore support',WIDGET_ORIGIN:origin,OWNER_NAME:'Casey Owner',OWNER_PASSWORD:password,EMAIL_PROVIDER:'later',H2H_OWNER_RECOVERY_KEY:key}),{mode:0o600})
  await run(checkout,['setup','--owner-email',email,'--answers','.seed/answers.json','--port',String(port)])
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
  const before=await archiveStorage(checkout,async({DB})=>({members:(await DB.prepare('SELECT * FROM memberships ORDER BY user_id,project_id').all()).results,credentials:(await DB.prepare('SELECT * FROM credentials ORDER BY user_id').all()).results,spent:(await DB.prepare('SELECT * FROM owner_recoveries').all()).results,approvals:(await DB.prepare('SELECT count(*) n FROM identity_recovery_approvals').first()).n}))
  assert.equal(before.approvals,1);assert.equal(before.spent.length,1)
  await run(checkout,['export','--output','exports/recovery.rer'])
  await run(checkout,['reset','--yes'])
  await run(checkout,['import','--input','exports/recovery.rer','--yes'])
  await archiveStorage(checkout,async({DB})=>{
   for(const table of ['identity_recovery_requests','identity_recovery_approvals','identity_recovery_nonces'])assert.equal((await DB.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0)
   assert.deepEqual((await DB.prepare('SELECT * FROM memberships ORDER BY user_id,project_id').all()).results,before.members)
   assert.deepEqual((await DB.prepare('SELECT * FROM credentials ORDER BY user_id').all()).results,before.credentials)
   assert.deepEqual((await DB.prepare('SELECT * FROM owner_recoveries').all()).results,before.spent)
  })
  await start()
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
 }finally{await stop();await rm(scratch,{recursive:true,force:true})}
}
