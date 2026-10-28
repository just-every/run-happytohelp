import assert from 'node:assert/strict'

// The public entry is part of the owner's installation journey. Content wording
// and drawing geometry are reviewed product assets, not test literals.
export async function publicEntry({page,origin,audit}) {
 const external=[],failedAssets=[]
 const asset=response=>{if(response.status()>=400&&['stylesheet','image','font','script'].includes(response.request().resourceType()))failedAssets.push(new URL(response.url()).pathname)}
 page.on('response',asset)
 const collect=request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))external.push(request.url())}
 page.on('request',collect)
 await page.goto(origin)
 await page.getByRole('heading',{level:1}).waitFor()
 await page.evaluate(()=>document.fonts.ready)
 await audit(page,'homepage')
 const docs=page.locator('.hero-copy .actions').getByRole('link',{name:'Read the docs',exact:true})
 await docs.focus();assert.ok(await docs.evaluate(el=>el===document.activeElement))
 await page.keyboard.press('Enter');await page.waitForURL('**/docs')
 await page.getByRole('heading',{level:1}).waitFor();await audit(page,'installation-docs')
 // Follow the actual documentation links; Markdown manifest equality is exercised
 // through the build/public-route journey, without a second browser crawl.
 const installation=page.locator('a[href="/docs/install"]').first()
 await installation.click();await page.getByRole('heading',{level:1}).waitFor()
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin)
 await page.evaluate(()=>document.fonts.ready)
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').length),0,'reduced motion leaves no running animation')
 await audit(page,'homepage-reduced-motion')
 assert.deepEqual(external,[],'homepage and documentation load without third-party requests')
 assert.deepEqual(failedAssets,[],'public assets load successfully')
 page.off('request',collect);page.off('response',asset)
 await page.locator('footer').getByRole('link',{name:'Set up',exact:true}).click()
 await page.getByLabel('Your email',{exact:true}).waitFor()
}
