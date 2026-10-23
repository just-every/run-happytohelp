import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {processRun,command,serve} from '../../first-run/cli-kit.mjs';
import {signIn,beforeHydration} from '../../first-run/cli-sign-in.mjs';
import {freePort,post} from '../../first-run/browser-kit.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';
import {seedPortableData,verifyPortableData} from '../rer-data.mjs';
import {interruptPortableTraining} from '../training-portable.mjs';
import {interruptPortableWork,verifyPortableWork} from '../unfinished-portable.mjs';
import {seedReportClaimedRecovery} from '../reports-portable.mjs';

// The README clone-and-restore journey: setup twice, owner entry at 1440/390, D1/R2/Durable Object round trip into a fresh clone, reset.
export async function readmeRestoreJourney(){
const source=resolve(import.meta.dirname,'../../..'),directory=await mkdtemp(join(tmpdir(),'h2h-cli-journey-'));
const evidence=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/base-command');await mkdir(evidence,{recursive:true});
const env={...process.env,CI:'true',H2H_EVIDENCE_DIR:evidence,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',RER_SERVERS_DIR:join(directory,'servers'),RER_SERVER_JOURNEY:'1'};
let browser,runtime;
const receipt={widths:[],commands:[],roundTrip:false};
async function fresh(name){
 const root=join(directory,name);
 // A candidate checkout may be a partial clone. Take its complete current
 // source tree without asking its upload-pack to fetch unrelated old blobs.
 const cloned=await processRun(directory,'git',['clone','--quiet','--no-local','--depth','1',source,root],env).done;
 if(cloned.code!==0)await writeFile(join(evidence,'failed-clone.log'),cloned.output,{mode:0o600});
 assert.equal(cloned.code,0,'fresh clone acquires the candidate source');await command(root,['check','--profile','first-party'],env);
 const installed=await processRun(root,'pnpm',['install','--frozen-lockfile'],env).done;
 if(installed.code!==0)await writeFile(join(evidence,'failed-install.log'),installed.output,{mode:0o600});
 assert.equal(installed.code,0,'fresh clone installs its own frozen dependencies');return root;
}
try{
 const root=await fresh('source'),port=await freePort(),origin=`http://127.0.0.1:${port}`,password=randomBytes(24).toString('base64url');
 await mkdir(join(root,'.seed'),{mode:0o700,recursive:true});const answer={WORKSPACE_NAME:'CLI support',WIDGET_ORIGIN:origin,PRIMARY_COLOR:'#7c3aed',OWNER_NAME:'CLI owner',OWNER_EMAIL:'owner@example.test',OWNER_PASSWORD:password,EMAIL_PROVIDER:'later'};
 await writeFile(join(root,'.seed/local-answers.json'),JSON.stringify(answer),{mode:0o600});
 await command(root,['setup','--answers','.seed/local-answers.json','--port',String(port),'--non-interactive'],env);receipt.commands.push('setup');
 const saved=await readFile(join(root,'.dev.vars'));assert.equal((await stat(join(root,'.dev.vars'))).mode&0o777,0o600);
 await command(root,['setup','--non-interactive'],env);assert.ok(saved.equals(await readFile(join(root,'.dev.vars'))),'second setup preserves exact private bytes');receipt.commands.push('setup again');
 runtime=await serve(root,env);assert.equal(runtime.origin,origin);browser=await launchBrowser();
 await beforeHydration({browser,origin,email:answer.OWNER_EMAIL,password});receipt.preHydration=true;
 for(const width of [1440,390]){await signIn({browser,origin,openUrl:await readFile(join(root,'.rer/local/open-url'),'utf8'),width,evidence});receipt.widths.push(width);}
 const logged=await post(origin,'/api/identity/login',{email:answer.OWNER_EMAIL,password});
 const project=await (await fetch(origin+'/api/identity/projects/'+logged.actor.projectId,{headers:{Authorization:'Bearer '+logged.token}})).json();
 // Native Connections must work with the generated local encryption key.
 // Configuration and scoped API calls stay local; this subscription receives no events here.
 const connections=`/api/management/projects/${project.id}/connections`;
 const grant=await post(origin,connections+'/tokens',{name:'Archive scope',scopes:['contacts:read']},logged.token);
 assert.equal((await fetch(origin+'/api/v1/contacts',{headers:{Authorization:'Bearer '+grant.token}})).status,200);
 const destination=await post(origin,connections+'/webhooks',{name:'Archive receiver',url:'https://receiver.example.com/archive',events:['conversation.rated']},logged.token);
 const visitor=await post(origin,'/api/identity/widget/session',{widgetKey:project.widget_key,name:'Archive visitor',email:'visitor@example.test'});
 const conversation=await post(origin,'/api/conversations',{projectId:project.id},visitor.token);
 await post(origin,`/api/conversations/${conversation.id}/messages`,{localId:randomUUID(),content:'Retained conversation',expectedRevision:0},visitor.token);
 const bytes=Buffer.from('Real FILES attachment for archive round trip');
 const uploaded=await fetch(origin+`/api/conversations/${conversation.id}/media`,{method:'POST',headers:{Authorization:'Bearer '+logged.token,Origin:origin,'X-Filename':'proof.txt','Content-Type':'text/plain'},body:bytes});assert.equal(uploaded.status,201);const media=await uploaded.json();
 const json=async(path,body,token)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,`Native ${path} returned HTTP ${response.status}`);return response.json()};
 const portable=await seedPortableData(origin,project.id,logged.token,json);
 await command(root,['reset','--yes','--non-interactive'],env,4);await runtime.close();runtime=null;
 await seedReportClaimedRecovery(root,portable.reports);await interruptPortableTraining(root,portable.training);await interruptPortableWork(root,portable,logged.actor.id);
 await command(root,['export','--output','exports/support.jsonl','--non-interactive'],env);const records=(await readFile(join(root,'exports/support.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!JSON.stringify(records).includes(password),'entered private password is not archived');assert.ok(!JSON.stringify(records).includes(grant.token)&&!JSON.stringify(records).includes(destination.secret),'external grants and receiver credentials are not archived');
 const retainedArchive=join(directory,'support.jsonl');await copyFile(join(root,'exports/support.jsonl'),retainedArchive);await rm(root,{recursive:true,force:true});
 await assert.rejects(stat(root),{code:'ENOENT'},'the disposable source and its native state are destroyed before restore');
 const target=await fresh('restored');await mkdir(join(target,'exports'));await copyFile(retainedArchive,join(target,'exports/support.jsonl'));
 await command(target,['import','--input','exports/support.jsonl','--non-interactive'],env,4);
 await command(target,['import','--input','exports/support.jsonl','--yes','--non-interactive'],env);
 await command(target,['export','--output','exports/restored.jsonl','--non-interactive'],env);
 const restored=(await readFile(join(target,'exports/restored.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(restored.at(-1).contentHash,records.at(-1).contentHash,'complete D1 and R2 round trip retains semantic content');
 await verifyPortableWork(target,portable);
 await mkdir(join(target,'.seed'),{mode:0o700,recursive:true});await writeFile(join(target,'.seed/local-answers.json'),JSON.stringify(answer),{mode:0o600});
 await command(target,['setup','--answers','.seed/local-answers.json','--port',String(port),'--non-interactive'],env);runtime=await serve(target,env);
 const retained=await post(origin,'/api/identity/login',{email:answer.OWNER_EMAIL,password,projectId:project.id});assert.equal(retained.actor.id,logged.actor.id,'restored native owner identity is preserved');assert.equal(retained.actor.projectId,project.id,'the owner selects the restored support workspace');
 await verifyPortableData(origin,portable,retained.token,json);
 assert.equal((await fetch(origin+'/api/v1/contacts',{headers:{Authorization:'Bearer '+grant.token}})).status,401,'restored install rejects old API grant');
 const configured=await (await fetch(origin+connections+'/webhooks',{headers:{Authorization:'Bearer '+retained.token}})).json();assert.deepEqual(configured.data,[],'restored install requires receiver reconfiguration');
 const attachment=await fetch(origin+`/api/conversations/${conversation.id}/media/${media.id}`,{headers:{Authorization:'Bearer '+retained.token}});assert.equal(attachment.status,200);assert.ok(Buffer.from(await attachment.arrayBuffer()).equals(bytes));
 await runtime.close();runtime=null;await command(target,['reset','--non-interactive'],env,4);await command(target,['reset','--yes','--non-interactive'],env);
 assert.ok(await stat(join(target,'exports/support.jsonl')),'reset preserves owner archives');await command(target,['setup','--answers','.seed/local-answers.json','--port',String(port),'--non-interactive'],env);
 receipt.roundTrip=true;receipt.reset=true;receipt.commands.push('dev','export','import into fresh clone','export comparison','confirmed reset','fresh setup');
 await writeFile(join(evidence,'cli-proof.json'),JSON.stringify(receipt,null,2)+'\n');console.log('CLI README journey passed: setup twice, automatic owner entry at 1440/390, private settings, D1/R2 round trip, active-state refusal and confirmed reset.');
}finally{await runtime?.close();await browser?.close();await rm(directory,{recursive:true,force:true});}

}
