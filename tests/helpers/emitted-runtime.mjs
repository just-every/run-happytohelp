import {spawn} from 'node:child_process'
import {isolatedQueues} from './isolated-queues.mjs'
import {appendFileSync,rmSync} from 'node:fs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
// The port defaults to H2H_RUNTIME_PORT (or H2H_TEST_PORT) when set, otherwise OS-assigned. An inspector opens only when the caller or H2H_RUNTIME_INSPECTOR_PORT gives its port:
// workerd that cannot bind its inspector socket never reports ready (Miniflare's waitForPorts hangs with no error and no exit), so a port is never implied.
// `vars` become Worker environment variables (for example REGISTRATION_ENABLED); none are set by default.
// `persist` serves an existing local D1/R2/DO state (an upgraded installation) after applying this source's migrations to it.
// Server start to a healthy /health took 1.5-3.6 s (6 local rounds, load 33-46, 20 Oct 2026); migrations (24-57 s) run before this window.
// A failed start exits and ends the wait at once; the bound only ends a start that neither reports ready nor exits.
// Each fresh installation receives its own copy of a pristine migrated store.
// Run the real migrator once per schema and database identity in this process;
// snapshot it before the Worker starts or any tenant fixture is seeded.
const migrationStores=new Map(),migrationDirectories=[]
process.once('exit',()=>{for(const directory of migrationDirectories)rmSync(directory,{recursive:true,force:true})})
async function migrateFresh(key,persist,apply){
 let store=migrationStores.get(key)
 if(!store){
  store=(async()=>{await apply();const directory=await mkdtemp(join(tmpdir(),'h2h-pristine-migrations-'));migrationDirectories.push(directory);const snapshot=join(directory,'state');await cp(persist,snapshot,{recursive:true});return snapshot})()
  migrationStores.set(key,store)
  try{await store}catch(error){migrationStores.delete(key);throw error}
 }else await cp(await store,persist,{recursive:true})
}
const WORKER_READY_MS=40_000
export async function createRuntime({port=Number(process.env.H2H_RUNTIME_PORT||process.env.H2H_TEST_PORT)||0,inspectorPort=process.env.H2H_RUNTIME_INSPECTOR_PORT?Number(process.env.H2H_RUNTIME_INSPECTOR_PORT):undefined,vars={},workerFirst=false,outboundFixture,persist:existing,databaseId='isolated-test-only',queueConsumers}={}){
 const root=resolve(new URL('../..',import.meta.url).pathname),directory=await mkdtemp(join(tmpdir(),'h2h-native-runtime-')),persist=existing||join(directory,'state'),migrations=join(directory,'migrations'),configPath=join(directory,'wrangler.json');await mkdir(migrations)
 const emitted=JSON.parse(await readFile(join(root,'dist/server/wrangler.json'),'utf8'));const moduleDirs=(await readdir(join(root,'src/modules'),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>join(root,'src/modules',d.name,'migrations'));const names=new Set();for(const dir of[join(root,'migrations'),...moduleDirs]){let files;try{files=await readdir(dir)}catch(error){if(error.code==='ENOENT')continue;throw error}for(const name of files.filter(f=>f.endsWith('.sql'))){if(names.has(name))throw new Error('Duplicate migration '+name);names.add(name);await writeFile(join(migrations,name),await readFile(join(dir,name)))}}
 const server=dirname(join(root,'dist/server/wrangler.json'));const config={name:'happytohelp-native-isolated-test',main:resolve(server,emitted.main),compatibility_date:emitted.compatibility_date,compatibility_flags:emitted.compatibility_flags,no_bundle:true,rules:emitted.rules,assets:{directory:resolve(server,emitted.assets.directory)},d1_databases:[{binding:'DB',database_name:'isolated-test',database_id:databaseId,migrations_dir:migrations}],r2_buckets:[{binding:'FILES',bucket_name:'isolated-files'}],durable_objects:emitted.durable_objects,migrations:emitted.migrations,queues:isolatedQueues({consumers:queueConsumers})}
 if(workerFirst)Object.assign(config.assets,{binding:'ASSETS',run_worker_first:true})
 await writeFile(configPath,JSON.stringify(config,null,2));const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js'),env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,WRANGLER_LOG_PATH:process.env.WRANGLER_LOG_PATH,H2H_TEST_BINDINGS:JSON.stringify(vars),...(outboundFixture?{H2H_TEST_OUTBOUND_FIXTURE:outboundFixture}:{}),CI:'1',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};let logs='';const run=async args=>new Promise((resolveRun,reject)=>{const processRun=spawn(process.execPath,[wrangler,...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});let output='';processRun.stdout.on('data',b=>output+=b);processRun.stderr.on('data',b=>output+=b);processRun.on('error',reject);processRun.on('exit',async code=>{logs+=output;if(code===0)resolveRun(output);else{await writeFile(join(directory,'runtime.log'),logs);reject(new Error(`Wrangler command failed (${code}); preserved logs: ${directory}/runtime.log`))}})});
 // Preserve native runtime diagnostics even when a browser step is terminated.
 const record=bytes=>{logs+=bytes;appendFileSync(join(directory,'runtime.log'),bytes)}
 const schema=createHash('sha256').update(databaseId);for(const name of [...names].sort())schema.update(name).update(await readFile(join(migrations,name)))
 const apply=()=>run(['d1','migrations','apply','DB','--local','--config',configPath,'--persist-to',persist]);if(existing)await apply();else await migrateFresh(schema.digest('hex'),persist,apply);await writeFile(join(directory,'runtime.log'),logs);let child=spawn(process.execPath,[join(root,'tests/helpers/emitted-runtime-server.mjs'),configPath,persist,String(port),...(inspectorPort!==undefined?[String(inspectorPort)]:[])],{cwd:directory,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',record);child.stderr.on('data',record)
 let origin;let ready=false;const readyBy=Date.now()+WORKER_READY_MS;while(Date.now()<readyBy){if(child.exitCode!==null)break;const match=logs.match(/Ready on (http:\/\/(?:localhost|127\.0\.0\.1):\d+)/);if(match){const candidate=`http://127.0.0.1:${match[1].split(':').pop()}`;try{const response=await fetch(candidate+'/health');const health=await response.json();ready=response.ok&&health?.status==='ok'&&health?.runtime==='native-rer'&&health?.database==='reachable'&&health?.files==='reachable';if(ready)origin=candidate}catch{}}if(ready)break;await new Promise(r=>setTimeout(r,250))}
 const close=async(success)=>{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.exitCode!==null?r():child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');await writeFile(join(directory,'runtime.log'),logs);if(success)await rm(directory,{recursive:true,force:true});else console.error('Native runtime failure artifacts retained:',directory)}
 if(!ready){await close(false);throw new Error('Emitted Worker did not start:\n'+logs)}
 // Seed a separate tenant directly in the isolated test database; public setup is first-owner only.
 const seedTenant=async({name,email,allowedOrigin,platformAdmin=false})=>{
  const projectId=randomUUID(),userId=randomUUID(),token=randomUUID(),widgetKey=randomUUID(),now=Date.now();const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const sql=`INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(${[projectId,name,widgetKey,allowedOrigin,now].map(quote).join(',')}); INSERT INTO users(id,email,name,created_at) VALUES(${[userId,email,name,now].map(quote).join(',')}); INSERT INTO memberships(project_id,user_id,role) VALUES(${[projectId,userId,'owner'].map(quote).join(',')}); INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(${[createHash('sha256').update(token).digest('hex'),userId,projectId,'owner',now+3600000].map(quote).join(',')}); INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(${[createHash('sha256').update(token).digest('hex'),userId,'password',now].map(quote).join(',')});${platformAdmin?` INSERT INTO platform_admins(user_id) VALUES(${quote(userId)});`:''}`;
  await run(['d1','execute','DB','--local','--config',configPath,'--persist-to',persist,'--command',sql]);return {projectId,userId,token};
 }
 // Runs SQL against the isolated test database, for states the public APIs cannot produce (an expired link, a pending sign-up).
 const execute=command=>run(['d1','execute','DB','--local','--config',configPath,'--persist-to',persist,'--command',command])
 // A lead turned presence-based away off: the schedule and switch alone decide availability, as for a team that answers
 // without the dashboard open. Presence itself: tests/helpers/widget/presence-browser.mjs.
 const presenceAwayOff=projectId=>execute(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('${String(projectId).replaceAll("'","''")}',json_object('is_presence_away_enabled',json('false')),${Date.now()}) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.is_presence_away_enabled',json('false'))`)
 const restart=async(beforeStart)=>{
  child.kill('SIGTERM');await Promise.race([new Promise(resolveStop=>child.exitCode!==null?resolveStop():child.once('exit',resolveStop)),new Promise(resolveStop=>setTimeout(resolveStop,3000))]);
  if(child.exitCode===null){child.kill('SIGKILL');await new Promise(resolveStop=>child.exitCode!==null?resolveStop():child.once('exit',resolveStop));}
  // Historical fixture mutations use a separate D1 owner only while the
  // application is fully stopped, then return through the emitted Worker.
  if(beforeStart)await beforeStart();
  child=spawn(process.execPath,[join(root,'tests/helpers/emitted-runtime-server.mjs'),configPath,persist,new URL(origin).port,...(inspectorPort!==undefined?[String(inspectorPort)]:[])],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',record);child.stderr.on('data',record);
  const deadline=Date.now()+60000;
  while(Date.now()<deadline&&child.exitCode===null){try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(2000)});if(response.ok)return}catch{}await new Promise(resolveWait=>setTimeout(resolveWait,500))}
  throw Error('Restarted native Worker did not become healthy');
 }
 return {origin,close,restart,directory,seedTenant,execute,presenceAwayOff,migrationCount:names.size,get logs(){return logs}}
}
