// Run Edit Run fleet, 2026-11-16. Actual local public-door probe; private entry values stay out of receipts.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {launchBrowser} from '/home/agent/rer-consolidation/work/hh-stranger11-followups-1/repo/tests/journeys/kit/browser.mjs'
async function nativeOwnerEntryAndRecovery(){
const stage=process.argv[2]||'before',packet='/home/agent/rer-consolidation/work/hh-stranger11-followups-1/packet'
const repo='/home/agent/rer-consolidation/work/hh-stranger11-followups-1/repo',head=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeDirty=execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}).trim()!==''
let log='';const readyDeadline=Date.now()+180000
while(!log.includes('RER_OPEN')){log=await readFile('/tmp/hh-'+stage+'-dev.private.log','utf8');if(Date.now()>readyDeadline)throw Error('dev not ready');if(!log.includes('RER_OPEN'))await new Promise(done=>setTimeout(done,250))}
const entry=log.match(/RER_OPEN (https?:\/\/[^\s\x1b]+)/)?.[1]
if(!entry)throw Error('private owner entry not found')
const browser=await launchBrowser()
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
 await page.addInitScript(()=>{
  window.h2hObserved=[]
  const sample=()=>{
   const candidates=[...document.querySelectorAll('.h2h-recovery__message,.dashboard-state__message,.dashboard-busy')]
   for(const node of candidates)if(node.getClientRects().length&&!window.h2hObserved.includes(node.textContent))window.h2hObserved.push(node.textContent)
  }
  new MutationObserver(sample).observe(document,{childList:true,subtree:true})
 })
 const started=Date.now(),failures=[]
 page.on('response',r=>{if(r.status()>=400)failures.push({path:new URL(r.url()).pathname,status:r.status()})})
 await page.goto(entry,{waitUntil:'domcontentloaded',timeout:180000})
 await page.waitForURL(/\/projects\/[^/]+\/activation/,{timeout:180000})
 await page.locator('.setup-list[data-environment]').waitFor({timeout:90000})
 const elapsed=Date.now()-started,notices=await page.evaluate(()=>window.h2hObserved)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900})
  await page.waitForTimeout(300)
  await page.screenshot({path:packet+'/'+stage+'-setup-'+width+'.png',fullPage:true})
 }
 const origin=new URL(page.url()).origin,projectId=new URL(page.url()).pathname.split('/')[2]
 const receipt={stage,head,worktreeDirty,path:'Setup',elapsedMs:elapsed,notices,failures,viewportAssertions:1440,screenshots:[1440,390].map(w=>stage+'-setup-'+w+'.png')}
 await writeFile(packet+'/'+stage+'-owner-entry.json',JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify(receipt))
 // Inspect the actual Inbox New ticket workflow using this native owner session.
 await page.setViewportSize({width:1440,height:900})
 await page.goto(origin+'/projects/'+projectId+'/conversations?view=mine')
 await page.getByRole('button',{name:'New ticket',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'New ticket',exact:true})
 await dialog.getByLabel('First comment',{exact:true}).selectOption('internal')
 await dialog.getByLabel('Requester email',{exact:true}).fill('casey.morgan@example.com')
 await dialog.getByLabel('Requester name',{exact:true}).fill('Casey Morgan')
 await dialog.getByLabel('Subject',{exact:true}).fill('Check replacement buckle stock for CT-10508')
 await dialog.getByLabel('Internal note',{exact:true}).fill('Check stock and call Casey with the replacement buckle availability.')
 console.log('dialog ready')
 await page.screenshot({path:packet+'/'+stage+'-internal-dialog-1440.png',fullPage:true})
 const response=page.waitForResponse(r=>r.url().endsWith('/tickets')&&r.request().method()==='POST')
 await dialog.getByRole('button',{name:'Create ticket',exact:true}).click()
 const result=await response,body=await result.json()
 if(!result.ok())throw Error('ticket create '+result.status()+' '+JSON.stringify(body))
 const id=body.conversation.id
 await page.waitForURL('**/conversations/'+id)
 await page.goto(origin+'/projects/'+projectId+'/conversations?view=mine')
 await page.reload()
 await page.waitForTimeout(2000)
 const api=await page.evaluate(async({projectId,id})=>{
  const base='/api/dashboard/projects/'+projectId+'/conversations'
  const list=await (await fetch(base+'?view=mine')).json(),counts=await (await fetch(base+'/counts')).json()
  return {contains:list.data.some(row=>row.id===id),total:list.meta.pagination.total,counts:counts.data,assigned: list.data.find(row=>row.id===id)?.assigned_to}
 },{projectId,id})
 const visible=await page.locator('.conversation-item').filter({hasText:'Check replacement buckle stock for CT-10508'}).count()
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.waitForTimeout(300);await page.screenshot({path:packet+'/'+stage+'-internal-inbox-'+width+'.png',fullPage:true})}
 await writeFile(packet+'/'+stage+'-internal-browser.json',JSON.stringify({stage,head,worktreeDirty,created:true,firstComment:'internal',noteOnly:true,reload:{api,visibleRows:visible}},null,2)+'\n')
 console.log('internal reload',JSON.stringify({api,visibleRows:visible}))
 if(stage==='after'){
  let cut=false,documentRequests=0,health503=0,released=false
  await page.setViewportSize({width:1440,height:900})
  await page.route('**/health',async route=>{if(!released)health503++;await route.fulfill({status:released?200:503,contentType:'application/json',body:JSON.stringify({ok:released})})})
  await page.route('**/projects/'+projectId+'/activation',async route=>{
   documentRequests++
   if(cut)return route.continue()
   cut=true
   const response=await route.fetch(),html=await response.text(),firstScriptEnd=html.indexOf('</script>')+9
   assert.ok(firstScriptEnd>9&&html.slice(0,firstScriptEnd).includes('$h2hDocumentEnd'),'the actual dashboard response includes its native recovery script')
   await route.fulfill({response,body:html.slice(0,firstScriptEnd)+'<body>'})
  })
  await page.goto(origin+'/projects/'+projectId+'/activation',{waitUntil:'domcontentloaded'})
  const recovery=page.locator('.h2h-recovery__message')
  await recovery.waitFor({timeout:10000})
  await page.waitForFunction(()=>!!document.querySelector('.h2h-recovery'))
  const deadline=Date.now()+15000
  while(health503<2&&Date.now()<deadline)await page.waitForTimeout(200)
  assert.ok(health503>=2,'a warming health endpoint is probed automatically')
  assert.equal(documentRequests,1,'503 health does not reload an unfinished document')
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.screenshot({path:packet+'/after-entry-recovery-'+width+'.png',fullPage:true})}
  released=true
  await page.locator('.setup-list[data-environment]').waitFor({timeout:60000})
  assert.ok(documentRequests>=2,'a healthy endpoint automatically resumes into Setup')
  await writeFile(packet+'/after-entry-recovery.json',JSON.stringify({head,worktreeDirty,networkEdgeFixture:'actual dashboard prefix with cut document and two or more 503 health responses',health503,documentRequests,automaticSetupRecovery:true,viewportAssertions:1440,screenshots:[1440,390].map(w=>'after-entry-recovery-'+w+'.png')},null,2)+'\n')
  console.log('document recovery fixture passed')
 }
}finally{await browser.close()}

}
await nativeOwnerEntryAndRecovery()
