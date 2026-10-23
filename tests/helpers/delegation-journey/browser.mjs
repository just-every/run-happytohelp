import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {launchBrowser} from '../../journeys/kit/browser.mjs';
import {command,run,stopOwnedServer} from '../rer-command.mjs';
import {waitForServingCapacity} from '../serving-capacity.mjs';
import {customerFixture} from './fixture.mjs';
import {report,client,runCase,until} from './case.mjs';
import {browserUI} from './browser-ui.mjs';
import {failureDiagnostics} from './diagnostics.mjs';

export async function browserJourney(evidence){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-agent-fix-rer-')),checkout=join(scratch,'checkout');
 const fixture=await customerFixture();let server,browser;const captions=[],checks=[];
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const origin=`http://127.0.0.1:${port}`,email='agent-fix@example.test',password=randomBytes(24).toString('base64url');
 let success=false,stage='clone',freshInstalledRer=false,automaticOwnerEntry=false;
 try{
  await promisify(execFile)('git',['clone','--quiet','--no-local','--depth','1',resolve('.'),checkout]);
  stage='install';await run(checkout,['install']);freshInstalledRer=true;
  await mkdir(join(checkout,'.seed'),{mode:0o700,recursive:true});
  await writeFile(join(checkout,'.seed/local-answers.json'),JSON.stringify({WORKSPACE_NAME:'Agent fix journey',WIDGET_ORIGIN:origin,OWNER_NAME:'Journey owner',OWNER_PASSWORD:password,EMAIL_PROVIDER:'later'}),{mode:0o600});
  stage='setup';await run(checkout,['setup','--owner-email',email,'--answers','.seed/local-answers.json','--port',String(port)]);
  await assert.rejects(fetch(origin+'/health',{signal:AbortSignal.timeout(2000)}),'setup leaves no server');
  stage='dev';await waitForServingCapacity();server=command(checkout,['dev']);const ready=await server.waitFor(event=>event.event==='ready',180000);assert.equal(ready.url,origin);
  stage='automatic owner entry';
  browser=await launchBrowser();
  const loginContext=await browser.newContext(),loginPage=await loginContext.newPage();
  const {readFile}=await import('node:fs/promises');
  await loginPage.goto((await readFile(join(checkout,'.rer/local/open-url'),'utf8')).trim());
  await loginPage.waitForURL(/\/projects\/[^/]+\/activation$/);
  const session=await loginContext.request.get(origin+'/api/identity/session');assert.equal(session.status(),200);const actor=await session.json();assert.equal(actor.role,'owner');automaticOwnerEntry=true;
  const state=await loginContext.storageState();await loginContext.close();
  for(const width of [1440,390]){
   stage=`operator and visitor journey ${width}`;
   const viewport={width,height:width===390?844:1000},context=await browser.newContext({viewport,storageState:state}),page=await context.newPage();
   const cookie=(await context.cookies()).find(c=>c.name==='h2h_session');assert.ok(cookie);
   // Use the stranger's complete owner-entry cookie jar, including checkout
   // admission. A copied dev bearer token must remain insufficient by itself.
   const api=async(path,body,{method=body===undefined?'GET':'POST',status=200}={})=>{
    const response=await context.request.fetch(origin+path,{method,headers:{Origin:origin},...(body===undefined?{}:{data:body})});
    const value=await response.json();assert.equal(response.status(),status,`${method} ${path}: ${JSON.stringify(value)}`);return value;
   };
   const project=await api('/api/identity/projects/'+actor.projectId);const errors=[];page.on('pageerror',error=>errors.push(error.message));
   // The visitor reports before the owner opens the dashboard; this team answers without it, so presence-based away is off.
   await api(`/api/management/projects/${actor.projectId}/availability`,{is_presence_away_enabled:false},{method:'PUT'});
   const directory=join(scratch,String(width));await mkdir(directory);
   let visitorContext,visitor,visitorSession;const frames=[];
   const ui=browserUI({page,context,origin,actor,api,width,evidence,captions});
   ui.visitor=async()=>{
    visitorContext=await browser.newContext({viewport});visitor=await visitorContext.newPage();visitor.on('pageerror',error=>errors.push(error.message));
    visitor.on('websocket',socket=>socket.on('framereceived',event=>{try{frames.push(JSON.parse(event.payload))}catch{}}));
    const mount=async()=>{await visitor.addScriptTag({url:origin+'/widget.js'});await visitor.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}})};
    await visitor.goto(origin+'/help/'+actor.projectId);await mount();
    await visitor.locator('textarea[name=content]').fill(report);await visitor.locator('button[name=submit]').click();
    visitorSession=await until(()=>visitor.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),`rer-widget:${origin}:${project.widget_key}`),s=>s?.conversationId,'widget session');
    const transcript=()=>client(origin,visitorSession.token)('/api/conversations/'+visitorSession.conversationId+'/messages');
    ui.visitorPage=visitor;
    ui.received=async(body,messageId)=>{
     await visitor.getByText(body,{exact:true}).waitFor();await until(()=>Promise.resolve(frames.filter(f=>f.message?.id===messageId)),messages=>messages.length===1,'one visitor socket delivery');
     assert.equal(await visitor.getByText(body,{exact:true}).count(),1);assert.equal(frames.filter(f=>f.message?.id===messageId).length,1);
     await visitor.reload();await mount();await visitor.getByText(body,{exact:true}).waitFor();assert.equal(await visitor.getByText(body,{exact:true}).count(),1);
    };
    const say=async content=>{
     const submitted=visitor.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/api/conversations/${visitorSession.conversationId}/messages`);
     await visitor.locator('textarea[name=content]').fill(content);await visitor.locator('button[name=submit]').click();
     const response=await submitted;assert.equal(response.status(),200);return response.json();
    };
    return {session:visitorSession,transcript,say,close:()=>visitorContext.close()};
   };
   try{checks.push({width,...await runCase({origin,api,actor,fixture,directory,ui})});assert.deepEqual(errors,[])}finally{await visitorContext?.close();await context.close()}
  }
  success=true;console.log('Fresh rer install/setup/dev owner-entry agent-fix browser journey passed at 1440 and 390 with operator and widget screenshots for all seven steps.');
 }catch(error){
  await failureDiagnostics({evidence,stage,error,server,scratch,secrets:[password]});throw error;
 }finally{
  const cleanup=await Promise.allSettled([browser?.close(),fixture.close(),(async()=>{if(server){try{await stopOwnedServer(server.child)}finally{await server.stop()}}})()]);
  const cleanupFailed=cleanup.some(result=>result.status==='rejected');
  await writeFile(join(evidence,'browser-result.json'),JSON.stringify({success:success&&!cleanupFailed,stage,cleanupSucceeded:!cleanupFailed,layer:'LOCAL TEST',provider:'scripted Codex CLI boundary',liveProvider:false,customerSystem:'loopback fixture only',freshInstalledRer,automaticOwnerEntry,checks},null,2));
  await writeFile(join(evidence,'SCREENSHOTS.md'),captions.join('\n')+'\n');
  if(success&&!cleanupFailed)await rm(scratch,{recursive:true,force:true});
  if(cleanupFailed)throw Error('Journey process cleanup failed; private scratch retained for inspection');
 }
}
