import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {existsSync,readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {chmod,cp,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,utimes,writeFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import {produceArtifact,config} from '../../scripts/delivery/build.mjs'
import {collectFiles} from '../../scripts/delivery/base/paths.mjs'
import {wranglerBindings} from '../../scripts/delivery/base/bindings.mjs'
import {readArtifact,payloadBytes} from '../helpers/artifact-payloads.mjs'
import {artifactRuntime} from '../helpers/independent-artifact.mjs'
import {validateArtifact as validateRawArtifact,materializeArtifact,digest} from '../../live-proofs/artifact.mjs'
import {deployStage,health} from '../../live-proofs/stage-adapter.mjs'
import {makeReceipt,validateReceipt} from '../../live-proofs/receipt.mjs'
import {persistToGit} from '../../live-proofs/git-store.mjs'
import {git} from '../../live-proofs/git.mjs'
import {validateSource} from '../../live-proofs/validate-source.mjs'
import {candidate,env,packageCandidate,policy,sha,writeCandidate} from '../helpers/installer/stage-fixtures.mjs'
import {run as rer} from '../helpers/rer-command.mjs'

const {localAgentArchive,FIXED_MTIME}=createRequire(import.meta.url)('../../scripts/local-agent-archive.cjs')
const scratch=async name=>mkdtemp(join(tmpdir(),name))

test('the release artifact carries every built module, migration and asset with browser types, never credential files or symlinks, ships a deterministic connector archive, and starts natively behind its private setup token',async()=>{
 const recipe=JSON.parse(await readFile('management/integration/recipe.json','utf8')).plan
 const spec=JSON.parse(await readFile('management/integration/deployment-spec.json','utf8'))
 const wrangler=JSON.parse(await readFile('wrangler.jsonc','utf8'))
 for(const field of ['queueConsumers','schedules'])assert.deepEqual(recipe[field],spec[field],`recipe ${field} matches the deployment spec`)
 if(wrangler.queues?.consumers!==undefined)assert.deepEqual(spec.queueConsumers,wranglerBindings(wrangler).queueConsumers,'queue consumers match Wrangler bindings and declared settings')
 if(wrangler.triggers?.crons!==undefined)assert.deepEqual(spec.schedules,wrangler.triggers.crons,'schedules match Wrangler')
 // Fixture builds through the real producer: browser MIME types kept, private files refused.
 const root=await scratch('h2h-artifact-')
 try{
  await mkdir(join(root,'dist/server'),{recursive:true});await mkdir(join(root,'dist/client/assets'),{recursive:true})
  await writeFile(join(root,'dist/server/index.js'),'export default {};');await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({compatibility_date:'2026-09-08',vars:wrangler.vars}))
  const types={'hero.mp4':'video/mp4','heading.woff':'font/woff','body.ttf':'font/ttf','body.woff2':'font/woff2'}
  for(const name of Object.keys(types))await writeFile(join(root,'dist/client/assets',name),Buffer.from([0,1,2,255]))
  const fixture=await readArtifact(await produceArtifact({root,config:{...config,edition:undefined}}))
  for(const [name,contentType] of Object.entries(types)){const asset=fixture.assets.find(asset=>asset.path===`/assets/${name}`);assert.equal(asset.contentType,contentType);assert.deepEqual(await payloadBytes(fixture,asset),Buffer.from([0,1,2,255]))}
  for(const directory of ['dist/server','dist/client'])for(const name of ['.dev.vars','.dev.vars.production','.env','.env.local','.env.production','.npmrc','.netrc']){const file=join(root,directory,name);await rm(join(root,'delivery-artifact'),{recursive:true,force:true});await writeFile(file,'FIXTURE_PRIVATE_BINDING=must-not-leave-local-build');await assert.rejects(produceArtifact({root,config:{...config,edition:undefined}}),/Private/,`${directory}/${name}`);await rm(file)}
  await mkdir(join(root,'public'));await writeFile(join(root,'private'),'never publish');await symlink('../private',join(root,'public','leak'));await assert.rejects(collectFiles(root,'public'),/symlink/)
 }finally{await rm(root,{recursive:true,force:true})}
 // The connector download depends only on its packaged content and refuses symlinks.
 const base=await scratch('h2h-agent-archive-')
 try{
  const source=async(path,{mtime,mode})=>{const directory=join(base,path,'local-agent');await mkdir(join(directory,'bin'),{recursive:true});await mkdir(join(directory,'lib'),{recursive:true});await writeFile(join(directory,'package.json'),'{"name":"connector"}\n');await writeFile(join(directory,'bin','h2h-local.mjs'),'#!/usr/bin/env node\n');await writeFile(join(directory,'lib','a.mjs'),'export const a = 1;\n');await chmod(join(directory,'bin','h2h-local.mjs'),mode);for(const file of ['package.json','bin/h2h-local.mjs','lib/a.mjs'])await utimes(join(directory,file),mtime,mtime);return directory}
  const options={topLevel:'happytohelp-local-agent',inputs:['package.json','lib','bin']},first=await source('one',{mtime:new Date('2020-01-02T03:04:05Z'),mode:0o755}),archive=localAgentArchive({source:first,...options})
  assert.deepEqual(localAgentArchive({source:await source('two/deeper',{mtime:new Date(),mode:0o700}),...options}),archive,'the same content gives the same bytes')
  assert.ok(!gunzipSync(archive).includes(Buffer.from(base)),'the archive names no source directory')
  const extracted=join(base,'extracted');await mkdir(extracted);execFileSync('tar',['-xzf','-','-C',extracted],{input:archive})
  const executable=await stat(join(extracted,'happytohelp-local-agent/bin/h2h-local.mjs'));assert.equal(executable.mode&0o111,0o111&~process.umask());assert.equal(Math.floor(executable.mtimeMs/1000),FIXED_MTIME)
  await symlink('../package.json',join(first,'lib','link.mjs'));assert.throws(()=>localAgentArchive({source:first,...options}),/cannot contain symlinks/)
 }finally{await rm(base,{recursive:true,force:true})}
 // This build's own artifact: its schema closure is the repository's migrations, and it runs natively.
 const artifact=await readArtifact('delivery-artifact/happytohelp-worker-artifact.json')
 const migrations=(await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort()
 assert.deepEqual(artifact.deploymentSpec.migrations.map(migration=>migration.name).sort(),migrations,'every migration ships, and nothing else')
 for(const migration of artifact.deploymentSpec.migrations)assert.equal(migration.sql,await readFile(join('migrations',migration.name),'utf8'),migration.name)
 assert.ok(artifact.assets.some(asset=>asset.path==='/downloads/happytohelp-local-agent.tar.gz'),'the connector download ships with the app')
 for(const entry of [...artifact.modules,...artifact.assets])assert.doesNotMatch(entry.path??entry.name,/(^|\/)\.(dev\.vars|env|npmrc|netrc)/)
 const setupToken=randomBytes(32).toString('hex'),runtime=await artifactRuntime(artifact,{port:12601,variables:{H2H_SETUP_TOKEN:setupToken}})
 try{
  const call=(path,body,token)=>fetch(runtime.origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})})
  const owner={name:'Packaged workspace',email:'packaged@example.test',password:randomBytes(24).toString('base64url'),allowedOrigin:'https://website.example'}
  assert.equal((await call('/api/identity/setup-status')).status,409);assert.equal((await call('/api/identity/bootstrap',owner)).status,403);assert.equal((await call('/api/identity/bootstrap',{...owner,setupToken:'wrong'})).status,403)
  const created=await call('/api/identity/bootstrap',{...owner,setupToken});assert.equal(created.status,201);const session=await created.json()
  assert.equal((await call('/api/identity/bootstrap',{...owner,setupToken})).status,409);assert.equal((await call('/api/identity/session',undefined,session.token)).status,200)
  assert.equal((await call('/downloads/happytohelp-local-agent.tar.gz')).status,200)
 }finally{await runtime.close()}
})

// Existing fixture bodies stay byte-for-byte; the controller accepts schema-2 payloads only.
function validateArtifact(raw,expected){const {raw:manifest,payloads}=packageCandidate(JSON.parse(raw));if(digest(raw)!==expected)throw Error('invalid-artifact');return validateRawArtifact(manifest,digest(manifest),payloads)}

test('the stage deploy controller deploys only a verified exact source and artifact to its isolated stage: production or custom targets, malicious artifacts, missing secrets and failed checks stop before any provider call with a fixed receipt',async()=>{
 const root=await scratch('h2h-stage-')
 try{
  const gitEnv={PATH:process.env.PATH,HOME:root,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'}
  const store=join(root,'store.git');git(root,['init','--bare',store],{env:gitEnv});const tree=git(store,['mktree'],{env:gitEnv,input:''}).text;git(store,['update-ref','refs/heads/main',git(store,['commit-tree',tree],{env:gitEnv,input:'initial\n'}).text],{env:gitEnv})
  const transport={remote:store,tempRoot:root,env:gitEnv}
  // The reviewed controller command, run as the workflow runs it.
  await cp(resolve('live-proofs'),join(root,'control/live-proofs'),{recursive:true})
  const controller=(inputs,label)=>{const output=join(root,label+'-output'),run=spawnSync('/bin/bash',['--noprofile','--norc','-c','node control/live-proofs/run.mjs'],{cwd:root,env:{RUNNER_TEMP:root,...inputs,PATH:process.env.PATH,HOME:root,GITHUB_OUTPUT:output},encoding:'utf8',timeout:20000});const outputs=Object.fromEntries((existsSync(output)?readFileSync(output,'utf8'):'').trim().split('\n').filter(Boolean).map(line=>line.split('=')));return {run,outputs}}
  for(const [token,expected,attempt] of [['test-setup-secret','passed','1'],['','failed','2']]){
   const inputs=env({GITHUB_RUN_ATTEMPT:attempt,H2H_SETUP_TOKEN:token,EVIDENCE_WRITE_TOKEN:'not-forwarded-test'}),{run,outputs}=controller(inputs,'proof-'+expected)
   assert.equal(run.status,expected==='passed'?0:1,run.stderr);assert.equal(run.stdout,`CLOUDFLARE_API_TOKEN\n${token?'H2H_SETUP_TOKEN\n':''}`,'names only, never values');assert.equal(run.stderr,'')
   const receipt=makeReceipt({...inputs,JOB_RESULT:run.status===0?'success':'failure',EXECUTION_RESULT:outputs.result,STARTED:outputs.started,FINISHED:outputs.finished})
   assert.equal(receipt.result,expected);assert.equal(receipt.failureStatus,expected==='passed'?null:'missing-secret')
   const path=persistToGit(validateReceipt(receipt),transport);assert.deepEqual(JSON.parse(git(store,['show',`main:${path}`],{env:gitEnv}).text),receipt)
   assert.throws(()=>persistToGit(receipt,transport),/receipt-already-exists/);assert.doesNotMatch(JSON.stringify(receipt),/test-provider-token|test-setup-secret/)
  }
  const a=candidate(),file=join(root,'artifact.json');await writeCandidate(file,a)
  const stage=(changes={},policyChanges={})=>controller(env({MODE:'stage',INPUT_PROOF:'',ARTIFACT_FILE:file,H2H_STAGE_POLICY_JSON:JSON.stringify({...policy(a),...policyChanges}),...changes}),'stage-'+Math.random().toString(36).slice(2))
  assert.equal(stage({H2H_STAGE_POLICY_JSON:''}).outputs.result,'stage-target-unconfigured')
  for(const change of [{origin:'https://app.happytohelp.com'},{origin:'https://help.justevery.com'},{origin:'https://fixture-stage.fixture.workers.dev@evil.example'},{prefix:'production'},{isolation:'production'},{sourceSha:'3'.repeat(40)},{artifactSha256:'latest'},{extra:'command'}]){const {run,outputs}=stage({},change);assert.equal(run.status,1);assert.equal(outputs.result,'invalid-stage-policy',JSON.stringify(change))}
  for(const tamper of [x=>x.modules[0].name='../outside.js',x=>x.modules[0].name='.npmrc',x=>x.deploymentSpec.publicVariables={NODE_OPTIONS:'--import=/tmp/payload'},x=>x.deploymentSpec.resources.push({kind:'kv',binding:'TOKEN'})]){
   const bad=candidate();tamper(bad);const badFile=join(root,'bad-'+Math.random().toString(36).slice(2)+'.json');await writeCandidate(badFile,bad)
   const {run,outputs}=controller(env({MODE:'stage',INPUT_PROOF:'',ARTIFACT_FILE:badFile,H2H_STAGE_POLICY_JSON:JSON.stringify(policy(bad))}),'bad');assert.equal(run.status,1);assert.equal(outputs.result,'invalid-artifact')
  }
  // Artifact bytes are data only: duplicates, bad encodings, digests and sidecar tampering are refused.
  const raw=JSON.stringify(candidate());assert.equal(validateArtifact(raw,digest(raw)).length,3);assert.throws(()=>validateArtifact(raw,'0'.repeat(64)))
  for(const change of [x=>x.modules.push(x.modules[0]),x=>x.modules[0].contentBase64='!bad',x=>x.deploymentSpec.migrations[0].sha256='0'.repeat(64),x=>x.assets[0].path='index.html']){const x=candidate();change(x);const text=JSON.stringify(x);assert.throws(()=>validateArtifact(text,digest(text)))}
  for(const mode of ['missing','bytes','symlink']){const dir=await scratch('h2h-sidecar-'),sidecarFile=join(dir,'artifact.json'),sidecarRaw=await writeCandidate(sidecarFile,candidate()),payload=join(dir,'payload/modules/000000');if(mode==='missing')await rm(payload);if(mode==='bytes')await writeFile(payload,Buffer.alloc(JSON.parse(sidecarRaw).modules[0].size,42));if(mode==='symlink'){await rm(payload);await writeFile(join(dir,'outside'),'private');await symlink(join(dir,'outside'),payload)}await assert.rejects(materializeArtifact(sidecarFile,join(dir,'out'),digest(sidecarRaw)),mode);await rm(dir,{recursive:true,force:true})}
  // With an exact target, the adapter migrates then deploys unbundled with no extra secrets; any failure stops before health.
  const p=policy(a),stageEnv=env({RUNNER_TEMP:root,H2H_STAGE_POLICY_JSON:JSON.stringify(p),EVIDENCE_WRITE_TOKEN:'test-store-token',NODE_OPTIONS:'--import=evil'}),calls=[]
  const invoke=(tool,args,cwd,childEnv)=>{assert.ok(tool.endsWith('/toolchain/node_modules/wrangler/bin/wrangler.js'));assert.equal(childEnv.EVIDENCE_WRITE_TOKEN,undefined);assert.equal(childEnv.NODE_OPTIONS,undefined);calls.push(args);return true}
  assert.equal((await deployStage({sha,artifact:file,env:stageEnv,invoke,checkHealth:async origin=>origin===p.origin})).result,'passed');assert.deepEqual(calls.map(c=>c[0]),['d1','deploy']);assert.ok(calls[1].includes('--no-bundle'))
  let checked=false;assert.equal((await deployStage({sha,artifact:file,env:stageEnv,invoke:()=>false,checkHealth:async()=>{checked=true}})).result,'migration-failed')
  let attempt=0;assert.equal((await deployStage({sha,artifact:file,env:stageEnv,invoke:()=>++attempt===1,checkHealth:async()=>{checked=true}})).result,'deploy-failed');assert.equal(checked,false)
  assert.equal((await deployStage({sha,artifact:file,env:stageEnv,invoke:()=>true,checkHealth:async()=>false})).result,'health-failed')
  for(const body of [{status:'ok'},{status:'ok',runtime:'native-rer',database:'reachable',files:'unreachable'}])assert.equal(await health('https://fixture.example',async()=>Response.json(body)),false)
  assert.equal(await health('https://fixture.example',async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302})}),false)
  // Failed verification or a skipped deploy is never a passed receipt; arbitrary payload never persists.
  const failed=makeReceipt(env({MODE:'stage',INPUT_PROOF:'',PREPARE_RESULT:'failure',JOB_RESULT:'skipped',EXECUTION_RESULT:'passed'}));assert.equal(failed.result,'failed');assert.equal(failed.failureStatus,'prepare-failed')
  assert.throws(()=>validateReceipt({...failed,token:'extra-data'}),/invalid-receipt-schema/);for(const override of [{EXECUTION_RESULT:'secret-content'},{GITHUB_RUN_ID:'../../escape'},{VALIDATED_SHA:'HEAD'},{MODE:'untrusted'}])assert.throws(()=>makeReceipt(env(override)))
  const forged={...failed,command:'pnpm run deploy'},before=git(store,['rev-parse','main'],{env:gitEnv}).text;assert.throws(()=>persistToGit(forged,transport));assert.equal(git(store,['rev-parse','main'],{env:gitEnv}).text,before)
  // The actual workflow step stops before packaging when verify fails.
  await mkdir(join(root,'bin'));await writeFile(join(root,'bin/pnpm'),'#!/bin/sh\nif [ "$*" = "run verify" ]; then exit 23; fi\nexit 0\n',{mode:0o755});await writeFile(join(root,'bin/node'),'#!/bin/sh\ntouch "$MARKER"\n',{mode:0o755})
  const yaml=await readFile('.github/workflows/deploy-stage.yml','utf8'),step=yaml.split('      - name: Verify then package native Worker\n')[1].split('        run: |\n')[1].split('      - uses:')[0].split('\n').filter(Boolean).map(line=>line.slice(10)).join('\n')
  const gated=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',step],{cwd:root,env:{PATH:`${join(root,'bin')}:${process.env.PATH}`,HOME:root,MARKER:join(root,'packaged')},encoding:'utf8'});assert.equal(gated.status,23);await assert.rejects(access(join(root,'packaged')))
  // Only exact commits on the integration branch or a release tag may be dispatched.
  const repo=join(root,'repo'),g=args=>git(repo,args,{env:gitEnv}).text;await mkdir(repo)
  g(['init','-b','main']);await writeFile(join(repo,'file'),'one');g(['add','.']);g(['commit','-m','initial']);const first=g(['rev-parse','HEAD']);await writeFile(join(repo,'file'),'two');g(['commit','-am','second']);const tip=g(['rev-parse','HEAD'])
  g(['checkout','-b','feature']);await writeFile(join(repo,'file'),'three');g(['commit','-am','feature']);const feature=g(['rev-parse','HEAD'])
  const args={cwd:repo,sha:first,dispatchSha:tip,dispatchRef:'refs/heads/main',event:'workflow_dispatch',repo:'just-every/run-happytohelp',mode:'stage',remote:repo,env:gitEnv};assert.equal(validateSource(args),first)
  for(const mutation of [{sha:feature},{sha:'HEAD'},{sha:tip+'\necho bad'},{repo:'octocat/Hello-World'},{event:'pull_request'},{dispatchRef:'refs/heads/feature'}])assert.throws(()=>validateSource({...args,...mutation}))
  g(['tag','v0.2.3-rc.1',feature]);assert.equal(validateSource({...args,sha:feature}),feature)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('a native owner whose mail provider has no key is told EMAIL_API_KEY by the real rer deploy: the dry run still completes offline and lists it, and a real deploy refuses before building',async()=>{
 const root=await scratch('h2h-native-mail-')
 try{
  // The real command and build, with every provider request refused and recorded.
  const network=join(root,'network.mjs'),calls=join(root,'requests.txt')
  await writeFile(calls,'');await writeFile(network,`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(calls)},'request\\n');throw Error('Deploy checks make no provider requests')}`)
  const inputs={OWNER_EMAIL:'owner@dry-run.example.com',MAIL_PROVIDER:'direct',EMAIL_PROVIDER:'resend',EMAIL_FROM:'Support <support@dry-run.example.test>',EMAIL_API_KEY:'',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:'',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(network).href}`].filter(Boolean).join(' ')}
  const dry=(await rer(process.cwd(),['deploy','--dry-run'],0,{env:inputs})).events.at(-1)
  assert.deepEqual([dry.ok,dry.dryRun,dry.deployed,dry.providerChecked],[true,true,false,false])
  assert.match(dry.neededForRealDeploy.join('\n'),/\bEMAIL_API_KEY\b/)
  const refused=(await rer(process.cwd(),['deploy'],3,{env:inputs})).events.find(event=>event.event==='error')
  assert.match(refused.message,/\bEMAIL_API_KEY\b/)
  assert.equal(await readFile(calls,'utf8'),'','neither door makes a provider request')
 }finally{await rm(root,{recursive:true,force:true})}
})
