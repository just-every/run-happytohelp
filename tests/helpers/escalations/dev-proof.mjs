import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readSettings} from '@runeditrun/rer/adapter-settings';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startProviders} from './providers.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';
import {exerciseEscalations} from './browser.mjs';
const directory=resolve('../evidence');await mkdir(directory,{recursive:true});await mkdir('.rer',{recursive:true});
const providers=await startProviders(),browser=await launchBrowser();let child,completion,logs='';
try{
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 child=spawn('pnpm',['exec','rer','dev','--foreground','--port',String(port)],{cwd:process.cwd(),env:{...process.env,RER_SERVERS_DISK_FLOOR_GIB:'4'},detached:true,stdio:['ignore','pipe','pipe']});
 completion=once(child,'exit');
 child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 let entryUrl;const until=Date.now()+240000;while(Date.now()<until){const m=logs.match(/RER_OPEN\s+(\S+)/);if(m){entryUrl=m[1];break}if(child.exitCode!==null)throw Error('rer dev exited '+child.exitCode);await new Promise(r=>setTimeout(r,500))}
 if(!entryUrl)throw Error('rer dev did not become ready');
 const password=(await readSettings(process.cwd(),{file:'.dev.vars'})).values.OWNER_PASSWORD;if(!password)throw Error('This local install has no native password for credential step-up');
 const widths=process.argv.length>2?process.argv.slice(2).map(Number):[1440,390];if(widths.some(w=>![1440,390].includes(w)))throw Error('Use viewport 1440 or 390');
 for(const width of widths){const proof=await exerciseEscalations({browser,origin:new URL(entryUrl).origin,entryUrl,providers,width,directory,password});await writeFile('.rer/escalation-proof-ids.json',JSON.stringify({projectId:proof.projectId,tickets:proof.records.map(r=>r.ticket.id),ticketState:(await proof.req(`/api/escalations/projects/${proof.projectId}/conversations/${proof.records[0].ticket.id}`)).data}),{mode:0o600});await proof.context.close()}
 console.log('RER dev escalation journey passed at '+widths.join(' and '));
}catch(e){await writeFile('.rer/escalation-dev-private.log',logs,{mode:0o600});throw e}finally{await browser.close();await providers.close();if(child?.pid&&child.exitCode===null){process.kill(-child.pid,'SIGTERM');let timer;try{await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}reject(Error('Owned dev server did not stop cleanly'))},30000)})])}finally{clearTimeout(timer)}}}
