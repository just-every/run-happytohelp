import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MAX_LINE_BYTES} from '@runeditrun/rer/modules/portability';
import {readArtifact} from '../artifact-payloads.mjs';
import {archiveSnapshot,compareArchive} from '../rer-archive.mjs';
import {recoveryRuntime} from './runtime.mjs';
import {cliForRuntime,passwordSession} from './cli.mjs';
import {seedJourney,verifyAccess,verifyRestoredApi,eraseRecoveryIssuer,credentials,setupToken,call} from './journey.mjs';

// One real public rer lifecycle: a populated native installation is destroyed,
// imported into fresh storage, and used with its original password and files.
export async function portableRestoreJourney({archiveQualification=false}={}){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-portable-')),artifact=await readArtifact('delivery-artifact/happytohelp-worker-artifact.json');
 let source,target;
 try{
  source=await recoveryRuntime(artifact,{directory:join(scratch,'source-runtime'),variables:{H2H_SETUP_TOKEN:setupToken}});
  const sourceRoot=source.directory,cli=await cliForRuntime(source);
  await source.start();
  assert.equal((await call(source,'/api/identity/bootstrap',credentials)).status,403);
  assert.equal((await call(source,'/api/identity/bootstrap',{...credentials,setupToken:'wrong'})).status,403);
  const issuerId='synthetic-hh-recovery-issuer',issuerSession='synthetic-hh-recovery-issuer-session';
  const state=await seedJourney(source,{prepareStorage:async(storage,owner)=>{
   const write=(sql,values=[])=>storage.inspect({sql,values}),hash=createHash('sha256').update(issuerSession).digest('hex');
   await write("INSERT INTO users VALUES(?,'synthetic-hh-recovery-issuer@example.test','Synthetic recovery issuer',1)",[issuerId]);
   await write("INSERT INTO memberships VALUES(?,?,'admin')",[owner.projectId,issuerId]);
   await write("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'admin',?)",[hash,issuerId,owner.projectId,Date.now()+3600000]);
   await write("INSERT INTO session_factors VALUES(?,?,'password',?)",[hash,issuerId,Date.now()]);
  }});
  await eraseRecoveryIssuer(source,state,issuerId,issuerSession);
  await source.close();
  const archive=join(scratch,'support.rer');await cli(['export','--output',archive]);
  assert.equal((await stat(archive)).mode&0o777,0o600);
  const before=await archiveSnapshot(sourceRoot),raw=await readFile(archive,'utf8');
  for(const secret of [credentials.password,state.api.machine.token,state.api.erasedIssuer.token])assert.ok(!raw.includes(secret),'portable archive contains no password or live bearer');
  if(archiveQualification){
   await cli(['import','--input',archive,'--yes'],4);
   compareArchive(before,await archiveSnapshot(sourceRoot));
  }
  // The source's application and state are gone before the destination opens.
  await rm(sourceRoot,{recursive:true,force:true});source=undefined;
  target=await recoveryRuntime(artifact,{directory:join(scratch,'restored-runtime'),variables:{H2H_SETUP_TOKEN:setupToken}});
  const targetRoot=target.directory,restore=await cliForRuntime(target);
  // The full archive qualification shares this same destroyed-source restore
  // lifecycle on nightly/release runs; push keeps the successful public path.
  if(archiveQualification){
   const empty=await archiveSnapshot(targetRoot);
   const damaged=join(scratch,'damaged.rer'),oversized=join(scratch,'oversized.rer'),records=raw.trimEnd().split('\n').map(JSON.parse);
   records.at(-1).contentHash='0'.repeat(64);
   await writeFile(damaged,records.map(JSON.stringify).join('\n')+'\n');await writeFile(oversized,Buffer.alloc(MAX_LINE_BYTES+1,0x20));
   for(const input of [damaged,oversized]){await restore(['import','--input',input,'--yes'],4);compareArchive(empty,await archiveSnapshot(targetRoot));}
   await restore(['import','--input',archive],4);
   compareArchive(empty,await archiveSnapshot(targetRoot));
  }
  await restore(['import','--input',archive,'--yes']);
  compareArchive(before,await archiveSnapshot(targetRoot));
  if(archiveQualification){
   await restore(['export','--output',join(scratch,'roundtrip.rer')]);
   const roundtrip=(await readFile(join(scratch,'roundtrip.rer'),'utf8')).trimEnd().split('\n').map(JSON.parse);
   assert.equal(roundtrip.at(-1).contentHash,JSON.parse(raw.trimEnd().split('\n').at(-1)).contentHash,'every portable row and file survives re-export');
  }
  await target.start();
  assert.equal((await call(target,'/api/identity/session',undefined,state.owner.token)).status,401,'live source sessions are retired');
  const login=await passwordSession(target,credentials.email,credentials.password,state.owner.projectId);
  assert.equal(login.actor.id,state.r4.actorId);
  state.owner.token=login.token;
  const teammate=await passwordSession(target,'recovery-teammate@example.test',state.r4.teammatePassword,state.owner.projectId);
  state.r4.teammateToken=teammate.token;
  await verifyAccess(target,state,login.token);await verifyRestoredApi(target,state);
  assert.equal((await call(target,'/api/identity/bootstrap',{...credentials,setupToken})).status,409);
 }finally{
  if(source)await source.close();if(target)await target.close();
  await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
