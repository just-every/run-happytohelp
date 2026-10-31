import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {publicMotionJourney} from './public-site-motion.mjs'
import {publicDocsJourney} from './public-docs-journey.mjs'

const text=locator=>locator.innerText().then(value=>value.replace(/\s+/g,' ').trim())
const box=locator=>locator.boundingBox()
const style=(locator,property,pseudo)=>locator.evaluate((node,{property,pseudo})=>getComputedStyle(node,pseudo).getPropertyValue(property),{property,pseudo})
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height
const inside=(outer,inner)=>inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height

// PUBLIC-001..004: outcomes on the emitted application, never screenshot hashes or source snapshots.
async function presentation(page,repository){
 assert.equal(await text(page.locator('h1')),'Knows what your customer needs before they do.')
 assert.equal(await text(page.locator('.hero-sub')),'Some customers who get stuck never write in. They just leave.')
 assert.equal(await text(page.locator('.hero-free')),'100% free, open source alternative to Zendesk, Intercom, Help Scout and Freshdesk')
 assert.equal(await style(page.locator('h1'),'text-align'),'start','headline is left aligned in this left-to-right document')
 const copy=await box(page.locator('.hero-copy')),stage=await box(page.locator('.hero-stage'))
 const before=await box(page.locator('.story-before')),when=await box(page.locator('.story-when'))
 if(page.viewportSize().width===1440){
  assert.ok(copy.x+copy.width<=stage.x,'wide hero copy beside drawing')
  assert.ok(before.x+before.width<=when.x,'wide support moments side by side')
 }else{
  assert.ok(copy.y+copy.height<=stage.y,'phone hero stacks')
  assert.ok(before.y+before.height<=when.y,'phone support moments stack')
 }
 const drawing=await box(page.locator('.story-art')),captions=page.locator('.hero-moments')
 assert.ok((await box(captions)).y>=drawing.y+drawing.height,'captions below drawing')
 const blob=page.locator('.story-blob:visible')
 assert.equal(await blob.count(),1,'one visible shared blob')
 assert.ok(inside(await box(blob),before)&&inside(await box(blob),when),'both moments share the blob')
 assert.equal(await style(blob,'fill'),'rgb(232, 249, 252)','pale aqua drawing')
 const checkout=await box(page.locator('.story-checkout')),offer=await box(page.locator('.story-offer'))
 assert.ok(overlaps(checkout,offer),'offer overlaps the checkout corner')
 assert.ok(offer.x+offer.width>=checkout.x+checkout.width&&offer.y+offer.height>=checkout.y+checkout.height,'offer extends over lower right corner')
 assert.ok(await page.locator('.story-offer .brand-mark').isVisible(),'offer retains speech-bubble mark')
 assert.equal(await text(page.locator('.story-who')),'Maya')
 assert.match(await text(page.locator('.story-thread')),/can’t turn on the Spanish version of my store/)
 assert.match(await text(page.locator('.story-bubble--fix')),/Fixed\. Spanish is live/)
 assert.ok(await page.locator('.story-row .story-glyph svg').isVisible(),'fix beside code glyph')
 assert.equal(await text(page.locator('.story-composer .story-send')),'Send')
 assert.ok(inside(await box(page.locator('.story-composer')),await box(page.locator('.story-send'))),'Send inside prepared reply')
 const arrow=page.locator('.story-arrow')
 assert.ok(await arrow.isVisible());assert.equal(await style(arrow,'color'),'rgb(90, 216, 236)')
 assert.ok(await arrow.locator('path').count()>1,'connecting arrow includes a head')
 assert.deepEqual(await page.locator('.story-number').allTextContents(),['1','2'])
 for(const disc of await page.locator('.story-number').all()){
  assert.equal(await style(disc,'background-color'),'rgb(143, 227, 238)');assert.equal(await style(disc,'border-radius'),'50%')
 }
 assert.deepEqual(await captions.locator('b').allTextContents(),['Before they ask','When they ask'])
 assert.deepEqual(await captions.locator('p').allTextContents(),['When someone seems stuck, the widget offers a hand.','Your Codex or Claude fixes the problem and writes the reply. You press Send.'])
 for(const caption of await captions.locator('li').all()){
  assert.equal(await style(caption,'background-color','::before'),'rgb(143, 227, 238)')
  assert.equal(await style(caption,'border-radius','::before'),'50%')
  assert.match(await style(caption,'content','::before'),/counter\(moment\)/)
  assert.equal(await style(caption,'counter-increment'),'moment 1')
 }

 // PUBLIC-002: free promise, wordless editor, licence above it, and no marketing detours.
 assert.equal(await text(page.locator('#free h2')),'Not just better. Free.')
 assert.match(await text(page.locator('#free .split-copy')),/100% free and open source.*Free as in code, and free as in cost.*MIT licensed/)
 assert.deepEqual(await page.locator('.proof li').allTextContents(),['No seats.','No plans.','No fees.'])
 for(const circle of await page.locator('.proof-icon').all()){
  assert.equal(await style(circle,'background-color'),'rgb(214, 245, 250)');assert.equal(await style(circle,'border-radius'),'50%')
  assert.ok(await circle.locator('svg').count()>0)
 }
 assert.equal(await text(page.locator('.licence-editor')),'','editor is wordless')
 assert.ok(await page.locator('.code-line i').count()>0,'editor retains drawn code lines')
 assert.match(await text(page.locator('.licence-card')),/MIT License.*free of charge.*use, copy, modify, merge, publish, distribute/)
 assert.ok(overlaps(await box(page.locator('.licence-editor')),await box(page.locator('.licence-card'))),'licence overlays editor')
 await page.locator('.licence-card').scrollIntoViewIfNeeded()
 assert.ok(await page.locator('.licence-card').evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.licence-card')===node}),'licence paints above editor')
 for(const highlight of await page.locator('.licence-mark,.licence-grant').all())assert.match(await style(highlight,'background-image'),/rgb\((143, 227, 238|214, 245, 250)\)/)
 const copyText=await text(page.locator('main'))
 assert.doesNotMatch(copyText,/(?:\$|€|£)\s*\d|\b(?:pricing|paid plan|per seat|per month|hosting|hosted by|powered by|Run Edit Run|Cloudflare|AWS|Azure|Vercel|OpenRouter)\b/i,'no price, hosting, provider or unrelated-service promotion')
 const destinations=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))
 for(const href of destinations.filter(href=>/^https?:/.test(href)))assert.ok(href===repository||href.startsWith(repository+'/'),'every external destination belongs to the selected repository')

 // PUBLIC-003: numbered frameless desk, finished move-in, ordered closing and matching signatures.
 const parts=page.locator('.parts > li')
 assert.deepEqual(await parts.locator('h3').allTextContents(),['Chat widget','Shared inbox','Help centre','Suggested replies'])
 assert.deepEqual(await parts.locator('.step').allTextContents(),['1','2','3','4'])
 for(const part of await parts.all()){
  assert.equal(await part.locator('.d-window,.d-bar').count(),0,'desk cards have no window chrome')
  assert.equal(await style(part.locator('.d-card').first(),'border-top-color'),'rgb(20, 20, 20)')
  assert.equal(await style(part.locator('.step'),'background-color'),'rgb(143, 227, 238)')
  assert.equal(await style(part.locator('.step'),'border-radius'),'50%')
 }
 assert.equal(await text(page.locator('#move-in h2')),'Try it beside what you have')
 const steps=await page.locator('.steps li').allTextContents()
 assert.match(steps[0],/Install/);assert.match(steps[1],/Zendesk, Intercom or Freshdesk/);assert.match(steps[2],/Add the chat widget/)
 for(const step of await page.locator('.steps li').all()){
  assert.equal(await style(step,'background-color','::before'),'rgb(143, 227, 238)')
  assert.match(await style(step,'content','::before'),/counter\(move\)/)
 }
 assert.equal(await text(page.locator('.import-status')),'complete')
 assert.match(await text(page.locator('.import-counts')),/Articles: \d+ · Categories: \d+/)
 assert.ok(await page.locator('.import-status .d-check').isVisible())
 assert.equal(await text(page.locator('#get-started h2')),'Ready when you are.')
 assert.deepEqual(await page.locator('main > section').evaluateAll(nodes=>nodes.map(node=>node.id)),['top','free','product','move-in','get-started'])
 const closing=page.locator('.ready-line')
 assert.ok(await closing.isVisible());assert.equal(await style(closing,'color'),'rgb(90, 216, 236)')
 assert.equal(await page.locator('.site-header .brand').innerHTML(),await page.locator('.site-footer .brand').innerHTML(),'footer signs with the header lockup')

 // PUBLIC-004: measured colors and DOM labels, permitted accent locations, real links, accessible wordmark.
 assert.equal(await style(page.locator('.h2h-home'),'background-color'),'rgb(246, 242, 234)')
 assert.equal(await style(page.locator('.h2h-home'),'color'),'rgb(20, 20, 20)')
 for(const pill of await page.locator('.pill--ink').all()){
  assert.equal(await style(pill,'background-color'),'rgb(20, 20, 20)')
  const radius=parseFloat(await style(pill,'border-radius'));assert.ok(radius>=(await box(pill)).height/2,'pill ends are round')
 }
 for(const figure of await page.locator('figure').all()){
  assert.equal(await figure.getAttribute('role'),'img');assert.ok(await figure.getAttribute('aria-label'))
  assert.ok((await text(figure)).length>0,'drawing labels are DOM text')
  assert.equal(await figure.locator('img,canvas').count(),0,'drawing is labelled HTML/SVG')
 }
 for(const brand of await page.locator('.site-header .brand,.site-footer .brand').all()){
  assert.equal(await text(brand),'HappyToHelp')
  assert.ok(await brand.locator('.brand-word path').count()>0,'hand-drawn wordmark strokes')
  assert.equal(await brand.locator('.brand-word').getAttribute('aria-hidden'),'true')
 }
 assert.equal(await page.getByRole('link',{name:'HappyToHelp',exact:true}).count(),2)
 for(const link of await page.getByRole('link',{name:'Get the code',exact:true}).all())assert.equal(await link.getAttribute('href'),repository)
 assert.equal(await page.getByRole('link',{name:'MIT licence',exact:true}).getAttribute('href'),repository+'/blob/main/LICENSE')
 assert.equal(await page.getByRole('link',{name:'Read the installation guide',exact:true}).getAttribute('href'),'/docs/install')
 assert.equal(await style(page.locator('.hero-copy .text-link'),'text-decoration-color'),'rgb(90, 216, 236)')
 for(const blob of await page.locator('.d-blob').all())assert.equal(await style(blob,'fill'),'rgb(232, 249, 252)')
 const accents=await page.locator('.h2h-home *').evaluateAll(nodes=>{
  const aqua=['rgb(143, 227, 238)','rgb(90, 216, 236)','rgb(214, 245, 250)','rgb(232, 249, 252)'],problems=[]
  for(const node of nodes){
   if(node.closest('.drawing'))continue
   for(const pseudo of [null,'::before','::after']){
    const s=getComputedStyle(node,pseudo)
    for(const property of ['color','backgroundColor','borderTopColor','textDecorationColor','fill','stroke']){
     const color=s[property],rgb=/^rgba?\((\d+), (\d+), (\d+)/.exec(color)
     if(!rgb||rgb[1]===rgb[2]&&rgb[2]===rgb[3]||color==='rgba(0, 0, 0, 0)')continue
     if(['rgb(246, 242, 234)','rgb(102, 99, 93)','rgb(43, 42, 39)'].includes(color))continue
     const permitted=node.closest('.hero-moments,.proof-icon,.step,.steps,.hero-flourish,.divider,.ready-line,.brand-mark,.text-link')
     if(!aqua.includes(color)||!permitted)problems.push({node:node.tagName,class:node.getAttribute('class'),pseudo,property,color})
    }
   }
  }
  return problems
 })
 assert.deepEqual(accents,[],'outside drawings, color stays in the specified aqua accents and mark sparks')
 for(const divider of await page.locator('.divider').all()){
  assert.equal(await style(divider,'color'),'rgb(90, 216, 236)')
  const width=(await box(divider)).width,main=await page.locator('main').evaluate(node=>node.clientWidth-parseFloat(getComputedStyle(node).paddingLeft)-parseFloat(getComputedStyle(node).paddingRight))
  assert.equal(Math.round(width),Math.round(main),'divider spans the content width')
 }
 assert.equal(await page.locator('.divider').count(),2)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'homepage fits viewport')
}

export async function publicSiteJourney({page,origin,shot}){
 const requests=[];const record=request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)requests.push(request.url())};page.on('request',record)
 const {repository}=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'))
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto(origin+'/');await page.evaluate(()=>document.fonts.ready)
 await presentation(page,repository.url)
 // The same screens are reviewed once at each requested width; assertions stay at desktop.
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900})
  if(width===390){
   const copy=await box(page.locator('.hero-copy')),stage=await box(page.locator('.hero-stage')),before=await box(page.locator('.story-before')),when=await box(page.locator('.story-when'))
   assert.ok(copy.y+copy.height<=stage.y,'phone hero stacks copy above drawing')
   assert.ok(before.y+before.height<=when.y,'phone moments stack')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone homepage fits')
  }
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:'instant'})})
  await page.screenshot({path:shot('approved-home-'+width+'.png'),fullPage:true})
 }
 await page.setViewportSize({width:1440,height:900})
 await publicMotionJourney({page,origin})
 await publicDocsJourney({page,origin,shot,repository:repository.url})
 page.off('request',record);assert.deepEqual(requests,[],'public pages make no third-party requests')
}
