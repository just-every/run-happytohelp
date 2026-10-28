import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,readdir,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {ownerWorkerName} from '@runeditrun/rer/internal/modules/deploy-kit/owner.mjs';

const execute=promisify(execFile);

/** Public package command, only fetch replaced; also runs in the fresh installed
 * checkout beside the unchanged zero-outbound dry-run segment. No registration. */
export async function providerPreflightJourney(root,scratch){
 const token='synthetic-happytohelp-'+randomBytes(8).toString('hex'),accountId='1'.repeat(32);
 const declaration=JSON.parse(await readFile(join(root,'deploy.json'),'utf8'));
 const worker=ownerWorkerName(declaration.project,'production');
 const paths=['/workers/subdomain','/workers/scripts/'+worker+'/settings','/workers/scripts/'+worker+'/secrets'];
 const expected=paths.map(path=>'https://api.cloudflare.com/client/v4/accounts/'+accountId+path);
 const network=join(scratch,'preflight-network.mjs'),calls=join(scratch,'preflight-requests.jsonl');
 await writeFile(network,`
import {appendFileSync} from 'node:fs';
const expected=${JSON.stringify(expected)};
globalThis.fetch=async(input,options={})=>{
 const url=String(input),headers=new Headers(options.headers);
 const entry={method:options.method,url,headers:[...headers.keys()],authenticated:headers.get('authorization')==='Bearer '+process.env.H2H_PREFLIGHT_FIXTURE_TOKEN,body:options.body!==undefined,redirect:options.redirect};
 appendFileSync(${JSON.stringify(calls)},JSON.stringify(entry)+'\\n');
 if(!expected.includes(url)||entry.method!=='GET'||entry.headers.join(',')!=='authorization'||!entry.authenticated||entry.body||entry.redirect!=='error')
  throw Error('Unexpected provider request at fixture edge');
 const reply=(result,status=200,errors=[])=>new Response(JSON.stringify({success:status===200,result,errors}),{status,headers:{'Content-Type':'application/json'}});
 const mode=process.env.H2H_PREFLIGHT_FIXTURE_MODE;
 if(mode==='forbidden')return reply(null,403,[{code:9109,message:'Scoped token refused '+process.env.CLOUDFLARE_API_TOKEN+' account '+process.env.CLOUDFLARE_ACCOUNT_ID}]);
 if(mode==='transport')throw Error('Fixture transport refused '+process.env.CLOUDFLARE_API_TOKEN);
 if(url===expected[0])return reply({subdomain:'synthetic-happytohelp'});
 if(url===expected[1]){
  if(mode==='not-found')return reply(null,404,[{code:10007,message:'Worker not found'}]);
  return reply({compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],bindings:[
   {name:'EMAIL_API_KEY',type:'secret_text',value:'synthetic-happytohelp-secret-value'},
   {name:'PRIVATE_SETTING',type:'plain_text',text:'synthetic-happytohelp-setting-value'}
  ],metadata:{private:'synthetic-happytohelp-metadata-value'}});
 }
 return reply([{name:'EMAIL_API_KEY',type:'secret_text',value:'synthetic-happytohelp-secret-value'},{name:'INTEGRATION_ENCRYPTION_KEY',type:'secret_text'}]);
};
`,{mode:0o600});
 const env={CLOUDFLARE_ACCOUNT_ID:accountId,CLOUDFLARE_API_TOKEN:token,H2H_PREFLIGHT_FIXTURE_TOKEN:token,H2H_PREFLIGHT_FIXTURE_MODE:'existing',
  // A leftover environment consent and another command's --yes confer no consent.
  H2H_PREFLIGHT_CONSENT:'yes',NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+pathToFileURL(network).href].filter(Boolean).join(' ')};
 const outputs=[];
 async function invoke(args,overrides={},code=0){
  await writeFile(calls,'');
  let result;
  try{result={code:0,...await execute('pnpm',['run','preflight',...args],{cwd:root,env:{...process.env,...env,...overrides},maxBuffer:1024*1024})};}
  catch(error){
   if(!Number.isInteger(error.code))throw Error('Preflight package command could not start');
   result={code:error.code,stdout:error.stdout,stderr:error.stderr};
  }
  const output=result.stdout+result.stderr;
  assert.ok(!output.includes(token),'preflight output must never contain the synthetic token');
  for(const value of ['synthetic-happytohelp-secret-value','synthetic-happytohelp-setting-value','synthetic-happytohelp-metadata-value'])
   assert.ok(!output.includes(value),'settings and secret values must never enter output');
  outputs.push(output);
  assert.equal(result.code,code,output);
  const requests=(await readFile(calls,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  for(const entry of requests)assert.deepEqual({...entry,url:undefined},{method:'GET',url:undefined,headers:['authorization'],authenticated:true,body:false,redirect:'error'});
  return {output,requests};
 }
 const help=await invoke(['--help'],{CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''});
 assert.deepEqual(help.requests,[],'help needs neither credentials nor consent and makes no request');
 const consent=['--consent-read-only'];
 const existing=await invoke(consent);
 assert.deepEqual(existing.requests.map(row=>row.url),expected,'only the three ownerDeploy GETs, no mail or other host');
 assert.match(existing.output,/synthetic-happytohelp\.workers\.dev/);
 assert.match(existing.output,/settings: compatibility date 2026-09-08; 2 bindings; 1 compatibility flags/);
 assert.match(existing.output,/Secret names: EMAIL_API_KEY, INTEGRATION_ENCRYPTION_KEY/);
 assert.match(existing.output,/3 GET requests attempted; no mail or resource changes/);
 console.log('Preflight existing Worker fixture recorded:\n'+existing.requests.map(row=>row.method+' '+row.url).join('\n'));
 const refusals=[
  {args:[],reason:/explicit --consent-read-only/},
  {args:['--yes'],reason:/--consent-read-only/},
  {args:consent,env:{CLOUDFLARE_API_TOKEN:''},reason:/needs CLOUDFLARE_API_TOKEN/},
  {args:consent,env:{CLOUDFLARE_ACCOUNT_ID:''},reason:/needs CLOUDFLARE_ACCOUNT_ID/},
  {args:consent,env:{CLOUDFLARE_API_TOKEN:'invalid token'},reason:/valid CLOUDFLARE_API_TOKEN shape/},
  {args:consent,env:{CLOUDFLARE_ACCOUNT_ID:'synthetic-happytohelp-account'},reason:/valid CLOUDFLARE_ACCOUNT_ID shape/},
  ...['POST','PUT','PATCH','DELETE'].map(verb=>({args:[...consent,verb],reason:/accepts no write verbs/})),
  {args:[...consent,'--method','POST'],reason:/accepts no write verbs/},
  {args:[...consent,'--set-secret','EMAIL_API_KEY'],reason:/accepts no write verbs/},
  {args:[...consent,'--token','not-a-credential'],reason:/credential arguments/},
 ];
 for(const refusal of refusals){
  const result=await invoke(refusal.args,refusal.env,1);
  assert.match(result.output,refusal.reason);assert.deepEqual(result.requests,[],'refusal makes zero requests');
 }
 const missing=await invoke(consent,{H2H_PREFLIGHT_FIXTURE_MODE:'not-found'});
 assert.deepEqual(missing.requests.map(row=>row.url),expected.slice(0,2));
 assert.match(missing.output,/not deployed \(HTTP 404\)/);assert.match(missing.output,/2 GET requests attempted/);
 assert.doesNotMatch(missing.output,/Secret names:/);
 const forbidden=await invoke(consent,{H2H_PREFLIGHT_FIXTURE_MODE:'forbidden'},1);
 assert.deepEqual(forbidden.requests.map(row=>row.url),expected.slice(0,1));
 assert.match(forbidden.output,/HTTP 403.*9109 Scoped token refused \[REDACTED\] account \[REDACTED\]/);
 assert.match(forbidden.output,/No retry was made/);
 const transport=await invoke(consent,{H2H_PREFLIGHT_FIXTURE_MODE:'transport'},1);
 assert.deepEqual(transport.requests.map(row=>row.url),expected.slice(0,1),'transport failure is not retried either');
 assert.match(transport.output,/no HTTP status/);
 // The same private reader as deploy: file wins over invalid environment; no
 // token argument, and permissive files must refuse before any request.
 const file=join(scratch,'preflight-private.env');
 try{
  await writeFile(file,'CLOUDFLARE_API_TOKEN='+token+'\nCLOUDFLARE_ACCOUNT_ID='+accountId+'\n',{mode:0o600});
  const fromFile=await invoke([...consent,'--env-file',file],{CLOUDFLARE_API_TOKEN:'invalid',CLOUDFLARE_ACCOUNT_ID:'invalid'});
  assert.deepEqual(fromFile.requests.map(row=>row.url),expected);
  await chmod(file,0o644);
  const unsafe=await invoke([...consent,'--env-file',file],{},1);
  assert.match(unsafe.output,/owned 0600/);assert.deepEqual(unsafe.requests,[]);
 }finally{await rm(file,{force:true});}
 async function noTokenFiles(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(['.git','node_modules'].includes(entry.name)||entry.isSymbolicLink())continue;
   const path=join(directory,entry.name);
   if(entry.isDirectory())await noTokenFiles(path);
   else if(entry.isFile())assert.ok(!(await readFile(path)).includes(Buffer.from(token)),'synthetic token must not be persisted in '+entry.name);
  }
 }
 await noTokenFiles(root);if(!scratch.startsWith(root+'/'))await noTokenFiles(scratch);
 assert.ok(outputs.every(output=>!output.includes(token)));
 console.log('Preflight fixture: existing=3 GETs; missing Worker=2 GETs; 403=1 GET; transport=1 GET; input/consent/write refusals=0; bearer header only; no mail, mutations, settings values or persisted token.');
}
