import assert from 'node:assert/strict'

// Observe actual browser animation events and layout-shift entries, including pseudo-elements.
async function observe(){
 window.publicProof={starts:[],ends:[],shifts:[],plays:[],moments:[],ids:new WeakMap(),next:0}
 const proof=window.publicProof,id=node=>{if(!proof.ids.has(node))proof.ids.set(node,++proof.next);return proof.ids.get(node)}
 for(const [event,key] of [['animationstart','starts'],['animationend','ends']])document.addEventListener(event,e=>{
  if(e.target.closest('.h2h-home'))proof[key].push({id:id(e.target),name:e.animationName,pseudo:e.pseudoElement})
 },true)
 new MutationObserver(records=>{for(const r of records)if(r.type==='attributes'&&r.target.getAttribute('data-reveal')==='play'&&r.oldValue!=='play'){
  proof.plays.push(id(r.target))
  proof.moments.push({id:id(r.target),timings:r.target.getAnimations({subtree:true}).map(a=>({name:a.animationName,...a.effect.getComputedTiming(),properties:a.effect.getKeyframes().flatMap(frame=>Object.keys(frame).filter(k=>!['offset','computedOffset','easing','composite'].includes(k)))}))})
 }}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-reveal'],attributeOldValue:true})
 new PerformanceObserver(list=>proof.shifts.push(...list.getEntries().map(e=>({value:e.value,input:e.hadRecentInput})))).observe({type:'layout-shift',buffered:true})
}
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const layout=page=>page.locator('h1,h2,.hero-sub,.hero-free,.hero-moments,.proof,.parts,.steps,figure,.site-header,.site-footer').evaluateAll(nodes=>nodes.map(node=>{let top=0,left=0;for(let parent=node;parent;parent=parent.offsetParent){top+=parent.offsetTop;left+=parent.offsetLeft}return {top,left,width:node.offsetWidth,height:node.offsetHeight}}))

export async function publicMotionJourney({page,origin}){
 await page.addInitScript(observe)
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.goto(origin+'/')
 await page.waitForFunction(()=>document.querySelector('[data-reveal="wait"]'))
 await page.evaluate(()=>document.fonts.ready)
 const flourish=page.locator('.hero-flourish path')
 const intro=await flourish.evaluate(node=>node.getAnimations().map(a=>({name:a.animationName,...a.effect.getComputedTiming()})))
 assert.ok(intro.length,'hero flourish actually draws')
 for(const animation of intro){assert.equal(animation.iterations,1);assert.ok(Number.isFinite(animation.endTime))}
 await flourish.evaluate(node=>Promise.all(node.getAnimations().map(a=>a.finished)))
 assert.equal(await flourish.evaluate(node=>getComputedStyle(node).strokeDashoffset),'0px','intro finishes fully drawn')
 const initial=await layout(page)
 await page.evaluate(()=>{window.publicProof.shifts=[]})
 const moments=page.locator('[data-reveal]')
 assert.ok(await moments.count()>0,'below-hero moments registered')
 for(const moment of await moments.all()){
  await moment.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}))
  await page.waitForFunction(node=>node.dataset.reveal==='play',await moment.elementHandle())
  await moment.evaluate(node=>Promise.all(node.getAnimations({subtree:true}).map(a=>a.finished)))
 }
 await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished)))
 await frames(page)
 assert.deepEqual(await layout(page),initial,'motion leaves all layout boxes unchanged')
 const proof=await page.evaluate(()=>({starts:window.publicProof.starts,ends:window.publicProof.ends,plays:window.publicProof.plays,moments:window.publicProof.moments,shifts:window.publicProof.shifts}))
 for(const moment of proof.moments){
  assert.ok(moment.timings.length,'every revealed moment animates')
  for(const timing of moment.timings){
   assert.equal(timing.iterations,1,'one play per moving part')
   assert.ok(timing.endTime<=1800,'complete moment including delay fits 1.8 seconds: '+timing.name)
   for(const property of timing.properties)assert.ok(['opacity','transform','translate','scale','clipPath','strokeDasharray','strokeDashoffset','backgroundSize','backgroundColor','color'].includes(property),'motion does not animate layout: '+property)
   const extra=timing.properties.filter(property=>!['opacity','transform','translate','scale','clipPath','strokeDasharray','strokeDashoffset'].includes(property))
   if(extra.length)console.log('PUBLIC_FINDING PUBLIC-004: '+timing.name+' animates '+[...new Set(extra)].join(',')+' beyond the retained opacity/transform/clip/stroke set; no approved CSS changed; Gap remains open')
  }
 }
 assert.equal(proof.shifts.reduce((sum,e)=>sum+e.value,0),0,'no browser-observed layout shift while moments play')
 assert.equal(new Set(proof.plays).size,proof.plays.length,'each moment revealed once')
 assert.equal(proof.plays.length,await moments.count(),'every registered moment reaches play')
 assert.deepEqual([...proof.starts].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...proof.ends].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),'every started animation completes')
 for(const moment of (await moments.all()).reverse())await moment.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}))
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await frames(page)
 assert.deepEqual(await page.evaluate(()=>window.publicProof.starts),proof.starts,'scrolling back never replays')
 assert.equal(await flourish.evaluate(node=>getComputedStyle(node).strokeDashoffset),'0px')

 // Keyboard order follows the real visible links, with an ink focus ring and a working skip link.
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/')
 const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none'&&n.getClientRects().length).map(n=>({href:n.getAttribute('href'),label:n.textContent.trim()})))
 for(const expected of links){
  await page.keyboard.press('Tab')
  const active=await page.evaluate(()=>({href:document.activeElement.getAttribute('href'),label:document.activeElement.textContent.trim(),ring:getComputedStyle(document.activeElement).outlineStyle}))
  assert.deepEqual({href:active.href,label:active.label},expected,'keyboard reaches each link in DOM order')
  assert.notEqual(active.ring,'none','focused link has a visible ring')
 }
 await page.goto(origin+'/');await page.keyboard.press('Tab');await page.keyboard.press('Enter')
 assert.equal(new URL(page.url()).hash,'#product','skip link reaches product')
 const reducedLayout=await layout(page)
 await page.evaluate(()=>scrollTo({top:document.body.scrollHeight,behavior:'instant'}));await frames(page)
 assert.deepEqual(await layout(page),reducedLayout,'reduced motion changes no layout')
 assert.deepEqual(await page.locator('.h2h-home').evaluate(node=>node.getAnimations({subtree:true}).map(a=>a.animationName)),[],'reduced motion removes all animation')
 const final=await page.locator('.h2h-home *').evaluateAll(nodes=>nodes.flatMap(node=>{
  const s=getComputedStyle(node),problems=[]
  if(node.matches('[data-reveal="wait"]'))problems.push('waiting '+node.className)
  if(node.matches('.d-blob,.d-card,.d-window,.proof li,.steps li,.step')){if(s.opacity!=='1')problems.push('hidden '+node.className)}
  if(node.matches('.hero-flourish path,.story-arrow path,.divider-line path,.ready-line path,.d-sparks path')&&parseFloat(s.strokeDashoffset)!==0)problems.push('unfinished stroke')
  if(s.animationName!=='none'||parseFloat(s.transitionDuration)!==0||s.scrollBehavior!=='auto')problems.push('reduced motion '+node.className)
  return problems
 }))
 assert.deepEqual(final,[],'reduced motion leaves drawings and every stroke complete')

 // Hold all local fonts to measure the actual fallback -> Outfit swap, without pinning a font file list.
 const fontContext=await page.context().browser().newContext({viewport:page.viewportSize()})
 const fontPage=await fontContext.newPage(),requests=[]
 let release
 const gate=new Promise(resolve=>{release=resolve})
 await fontPage.addInitScript(observe)
 await fontPage.route('**/*',async route=>{
  if(route.request().resourceType()==='font'){requests.push(route.request().url());await gate}
  await route.continue()
 })
 try{
  await fontPage.emulateMedia({reducedMotion:'reduce'})
  await fontPage.goto(origin+'/',{waitUntil:'domcontentloaded'})
  await fontPage.waitForFunction(()=>document.fonts.status==='loading')
  await frames(fontPage)
  const fallback=await layout(fontPage)
  await fontPage.evaluate(()=>{window.publicProof.shifts=[]})
  release();await fontPage.evaluate(()=>document.fonts.ready);await frames(fontPage)
  assert.ok(requests.length,'Outfit is loaded from font resources')
  for(const url of requests)assert.equal(new URL(url).origin,origin,'fonts are self hosted')
  assert.ok(await fontPage.evaluate(()=>document.fonts.check('18px Outfit')),'Outfit has loaded')
  assert.match(await fontPage.locator('.h2h-home').evaluate(node=>getComputedStyle(node).fontFamily),/^Outfit, "Outfit Fallback"/)
  const loaded=await layout(fontPage)
  const shift=await fontPage.evaluate(()=>window.publicProof.shifts.reduce((sum,e)=>sum+e.value,0))
  console.log('PUBLIC_PROOF font swap layout-shift='+shift)
  if(shift!==0)console.log('PUBLIC_FINDING PUBLIC-004: fallback-to-Outfit text shifts; no approved CSS changed; Gap remains open')
  assert.deepEqual(loaded,fallback,'fallback and loaded font preserve element boxes (text-shift defect is reported separately)')
 }finally{release();await fontContext.close()}
}
