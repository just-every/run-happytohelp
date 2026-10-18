import { fileURLToPath as __rerTestEntryPath } from 'node:url';
const __rerTestEntry = __rerTestEntryPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));
const __rerTestEntryArgs = args => args[1] === 'dev' && !args.some(arg => ['--foreground', '--detach', '--stop', '--help'].includes(arg)) ? [...args, '--foreground'] : args;
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';

// Cleanup must address only the server PID this journey started. Avoid the
// CLI stop command, whose registry sweep can recover unrelated checkouts.
export async function stopOwnedServer(child,env=process.env){
 const directory=env.RER_SERVERS_DIR??join(homedir(),'.rer/servers');
 const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 const record=state.running.find(record=>record.owner.pid===child.pid);
 if(!record)throw Error('Journey server PID has no owned control socket');
 await new Promise((resolve,reject)=>{
  const socket=createConnection(record.control);let reply='';
  socket.setTimeout(35000,()=>socket.destroy(Error('Owned server cleanup timed out')));
  socket.on('connect',()=>socket.end(JSON.stringify({token:record.token,action:'stop'})));
  socket.on('data',chunk=>{reply+=chunk;if(reply.length>16384)socket.destroy(Error('Invalid owned server reply'));});
  socket.on('end',()=>{try{if(JSON.parse(reply).token!==record.token)throw Error('Unverified owned server');resolve();}catch(error){reject(error);}});
  socket.on('error',reject);
 });
}

export function commandEnvironment(input=process.env){
 const env={...input,CI:'true',WRANGLER_SEND_METRICS:'false',RER_SERVER_JOURNEY:'1'};
 delete env.RER_LOCAL_OPERATION;
 delete env.RER_ONBOARDING_PROCESS_OWNER;
 return env;
}

export function command(root,args,{timeout=1200000,env={}}={}){
 const child=spawn(process.execPath,__rerTestEntryArgs([__rerTestEntry,...args,'--non-interactive','--json']),{
  cwd:root,env:commandEnvironment({...process.env,...env}),detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],
 });
 let output='',exited=false;
 child.stdout.on('data',chunk=>{output+=chunk;});
 child.stderr.resume(); // Rer owns private, redacted diagnostics; never print captures.
 const completion=once(child,'exit').then(([code,signal])=>{exited=true;return {code,signal};});
 const events=()=>output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 const failure=message=>{
  const event=events().find(event=>event.event==='error');
  const code=/^[a-z_]+$/.test(event?.code??'')?event.code:'unknown';
  const detail=event?.message??'';
  const reason=detail.includes('machine load')?'machine load':detail.includes('15 GiB')?'disk space':detail.includes('Server limit')?'server capacity':detail.includes('active local operation')?'active operation':'see private capture';
  return Error(`Rer ${args[0]} ${message}; ${code}, ${reason}`);
 };
 async function stop(){
  if(!exited){child.kill('SIGTERM');let timer;try{await Promise.race([completion,new Promise(resolve=>{timer=setTimeout(resolve,30000);})]);}finally{clearTimeout(timer);}}
  if(!exited){process.kill(-child.pid,'SIGKILL');await completion;throw Error('Rer did not finish owned cleanup');}
 }
 async function waitFor(predicate,limit=timeout){
  const until=Date.now()+limit;
  while(Date.now()<until){
   const found=events().find(predicate);if(found)return found;
   if(exited)throw failure(`exited ${child.exitCode} before the required event`);
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  await stop();throw failure('exceeded its deadline');
 }
 async function result(){
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
  try{const status=await completion;return {...status,events:events()};}finally{clearTimeout(timer);}
 }
 return {child,events,waitFor,result,stop};
}

export async function run(root,args,expected=0,options={}){
 const process=command(root,args,options);
 try{
  const result=await process.result();
  if(result.code!==expected)throw Error(`Rer ${args[0]} exited ${result.code}; expected ${expected}`);
  return result;
 }finally{await process.stop();}
}
