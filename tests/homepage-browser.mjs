import assert from 'node:assert/strict'
import {auditPage,viewports} from './journeys/kit/browser.mjs'
import {freeProductPromise} from './helpers/homepage/free-browser.mjs'
import {supportDesk,moveInInvitation,closingAndFooter} from './helpers/homepage/desk-browser.mjs'
import {see} from './helpers/homepage/visual.mjs'

async function publishedSections({page,shot}){
 const sections=page.getByRole('main').locator(':scope > section'),footer=page.getByRole('contentinfo')
 const headings=['Not just better. Free.','The rest of your support desk','Try it beside what you have','Ready when you are.']
 assert.equal(await sections.first().getByRole('heading',{level:1}).count(),1,'the hero opens the published section sequence')
 assert.deepEqual(await sections.locator('h2').allTextContents(),headings,'the visitor encounters Free, desk, move-in and closing in their published order')
 const positions=await sections.evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,heading:node.querySelector('h1,h2').getBoundingClientRect().top})))
 assert.ok(positions.every((position,index)=>!index||position.top>positions[index-1].top&&position.heading>positions[index-1].heading),'the visible sections and headings follow the published reading order')
 assert.ok((await footer.boundingBox()).y>=positions.at(-1).bottom,'the footer follows the closing section')
 const headerBrand=page.getByRole('banner').getByRole('link',{name:'HappyToHelp',exact:true})

 await freeProductPromise({page,section:sections.nth(1)})
 await sections.nth(1).screenshot({path:shot('homepage-free-1440.png')})
 await see(page,page.locator('.divider').nth(0))
 await supportDesk({page,section:sections.nth(2)})
 await sections.nth(2).screenshot({path:shot('homepage-desk-1440.png')})
 await see(page,page.locator('.divider').nth(1))
 const guide=await moveInInvitation({page,section:sections.nth(3)})
 await sections.nth(3).screenshot({path:shot('homepage-move-in-1440.png')})
 await closingAndFooter({page,section:sections.nth(4),headerBrand,footer})
 await sections.nth(4).screenshot({path:shot('homepage-closing-1440.png')})
 return guide
}

async function noPromotions(page,source){
 const text=await page.locator('.h2h-home').innerText()
 assert.doesNotMatch(text,/[$£€¥]\s*\d|\b(?:USD|AUD|EUR|GBP)\s*\d|\b(?:pricing|price|paid plans?|premium plans?|per[- ](?:seat|month|year)|(?:monthly|annual) (?:billing|subscription)|buy now)\b/i,'the page carries no price or paid-plan claim')
 assert.doesNotMatch(text,/\b(?:hosting|hosted|self[- ]host(?:ed|ing)?|Cloudflare|Vercel|Netlify|AWS|Amazon Web Services|Azure|Heroku|DigitalOcean)\b/i,'the page carries no hosting claim or hosting promotion')
 assert.doesNotMatch(text,/\b(?:providers?|OpenAI|Anthropic|OpenRouter|Cohere|Mistral|Groq|Gemini API)\b|\b(?:powered|sponsored|backed) by\b|\b(?:try|choose|buy|subscribe to) (?:Codex|Claude)\b/i,'the page carries no provider promotion')
 assert.doesNotMatch(text,/\brun[\s-]*edit[\s-]*run\b|\b(?:sponsors?|sponsorship|affiliate|advertisement|advertising)\b|\b(?:also|you should) (?:try|visit|use)\b/i,'the page carries no unrelated-service promotion')
 const repository=new URL(await source.getAttribute('href'))
 for(const link of await page.locator('.h2h-home a[href]').all()){
  const destination=new URL(await link.getAttribute('href'),page.url())
  if(destination.origin===new URL(page.url()).origin)continue
  assert.ok(destination.origin===repository.origin&&(destination.pathname===repository.pathname||destination.pathname.startsWith(repository.pathname+'/')),'outbound homepage links stay with the offered source and its licence, without unrelated-service promotions')
 }
}

export async function homepageJourney({page,origin,shot}){
 const errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.setViewportSize(viewports.desktop)
 const response=await page.goto(origin+'/')
 assert.equal(response.status(),200)
 await page.getByRole('heading',{level:1}).waitFor()
 const source=page.locator('.hero-copy').getByRole('link',{name:'Get the code',exact:true})
 assert.match(await source.getAttribute('href'),/^https:\/\/github\.com\//)
 const guide=await publishedSections({page,shot})
 await noPromotions(page,source)
 await auditPage(page,shot('homepage-1440.png'))
 await page.setViewportSize(viewports.mobile)
 await auditPage(page,shot('homepage-390.png'))
 await page.setViewportSize(viewports.desktop)
 // Follow the move-in invitation as well as the hero's documentation route.
 await guide.click()
 await page.waitForURL(origin+'/docs/install')
 await page.locator('.docs-prose pre').first().waitFor()
 await page.goto(origin+'/')
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
