import {historyBrowserFlow} from './history-browser.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {packageFixture} from './fixture.mjs'
export async function legacyPackageBrowserFlow({page,runtime,project,inspect,width=1440}){
 const directory=await mkdtemp(join(tmpdir(),'legacy-browser-')),puts=[]
 const record=req=>{if(req.method()==='PUT'&&req.url().includes('/legacy-import/'))puts.push(new URL(req.url()).pathname)};page.on('request',record)
 const shot=name=>inspect(`legacy-${name}-${width}`)
 try{
  await page.setViewportSize({width,height:1000})
  await page.goto(runtime.origin+'/app/move-in');await page.waitForURL(`**/projects/${project}/move-in?legacy=1`)
  await page.getByRole('heading',{name:'HappyToHelp export',exact:true}).waitFor()
  const good=await packageFixture(join(directory,'good'),'synthetic-browser-'+project,{large:true,staff:[{id:'synthetic-browser-staff',name:'Retired billing manager',email:'synthetic-browser-staff@example.test',created_at:1},{id:'synthetic-browser-admin',name:'Historical support lead',email:'synthetic-browser-admin@example.test',created_at:1}]})
  // Actual directory selection, then a changed local part is refused before acceptance.
  const first=good.manifest.chunks[0],original=await readFile(join(good.root,first.file));await writeFile(join(good.root,first.file),Buffer.alloc(original.length,32))
  await page.getByLabel('Export folder',{exact:true}).setInputFiles(good.root);await page.getByText('AI usage history omitted: 1 rows.',{exact:false}).waitFor();await page.getByText(`Review file inventory (${good.manifest.chunks.length+good.manifest.context.length+good.manifest.objects.length} files)`,{exact:false}).click();await shot('review')
  await page.getByRole('button',{name:'Upload package',exact:true}).click();await page.getByRole('alert').filter({hasText:'File fingerprint differs'}).waitFor();await shot('tampered')
  await writeFile(join(good.root,first.file),original)
  await page.getByLabel('Export folder',{exact:true}).setInputFiles(good.root)
  // Slow only this browser's real transport; never intercept successful replies.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:2_000_000,uploadThroughput:400_000})
  await page.getByRole('button',{name:'Continue upload',exact:true}).click();await page.getByRole('button',{name:'Interrupt upload',exact:true}).waitFor();await shot('progress')
  await page.getByRole('button',{name:'Interrupt upload',exact:true}).click();await page.getByRole('alert').filter({hasText:'Upload interrupted'}).waitFor();await shot('interrupted')
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await cdp.detach()
  await page.reload();await page.getByRole('button',{name:'Refresh package status',exact:true}).waitFor();await page.getByText('Reselect the same export folder', {exact:false}).waitFor();await shot('resume')
  await page.getByLabel('Export folder',{exact:true}).setInputFiles(good.root)
  const held=await page.evaluate(async()=>{const url=new URL(location.href),sha=url.searchParams.get('legacyPackage'),project=location.pathname.split('/')[2];const r=await fetch(`/api/move-in/projects/${project}/legacy-import/${sha}/status`);return (await r.json()).data})
  const accepted=new Set([...good.manifest.chunks,...good.manifest.context,...good.manifest.objects].map(p=>p.file).filter(file=>!held.missing.some(p=>p.file===file)&&!good.manifest.chunks.some(p=>p.file===file&&p.table==='ai_usages'))),start=puts.length
  await page.getByRole('button',{name:'Continue upload',exact:true}).click();await page.getByText('All required package files are uploaded.',{exact:false}).waitFor({timeout:120000})
  const sent=puts.slice(start).filter(path=>path.includes('/files/')).map(path=>decodeURIComponent(path.split('/').at(-1)));assert.equal(sent.some(file=>accepted.has(file)),false);assert.equal(sent.includes(good.manifest.chunks.find(p=>p.table==='ai_usages').file),false)
  await page.getByRole('button',{name:'Approve this destination',exact:true}).click();await page.getByText('Destination approved.',{exact:false}).waitFor();await shot('approved')
  await page.getByRole('button',{name:'Import history',exact:true}).click();await page.getByRole('heading',{name:'Import result',exact:true}).waitFor();await shot('queued')
  await page.getByText(/^complete · verified$/).waitFor({timeout:120000});await shot('completed')
  await historyBrowserFlow({page,runtime,source:good.manifest.source.projectId,inspect:shot})
  // Reading the adopted workspace switches native sessions; renew the exact owner approval explicitly.
  await page.getByRole('button',{name:'Renew owner approval',exact:true}).click();await page.getByText('Destination approved.',{exact:false}).waitFor()
  await page.getByText('Replay retained source',{exact:true}).click();const replayed=page.waitForResponse(r=>r.url().endsWith('/start')&&r.request().postData()?.includes('\"replay\":true'));await page.getByRole('button',{name:'Replay verification',exact:true}).click();assert.equal((await replayed).status(),202);await page.getByText('Counts and verification details',{exact:true}).click();await page.waitForFunction(()=>{try{const note=JSON.parse(document.querySelector('.legacy-result pre').textContent);return note.state==='complete'&&note.attempt?.number===2}catch{return false}},{},{timeout:120000});const note=JSON.parse(await page.locator('.legacy-result pre').textContent());assert.equal(note.attempt.appliedRows,0);await shot('replayed')

  // A fresh source with colliding row IDs must explain its real preflight pause.
  const conflict=await packageFixture(join(directory,'conflicting-source'),'synthetic-conflict-'+project,{staff:[{id:'synthetic-browser-staff',name:'Former support teammate',email:'synthetic-former@example.test',created_at:1}]});
  await page.getByLabel('Export folder',{exact:true}).setInputFiles(conflict.root);
  await page.getByRole('button',{name:/^(Upload package|Continue upload)$/}).click();await page.getByText('All required package files are uploaded.',{exact:false}).waitFor({timeout:120000});await shot('single-member-review');
  await page.getByRole('button',{name:'Approve this destination',exact:true}).click();await page.getByText('Destination approved.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Import history',exact:true}).click();await page.locator('.legacy-result code').filter({hasText:'canonical_target_conflict'}).waitFor({timeout:120000});
  await page.locator('.legacy-result summary').click();const paused=JSON.parse(await page.locator('.legacy-result pre').textContent());
  assert.equal(paused.errorCode,'canonical_target_conflict');assert.equal(paused.state,'paused');await shot('conflict-paused');

  // Server's unchanged secret classifier refuses a provider-shaped synthetic credential.
  const bad=await packageFixture(join(directory,'policy-refusal'),'synthetic-policy-'+project,{secret:true});await page.getByLabel('Export folder',{exact:true}).setInputFiles(bad.root);await page.getByRole('button',{name:/^(Upload package|Continue upload)$/}).click();await page.getByRole('alert').filter({hasText:'source secret policy'}).waitFor();await shot('policy-refused')
 }finally{page.off('request',record);await rm(directory,{recursive:true,force:true})}
}
