import {seedVoicePortable,verifyVoicePortable} from '../voice/portable.mjs';
import { fileURLToPath as __rerTestEntryPath } from 'node:url';
import assert from 'node:assert/strict';
import {hostedExportJourney} from './hosted-export.mjs';
import {MAX_LINE_BYTES} from '@runeditrun/rer/modules/portability';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {command,run,stopOwnedServer} from '../rer-command.mjs';
import {waitForServingCapacity} from '../serving-capacity.mjs';
import {archiveSnapshot,archiveStorage,retainHistoricalLedger,assertHistoricalLedger,compareArchive,compareDevEntryArchive} from '../rer-archive.mjs';
import {seedPortableData,verifyPortableData} from '../rer-data.mjs';
import {seedReportClaimedRecovery} from '../reports-portable.mjs';
import {interruptPortableTraining} from '../training-portable.mjs';
import {interruptPortableWork,verifyPortableWork} from '../unfinished-portable.mjs';
import {safeDiagnostic} from '../delegation-journey/diagnostics.mjs';
import {readDurableObjects} from '../../../scripts/installer/durable-objects.mjs';

// The fresh-clone rer command journey: install, setup, dev, export/import, reset and fresh owner.
export async function freshInstallJourney(){
const __rerTestEntry = __rerTestEntryPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));

// One maintained public command journey replaces the standalone installer flow.
const source=fileURLToPath(new URL('../../..',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'h2h-rer-journey-')),root=join(scratch,'checkout');
const execute=promisify(execFile);
let server,success=false;
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const email='rer-journey@example.test',password=randomBytes(24).toString('base64url');
const origin=`http://127.0.0.1:${port}`;
const setup=['setup','--owner-email',email,'--answers','.seed/local-answers.json','--port',String(port)];
const json=async(path,body,token,cookie)=>{
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(response.ok,true,`Native ${body?'POST':'GET'} ${path} returned HTTP ${response.status}`);return response.json();
};
async function start(){
 await waitForServingCapacity();
 server=command(root,['dev']);
 const ready=await server.waitFor(event=>event.event==='ready',180000);
 assert.equal(ready.url,origin);
 assert.equal((await json('/health')).status,'ok');
}
async function stop(){
 if(!server)return;
 await stopOwnedServer(server.child);
 const result=await server.result();assert.ok([0,130,143].includes(result.code));
 await server.stop();server=undefined;
 await assert.rejects(fetch(origin+'/health',{signal:AbortSignal.timeout(2000)}));
}
async function signIn(){
 const {readDevKey}=await import('@runeditrun/rer/dev-identity');
 const {signInAs}=await import('@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs');
 const identity=await signInAs({origin,key:await readDevKey(root),returnTo:'/setup'});
 const native=identity.cookies.find(cookie=>cookie.name==='h2h_session');assert.ok(native);
 assert.equal((await fetch(origin+'/api/identity/session',{headers:{Cookie:'h2h_session='+native.value}})).status,401,'a native dev session requires the checkout gate');
 return json('/api/identity/session',undefined,undefined,identity.header);
}

try{
 await execute('git',['clone','--quiet','--no-local','--depth','1',source,root]);
 await run(root,['describe']);
 await run(root,['check','--profile','first-party']);
 await run(root,['install']);
 await mkdir(join(root,'.seed'),{mode:0o700,recursive:true});
 await writeFile(join(root,'.seed/local-answers.json'),JSON.stringify({WORKSPACE_NAME:'Rer support',WIDGET_ORIGIN:'https://example.test',PRIMARY_COLOR:'#7c3aed',OWNER_NAME:'Rer owner',OWNER_PASSWORD:password,EMAIL_PROVIDER:'later'}),{mode:0o600});
 await run(root,setup);
 await assert.rejects(fetch(origin+'/health',{signal:AbortSignal.timeout(2000)}),'setup must leave no runtime');
 await run(root,['setup','--owner-email','other-owner@example.test','--answers','.seed/local-answers.json','--port',String(port)],4); // A different owner is refused before any change.
 const privateBefore=await readFile(join(root,'.dev.vars'));
 assert.equal((await stat(join(root,'.dev.vars'))).mode&0o777,0o600);
 await start();
 const actor=await signIn();assert.equal(actor.role,'owner');assert.ok(actor.id);
 const login=await json('/api/identity/login',{email,password});assert.equal(login.actor.id,actor.id);
 const project=await json('/api/management/projects',{name:'Retained workspace',allowedOrigin:origin},login.token);
 await run(root,['reset','--yes'],4); // Active-state refusal.
 await stop();await run(root,setup);
 assert.ok(privateBefore.equals(await readFile(join(root,'.dev.vars'))),'setup must preserve exact private bytes');
 await start();const retained=await json('/api/identity/login',{email,password,projectId:project.id});
 assert.equal(retained.actor.id,actor.id);assert.equal(retained.actor.projectId,project.id);
 assert.ok((await json('/api/management/projects',undefined,retained.token)).data.some(row=>row.id===project.id));
 const portable=await seedPortableData(origin,project.id,retained.token,json);
 await stop();
 const presenceRows=()=>archiveStorage(root,async({DB})=>(await DB.prepare('SELECT count(*) n FROM operator_presence').first()).n);
 assert.ok(await presenceRows()>0,'the owner\'s dashboard presence was recorded');
 await seedReportClaimedRecovery(root,portable.reports);
 await interruptPortableTraining(root,portable.training);
 await interruptPortableWork(root,portable,actor.id);
 await seedVoicePortable(root,portable);
 const historical=await retainHistoricalLedger(root);
 const beforeExport=await archiveSnapshot(root);
 assert.ok(beforeExport.rows.move_in_runs.length>0 && beforeExport.rows.contact_erasures.length>0 && beforeExport.objects.length>0);
 assert.deepEqual(beforeExport.rows.durable_object_snapshots,[],'first export has no prior Durable Object capture');
 const exportStarted=Date.now();
 await run(root,['export','--output','exports/support.rer']);
 const voiceArchive=await readFile(join(root,'exports/support.rer'),'utf8');
 for(const marker of ['synthetic-happytohelp-43','synthetic-happytohelp-46','synthetic-happytohelp-48','synthetic-happytohelp-49','synthetic-happytohelp-50','synthetic-happytohelp-51','synthetic-happytohelp-52'])assert.equal(voiceArchive.includes(marker),false,'voice media and provider credentials stay out of the archive');
 // Export records declared Durable Object namespaces in D1 before archiving.
 // Validate that exact addition, then compare restore with what was exported.
 const before=await archiveSnapshot(root),snapshots=await readDurableObjects(root);
 const captured=before.rows.durable_object_snapshots.map(JSON.parse);
 assert.equal(captured.length,snapshots.length);
 for(const item of snapshots){
  const row=captured.find(row=>row.namespace===item.namespace);assert.ok(row);
  assert.ok(Number.isInteger(row.captured_at)&&row.captured_at>=exportStarted&&row.captured_at<=Date.now());
  assert.deepEqual(row,{namespace:item.namespace,class_name:item.className,schema:item.schema,instances:item.instances,records:item.records.length,records_json:JSON.stringify(item.records),digest:item.digest,captured_at:row.captured_at});
 }
 const expectedExport=structuredClone(beforeExport);expectedExport.rows.durable_object_snapshots=before.rows.durable_object_snapshots;
 compareArchive(expectedExport,before);
 assert.equal((await stat(join(root,'exports/support.rer'))).mode&0o777,0o600);
 const hostedArchive=await hostedExportJourney(root,scratch);
 await assertHistoricalLedger(root,historical);
 await run(root,['import','--input','exports/support.rer','--yes'],4);
 compareArchive(before,await archiveSnapshot(root));
 // A valid archive with unknown schema must refuse on an empty target;
 // the known older archive must bridge to a later additive migration.
 const additive=join(root,'migrations/9999_rer_journey.sql');
 await archiveStorage(root,async({DB})=>DB.prepare('CREATE TABLE unknown_archive_table(id TEXT PRIMARY KEY)').run());
 // A valid archive of an unknown source schema must still be refused.
 await run(root,['export','--output','exports/later.rer']);
 await run(root,['reset'],4);await access(join(root,'.dev.vars'));
 await run(root,['reset','--yes']);await access(join(root,'exports/support.rer'));await access(__rerTestEntry);
 await run(root,['reset','--yes']);
 await run(root,['import','--input','exports/later.rer','--yes'],4);
 const empty=await archiveSnapshot(root);assert.equal(empty.rows.users.length,0);assert.equal(empty.objects.length,0);
 // These are public import refusals on an empty destination, not only parser
 // unit checks: neither damaged integrity nor an oversized record may stage data.
 const records=(await readFile(join(root,'exports/support.rer'),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));
 assert.equal(records.at(-1).kind,'closing');records.at(-1).contentHash='0'.repeat(64);
 await writeFile(join(root,'exports/damaged.rer'),records.map(record=>JSON.stringify(record)).join('\n')+'\n',{mode:0o600});
 await writeFile(join(root,'exports/oversized.rer'),Buffer.alloc(MAX_LINE_BYTES+1,0x20),{mode:0o600});
 for(const [name,reason] of [['damaged.rer',/archive integrity check failed/],['oversized.rer',/exceeds the supported size/]]){
  const refusal=await run(root,['import','--input','exports/'+name,'--yes'],4);
  assert.match(refusal.events.filter(event=>event.event==='error').map(event=>event.message).join('\n'),reason);
  compareArchive(empty,await archiveSnapshot(root));
 }

 await writeFile(additive,'CREATE TABLE rer_journey_additive(id TEXT PRIMARY KEY, value TEXT);\n');
 await run(root,['import','--input',hostedArchive,'--yes']);
 compareArchive(before,await archiveSnapshot(root),['rer_journey_additive']);
 await verifyPortableWork(root,portable);
 assert.equal(await presenceRows(),0,'who had the dashboard open never travels in an archive');
 const migrationCount=()=>archiveStorage(root,async({DB})=>(await DB.prepare("SELECT count(*) n FROM d1_migrations WHERE name='9999_rer_journey.sql'").first()).n);
 assert.equal(await migrationCount(),1);
 let restoredData=await archiveSnapshot(root);
 const ledgerSnapshot=()=>archiveStorage(root,async({DB})=>{
  const ledgers={};for(const {name} of (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('d1_migrations','_rer_deploy_migrations') ORDER BY name").all()).results)ledgers[name]=(await DB.prepare(`SELECT * FROM ${name} ORDER BY name`).all()).results;
  return ledgers;
 });
 const restoredLedgers=await ledgerSnapshot();
 let restoredPrivate;
 for(let i=0;i<2;i++){
  const since=Date.now();await run(root,setup);
  const afterSetup=await archiveSnapshot(root);
  compareArchive(restoredData,afterSetup);
  await start();await signIn();await stop();
  const afterSignIn=await archiveSnapshot(root);
  compareDevEntryArchive(afterSetup,afterSignIn);
  restoredData=afterSignIn;
  assert.deepEqual(await ledgerSnapshot(),restoredLedgers,'post-restore setup preserves every migration ledger row');
  const currentPrivate=await readFile(join(root,'.dev.vars'));
  if(restoredPrivate)assert.ok(restoredPrivate.equals(currentPrivate),'second post-restore setup preserves exact private bytes');
  restoredPrivate=currentPrivate;
 }
 await start();
 const restored=await json('/api/identity/login',{email,password,projectId:project.id});assert.equal(restored.actor.id,actor.id);assert.equal(restored.actor.projectId,project.id);
 assert.ok((await json('/api/management/projects',undefined,restored.token)).data.some(row=>row.id===project.id));
 // Login legitimately advances the portable integration authority epoch.
 // Snapshot after login so replay/read checks still compare every portable row.
 await stop();const beforeRestoredReads=await archiveSnapshot(root),readStart=Date.now();await start();
 await verifyPortableData(origin,portable,restored.token,json);
 await verifyVoicePortable(origin,portable,restored.token,json);
 await signIn();
 await stop();assert.equal(await migrationCount(),1);
 compareDevEntryArchive(beforeRestoredReads,await archiveSnapshot(root));
 assert.deepEqual(await ledgerSnapshot(),restoredLedgers,'post-restore reads and refused replays preserve migration history');
 // Every dry-run invocation uses the real command/build with the network edge
 // refusing every request, including read-only provider inspection.
 const network=join(scratch,'deploy-network.mjs'),calls=join(scratch,'deploy-requests.jsonl');
 await writeFile(calls,'');
 await writeFile(network,`
import {appendFileSync} from 'node:fs';
globalThis.fetch=async()=>{
 appendFileSync(${JSON.stringify(calls)},'unexpected request\\n');
 throw Error('Offline deployment dry-run must make no provider requests');
};
`);
 const dryEnv={OWNER_EMAIL:'owner@dry-run.example.com',EMAIL_PROVIDER:'sendgrid',EMAIL_FROM:'support@dry-run.example.test',EMAIL_API_KEY:'synthetic-happytohelp-1',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:'',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(network).href}`].filter(Boolean).join(' ')};
 for(const credentials of [{},{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-happytohelp-2'}]){
  const dry=await run(root,['deploy','--dry-run'],0,{env:{...dryEnv,...credentials}});
  assert.equal(dry.events.at(-1).ok,true);
  assert.equal(dry.events.at(-1).dryRun,true);assert.equal(dry.events.at(-1).deployed,false);
  assert.equal(dry.events.at(-1).providerChecked,false,'offline validation never claims target readiness');
  assert.equal(await readFile(calls,'utf8'),'','dry run makes zero provider requests with or without credentials');
  await assert.rejects(access(join(root,'.rer/deploy/production.json')),{code:'ENOENT'});
  assert.ok(restoredPrivate.equals(await readFile(join(root,'.dev.vars'))),'dry run preserves the local owner settings');
 }
 await run(root,['reset','--yes']);await rm(additive);await run(root,setup);await start();
 const fresh=await json('/api/identity/login',{email,password});assert.notEqual(fresh.actor.id,actor.id);
 assert.equal((await json('/api/management/projects',undefined,fresh.token)).data.length,1);
 await stop();
 // The owner's export remains in the checkout; generated files do not alter source.
 assert.equal((await execute('git',['status','--porcelain','--untracked-files=no'],{cwd:root})).stdout,'','journey preserves tracked source');
 success=true;
 console.log('Rer fresh-clone journey passed: install, setup/teardown, dev/health, automatic owner entry, retained owner/settings/data, active/unconfirmed reset refusal, private export/import, historical ledger custody, additive replay once, incompatible/nonempty refusal, all D1/R2 rows/bytes, completed/repeated/undone/erased import custody, restored erasure replay fences, two post-restore setups preserving data/ledgers with verified local sign-ins, deploy dry-run, reset and fresh owner.');
}catch(error){
 // Browser diagnostics can contain one-use fragment capabilities; emit only a safe source location.
 const errors=(server?.events()??[]).filter(event=>event.event==='error').map(event=>({code:event.code,message:safeDiagnostic(event.message,[password])}));
 if(errors.length)console.error(JSON.stringify({proof:'rer-command-refusal',errors}));
 const line=/fresh-install\.mjs:(\d+):/.exec(error.stack||'')?.[1]||'unknown';
 const diagnostic=/^(?:Rer [a-z-]+ exited \d+; expected \d+|Rer (?:dev|preview) (?:exited \d+ before the required event|exceeded its deadline); [a-z_]+, (?:machine load|disk space|server capacity|active operation|see private capture)|Native (?:GET|POST) \/[a-zA-Z0-9_/-]+ returned HTTP \d{3})(?:\n|$)/.exec(error.message??'')?.[0].trim();
 const code=/^[A-Z][A-Z0-9_]{1,30}$/.test(error.code??'')?`; code ${error.code}`:'';
 throw Error(`Rer journey failed (${error.name}, source line ${line}${diagnostic?'; '+diagnostic:''}${code}); private browser diagnostics withheld.`);
}finally{
 if(server)await server.stop();
 // Finder can recreate .DS_Store between readdir and rmdir on macOS.
 // Node retries only transient filesystem errors; functional failures still fail.
 if(success)await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 else console.error('Private native journey scratch retained:',scratch);
}

}
