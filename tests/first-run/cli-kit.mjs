import { fileURLToPath as __rerTestEntryPath } from 'node:url';
const __rerTestEntry = __rerTestEntryPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));
const __rerTestEntryArgs = args => args[1] === 'dev' && !args.some(arg => ['--foreground', '--detach', '--stop', '--help'].includes(arg)) ? [...args, '--foreground'] : args;
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {waitForServingCapacity} from '../helpers/serving-capacity.mjs';
import {commandEnvironment,stopOwnedServer} from '../helpers/rer-command.mjs';
export function processRun(root,command,args,env){
 // A fresh checkout owns its operation; it cannot inherit another checkout's lock.
 const child=spawn(command,args,{cwd:root,env:commandEnvironment(env),stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 const done=once(child,'close').then(([code,signal])=>({code,signal,output}));
 return {child,done,get output(){return output}};
}
export async function command(root,args,env,expected=0){
 const result=await processRun(root,process.execPath,__rerTestEntryArgs([__rerTestEntry,...args]),env).done;
 if(result.code!==expected){const directory=env.H2H_EVIDENCE_DIR||join(root,'test-results/base-command');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'failed-'+args[0]+'.log'),result.output,{mode:0o600});}
 assert.equal(result.code,expected,`rer ${args[0]} exits ${expected}; private diagnostics are in the checkout capture`);
 return result.output;
}
export async function serve(root,env){
 await waitForServingCapacity(env);
 const running=processRun(root,process.execPath,__rerTestEntryArgs([__rerTestEntry,'dev','--non-interactive']),{...env,RER_SERVER_JOURNEY:'1'});
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  const ready=running.output.match(/^RER_READY (http:\/\/\S+)$/m);
  if(ready)return {origin:ready[1],...running,async close(){await stopOwnedServer(running.child,env);assert.equal((await running.done).code,0)}};
  if(running.child.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 running.child.kill('SIGTERM');const result=await running.done;
 const directory=env.H2H_EVIDENCE_DIR||join(root,'test-results/base-command');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'failed-dev.log'),result.output,{mode:0o600});
 throw Error('CLI dev did not announce healthy readiness; private diagnostics are in the checkout capture');
}
