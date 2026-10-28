import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,symlink,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export async function connector({origin,directory,code}){
 await mkdir(directory,{recursive:true});const bin=join(directory,'bin');await mkdir(bin);
 const boundary=resolve('tests/helpers/delegation-journey/provider.mjs');await chmod(boundary,0o755);await symlink(boundary,join(bin,'codex'));
 const configPath=join(directory,'connector.json'),children=new Set();let logs='';
 const env={PATH:bin+':'+process.env.PATH,HOME:directory,TMPDIR:process.env.TMPDIR,H2H_LOCAL_CONFIG:configPath};
 const start=args=>{
  const child=spawn(process.execPath,[resolve('local-agent/bin/h2h-local.mjs'),...args],{cwd:directory,env,detached:true,stdio:['ignore','pipe','pipe']});children.add(child);
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{children.delete(child);resolve(code)})});return {child,done};
 };
 const connected=start(['connect','--server',origin,'--code',code,'--provider','codex','--name','Journey computer','--workdir',directory]);
 assert.equal(await connected.done,0,'real connector pairs: '+logs);
 const config=JSON.parse(await readFile(configPath));
 return {deviceId:config.device.id,token:config.token,directory,
  async run(task,{background=false,expected=0}={}){await writeFile(join(directory,'task.json'),JSON.stringify(task));const execution=start(['run','--once']);if(background)return execution;assert.equal(await execution.done,expected,'real connector run: '+logs);return expected===0?JSON.parse(await readFile(join(directory,'provider-receipt.json'),'utf8').catch(()=>'null')):null},
  async close(){for(const child of children){try{process.kill(-child.pid,'SIGTERM')}catch{}await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},3000).unref()})}await writeFile(join(directory,'connector.log'),logs)}
 };
}
