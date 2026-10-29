import assert from 'node:assert/strict'
import {appearance,aqua,disc,ink,inkCard,lineIcon,see} from './visual.mjs'

export async function supportDesk({page,section}){
 await see(page,section.getByRole('heading',{name:'The rest of your support desk',exact:true}))
 const features=[/chat widget/i,/shared inbox/i,/help cent(?:er|re)/i,/suggested replies/i]
 const cards=section.locator('.parts > li')
 assert.equal(await cards.count(),features.length,'all four parts of the support desk are presented')
 for(const [index,feature] of features.entries()){
  const item=cards.nth(index),title=item.getByRole('heading',{level:3,name:feature}),drawing=item.getByRole('img')
  await see(page,item)
  assert.ok(await title.isVisible(),`${feature} is a visible desk feature`)
  const card=await inkCard(drawing.locator(':scope > .d-card'),String(feature))
  assert.equal(await drawing.locator('.d-window,.d-bar').count(),0,'desk cards have no window frame or window chrome')
  assert.equal(await item.locator('.step').innerText(),String(index+1),'desk features are visibly numbered in reading order')
  const number=await disc(item.locator('.step'),String(feature))
  const heading=await title.boundingBox()
  assert.ok(card.bottom<number.y&&number.bottom<=heading.y,'each ink illustration is followed by its aqua number disc and feature heading')
 }
}

export async function moveInInvitation({page,section}){
 await see(page,section.getByRole('heading',{name:'Try it beside what you have',exact:true}))
 const steps=section.locator('.steps'),items=steps.getByRole('listitem')
 await see(page,steps)
 assert.equal(await items.count(),3,'move-in offers installation, help-centre import and widget installation')
 assert.match(await items.nth(0).innerText(),/install/i,'the visitor is invited to install')
 const importing=await items.nth(1).innerText()
 assert.match(importing,/bring your help cent(?:er|re)/i,'the import invitation is scoped to the help centre')
 for(const provider of ['Zendesk','Intercom','Freshdesk'])assert.match(importing,new RegExp(`\\b${provider}\\b`),`${provider} help-centre import is offered`)
 assert.match(await items.nth(2).innerText(),/add the chat widget/i,'the visitor is invited to add the widget')
 assert.match(await items.nth(2).innerText(),/script tag.*site/i,'the invitation explains how to install the widget')
 for(let index=0;index<await items.count();index++){
  const number=await disc(items.nth(index),`move-in step ${index+1}`,{pseudo:'::before'})
  const counter=number.content.match(/^counter\(([^,)]+)(?:,\s*decimal)?\)$/)
  if(counter){
   const reset=(await appearance(steps)).counterReset.split(/\s+/),increment=(await appearance(items.nth(index))).counterIncrement.split(/\s+/)
   assert.equal(reset[0],counter[1],'the step discs use the ordered list counter')
   assert.equal(increment[0],counter[1],'each step advances the same counter')
   assert.equal(Number(reset[1])+(index+1)*Number(increment[1]),index+1,'move-in discs display consecutive step numbers')
  }else assert.equal(number.content.replace(/^"|"$/g,''),String(index+1),'move-in discs display consecutive step numbers')
 }
 const guide=section.getByRole('link',{name:/installation guide/i})
 assert.equal(new URL(await guide.getAttribute('href'),page.url()).pathname,'/docs/install','the move-in invitation leads to installation instructions')

 const drawing=section.getByRole('img',{name:/help.centre import.*complete/i})
 await see(page,drawing)
 const window=drawing.locator('.import-window')
 await inkCard(window,'finished import window')
 assert.ok(await window.locator('.d-bar').isVisible(),'the import remains in its window')
 assert.match(await window.locator('.import-title').innerText(),/import articles from Zendesk/i)
 assert.match(await window.locator('.import-status').innerText(),/complete/i,'the illustrated import is finished')
 assert.match(await window.locator('.import-counts').innerText(),/Articles:\s*[1-9]\d*.*Categories:\s*[1-9]\d*/i,'the finished import shows articles and categories brought across')
 await disc(window.locator('.d-check'),'import completion check')
 await lineIcon(window.locator('.d-check svg'),'import completion check')
 const ticks=window.locator('.import-ticks > i')
 assert.ok(await ticks.count()>1,'the import has a visible progress track')
 for(const tick of await ticks.all()){
  const paint=await appearance(tick)
  assert.ok(paint.width>0&&paint.height>0,'each completed progress segment is visible')
  aqua(paint.background,'completed import progress')
 }
 const [copy,art]=await Promise.all([section.locator('.split-copy').boundingBox(),drawing.boundingBox()])
 assert.ok(copy.x+copy.width<art.x&&copy.y<art.y+art.height&&art.y<copy.y+copy.height,'the installation invitation sits beside the finished import drawing at desktop width')
 return guide
}

export async function closingAndFooter({page,section,headerBrand,footer}){
 const headline=section.getByRole('heading',{name:'Ready when you are.',exact:true})
 await see(page,headline)
 const line=headline.locator('.ready-line'),path=line.locator('path'),paint=await appearance(path)
 aqua(paint.stroke,'closing pen line')
 assert.ok(paint.strokeWidth>0&&await path.evaluate(node=>node.getTotalLength()>0),'the closing line has visible ink geometry')
 assert.equal(paint.fill,'none','the closing underline is drawn as a pen stroke')
 assert.equal(parseFloat(paint.dashOffset),0,'the closing aqua line is fully drawn')
 const [title,underline,deskTitle]=await Promise.all([appearance(headline),appearance(line),appearance(page.getByRole('heading',{name:'The rest of your support desk',exact:true}))])
 assert.ok(title.fontSize>deskTitle.fontSize,'the closing headline is large')
 assert.ok(underline.y>title.y+title.fontSize*0.8&&underline.bottom<=title.bottom+1,'the aqua pen line sits under the closing headline')

 await see(page,footer)
 const footerBrand=footer.getByRole('link',{name:'HappyToHelp',exact:true})
 assert.equal(await footerBrand.getAttribute('href'),await headerBrand.getAttribute('href'),'the footer and header lockups both return home')
 const lockup=async brand=>{
  const mark=brand.locator('.brand-mark'),word=brand.locator('.brand-word')
  assert.ok(await mark.isVisible()&&await word.isVisible(),'the lockup visibly contains its speech-bubble mark and wordmark')
  const [markBox,wordBox]=await Promise.all([mark.boundingBox(),word.boundingBox()])
  assert.ok(markBox.x+markBox.width<wordBox.x&&Math.abs(markBox.y+markBox.height/2-wordBox.y-wordBox.height/2)<1,'the mark sits beside the centered wordmark')
  return brand.locator('svg').evaluateAll(svgs=>svgs.map(svg=>({
   viewBox:svg.getAttribute('viewBox'),width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,
   paths:[...svg.querySelectorAll('path')].map(path=>({d:path.getAttribute('d'),transform:path.getAttribute('transform'),stroke:getComputedStyle(path).stroke,strokeWidth:getComputedStyle(path).strokeWidth,fill:getComputedStyle(path).fill}))
  })))
 }
 const [header,signature]=await Promise.all([lockup(headerBrand),lockup(footerBrand)])
 assert.ok(header.length===2&&header.every(part=>part.paths.length&&part.paths.every(path=>path.d)),'the header supplies a drawn mark and wordmark to match')
 ink(header[1].paths[0].stroke,'header wordmark')
 assert.deepEqual(signature,header,'the footer signs off with the same painted lockup as the header')
}
