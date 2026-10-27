import {runSteps} from './kit/steps.mjs';
import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {chmod,mkdir,mkdtemp,realpath,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'

// The copied setup command from Local computers, run as a person would paste it:
// it downloads the packaged connector from this app, pairs, and starts the worker.
let runtime,browser,scratch,success=true
before(async()=>{runtime=await createRuntime();browser=await launchBrowser();scratch=await mkdtemp(join(await realpath(tmpdir()),'h2h-connector-setup-'))})
after(async()=>{await browser?.close();await runtime?.close(success);if(scratch)await rm(scratch,{recursive:true,force:true})})

async function terminal(name){
 const home=join(scratch,name),bin=join(home,'bin');await mkdir(bin,{recursive:true})
 const target=resolve('tests/provider-helpers/codex.mjs');await chmod(target,0o755);await symlink(target,join(bin,'codex'))
 await writeFile(join(home,'scenario.json'),'{}')
 return {home,env:{PATH:bin+':'+process.env.PATH,HOME:home,TMPDIR:process.env.TMPDIR,H2H_PROVIDER_SCENARIO:join(home,'scenario.json')}}
}
const stop=async child=>{if(child.exitCode!==null)return;try{process.kill(-child.pid,'SIGTERM')}catch{}await new Promise(done=>{child.once('exit',done);setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},3000).unref()})}

test(`at 1440 and 390px the copied setup command installs the packaged connector, pairs with a literal computer name, and completes only for its own pairing`,async()=>runSteps(Object.entries(viewports).map(([label,viewport])=>[`${viewport.width}px`,async()=>{
 const shot=await evidence('connector-setup'),tenant=await runtime.seedTenant({name:'Setup '+label,email:`setup-${label}@connector.test`,allowedOrigin:runtime.origin})
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],children=[];let output=''
 page.on('pageerror',error=>errors.push(error.message))
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:runtime.origin}])
  // Another computer already listening must not satisfy this setup.
  const otherCode=(await (await context.request.post(runtime.origin+`/api/projects/${tenant.projectId}/local-agents/pairings`,{data:{}})).json()).data.code
  const other=await terminal(label+'-other')
  const otherWorker=spawn(process.execPath,[resolve('local-agent/bin/h2h-local.mjs'),'start','--server',runtime.origin,'--code',otherCode,'--provider','codex','--name','Existing computer','--workdir',other.home],{env:{...other.env,H2H_LOCAL_CONFIG:join(other.home,'existing.json')},detached:true,stdio:'ignore'});children.push(otherWorker)
  const devices=async()=>(await (await context.request.get(runtime.origin+`/api/projects/${tenant.projectId}/local-agents`)).json()).data
  const deadline=Date.now()+20000;while(!(await devices()).some(device=>device.name==='Existing computer'&&device.worker_ready)){assert.ok(Date.now()<deadline,'existing worker ready');await new Promise(done=>setTimeout(done,200))}
  await page.goto(`${runtime.origin}/projects/${tenant.projectId}/local-agent`)
  await page.getByRole('button',{name:'Connect computer'}).click();const dialog=page.locator('.delegation-setup-modal');await dialog.waitFor()
  const name="Desk's `uname` $(id) ; echo dangerous"
  // With a computer already connected, the dialog offers its restart first; connecting another one asks for a new code.
  await dialog.getByRole('button',{name:'Connect another computer'}).click()
  await dialog.getByRole('button',{name:/Codex/}).click();await dialog.getByLabel('Computer name').fill(name)
  await dialog.getByText('Show command').click()
  const command=await dialog.locator('pre').first().innerText()
  execFileSync('bash',['-n'],{input:command});assert.match(command,/\/downloads\/happytohelp-local-agent\.tar\.gz/);assert.match(command,/--provider codex/);assert.doesNotMatch(command,/ANTHROPIC|mcp add|npm install/)
  await page.screenshot({path:shot(label+'-setup-command.png'),fullPage:true})
  await dialog.getByText('Waiting for the worker to start and confirm readiness.').waitFor()
  const fresh=await terminal(label+'-fresh'),setup=spawn('bash',['-c',command],{env:fresh.env,detached:true,stdio:['ignore','pipe','pipe']});children.push(setup);setup.stdout.on('data',b=>output+=b);setup.stderr.on('data',b=>output+=b)
  // The person checks again until this computer reports ready; another ready computer never completes it.
  const readyText=dialog.getByText(`${name} is ready for new work.`),until=Date.now()+45000
  while(!await readyText.isVisible()){assert.ok(Date.now()<until,'setup did not complete:\n'+output);const again=dialog.getByRole('button',{name:'Check again'});if(await again.isVisible())await again.click();await page.waitForTimeout(1000)}
  const paired=(await devices()).filter(device=>device.name===name);assert.equal(paired.length,1,'the shell passed the computer name through literally');assert.equal(paired[0].worker_ready,true)
  assert.match(output,/Ready/);assert.doesNotMatch(output,/dangerous\n/,'no part of the name ran as a command')
  await page.screenshot({path:shot(label+'-ready.png'),fullPage:true})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll')
  assert.deepEqual(errors,[])
 }catch(error){success=false;await page.screenshot({path:shot(label+'-failure.png'),fullPage:true}).catch(()=>{});throw error}finally{for(const child of children)await stop(child);await context.close()}
}])))
