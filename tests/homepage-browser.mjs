import assert from 'node:assert/strict'
import {auditPage} from './journeys/kit/browser.mjs'

export async function homepageJourney({page,origin,shot}){
 const errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 const response=await page.goto(origin+'/')
 assert.equal(response.status(),200)
 await page.getByRole('heading',{level:1}).waitFor()
 const source=page.locator('.hero-copy').getByRole('link',{name:'Get the code',exact:true})
 assert.match(await source.getAttribute('href'),/^https:\/\/github\.com\//)
 await auditPage(page,shot('homepage.png'))
 await page.locator('.hero-copy').getByRole('link',{name:'Read the docs',exact:true}).click()
 await page.waitForURL(origin+'/docs')
 await page.getByRole('heading',{level:1}).waitFor()
 await page.getByRole('navigation',{name:'Documentation',exact:true}).getByRole('link',{name:'Getting started',exact:true}).click()
 await page.waitForURL(origin+'/docs/getting-started')
 await page.locator('.docs-prose pre').first().waitFor()
 await auditPage(page,shot('installation.png'))
 // A mistyped documentation address leaves a working route back to the product.
 const missing=await page.goto(origin+'/docs/missing-installation-page')
 assert.equal(missing.status(),404)
 await page.getByRole('link',{name:'Back to the homepage',exact:true}).click()
 await page.waitForURL(origin+'/')
 assert.deepEqual(errors,[])
}
