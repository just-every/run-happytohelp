import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'
import {audit as inspect} from '../../first-run/browser-kit.mjs'
import {publicEntry} from './public.mjs'

export async function onboarding() {
 const runtime=await createRuntime(),browser=await launchBrowser(),shot=await evidence('onboarding')
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[]
 let passed=false
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
 const audit=(page,name)=>inspect(page,shot(''),name)
 const owner={email:'synthetic-happytohelp-1@example.test',password:randomBytes(24).toString('base64url')}
 try {
  await publicEntry({page,origin:runtime.origin,audit})
  await page.getByLabel('Your email',{exact:true}).fill(owner.email)
  await page.getByLabel('Password',{exact:true}).fill(owner.password)
  await page.getByLabel('Your website',{exact:true}).fill(runtime.origin)
  const creation=page.waitForResponse(r=>r.url().endsWith('/api/identity/bootstrap')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();assert.equal((await creation).status(),201)
  await page.waitForURL(/\/projects\/[^/]+\/activation$/)
  const projectId=new URL(page.url()).pathname.split('/')[2],base=`${runtime.origin}/projects/${projectId}`
  const request=async(path,body,method=body===undefined?'GET':'POST')=>{
   const response=await context.request.fetch(runtime.origin+path,{method,...(body===undefined?{}:{data:body})})
   assert.ok(response.ok(),`${method} ${path}: ${response.status()}`);return response.json()
  }
  await page.locator('[data-testid="setup-list"][data-applicable]').waitFor()
  await page.waitForFunction(()=>document.querySelector('[data-testid="setup-list"] [data-again]')?.disabled===false)
  // Skipping is stored by the server and never masquerades as observed setup.
  const skip=page.locator('[data-need="model_key"] button[data-skip]')
  await skip.click();await page.locator('[data-skipped="model_key"]').waitFor()
  await page.reload();await page.locator('[data-skipped="model_key"]').waitFor()
  assert.equal(await page.locator('[data-skipped="model_key"] [data-state="confirmed"]').count(),0)
  await page.locator('[data-skipped="model_key"] button[data-undo]').click();await skip.waitFor()
  await audit(page,'setup')
  const assistants=(await request(`/api/management/projects/${projectId}/ais`)).data
  assert.ok(assistants.length,'setup provisions a starter assistant')
  await page.goto(base+'/edit');await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click()
  const brand='Orchid Care',greeting='Welcome to Orchid. How can we help?'
  await page.getByLabel('Public brand name',{exact:true}).fill(brand)
  await page.getByLabel('Welcome greeting',{exact:true}).fill(greeting)
  await page.getByLabel('Workspace color hex').fill('#204b3a')
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.reload();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click()
  assert.equal(await page.getByLabel('Welcome greeting',{exact:true}).inputValue(),greeting)
  await page.goto(base+'/articles/create')
  const title='Replacing a damaged order',summary='Arrange a replacement for an order damaged in transit.',content='Contact our team with the order number to arrange a replacement.'
  await page.getByLabel('Title',{exact:true}).fill(title);await page.getByLabel('Summary',{exact:true}).fill(summary);await page.getByLabel('Article content in Markdown',{exact:true}).fill(content)
  const articleCreation=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/${projectId}/articles`&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  const createdArticle=await articleCreation;assert.equal(createdArticle.status(),201)
  const {id:articleId}=await createdArticle.json();assert.ok(articleId)
  await page.waitForURL(url=>url.pathname===`/projects/${projectId}/articles/${articleId}`)
  let article=(await request(`/api/knowledge/${projectId}/articles`)).find(row=>row.id===articleId)
  assert.equal(article.status,'draft');assert.equal(article.summary,summary)
  const visitor=await browser.newContext({viewport:{width:1440,height:900}}),help=await visitor.newPage()
  try {
   assert.equal((await help.goto(`${runtime.origin}/help/${projectId}/${article.slug}`)).status(),404,'draft is not public')
   await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('status').locator('strong').filter({hasText:/^Published$/}).waitFor()
   await page.reload();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),title)
   article=(await request(`/api/knowledge/${projectId}/articles`)).find(row=>row.id===articleId);assert.equal(article.status,'published')
   await help.goto(`${runtime.origin}/help/${projectId}`);await help.locator('input[type="search"]').fill('damaged');await help.getByRole('button',{name:'Search',exact:true}).click()
   await help.getByRole('link',{name:title,exact:true}).click();await help.getByText(content,{exact:false}).waitFor()
   assert.ok(new URL(help.url()).pathname.endsWith('/'+article.slug));await audit(help,'published-help')
   await page.goto(base+'/widget-settings');await page.getByRole('heading',{name:'Install the widget',exact:false}).waitFor()
   await page.locator('.widget-code__snippet pre').first().focus();assert.ok(await page.locator('.widget-code__snippet pre').first().evaluate(el=>el===document.activeElement))
   await page.locator('.widget-code__advanced > summary').click();await page.getByRole('button',{name:'Reveal server secret'}).waitFor()
   await page.getByRole('tab',{name:'Theme',exact:true}).click();await page.locator('#happytohelp').getByText(greeting,{exact:true}).waitFor()
   await audit(page,'widget-preview')
   const project=await request(`/api/identity/projects/${projectId}`)
   await help.addScriptTag({url:runtime.origin+'/widget.js'});await help.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}}})
   await help.getByText(greeting,{exact:true}).last().waitFor()
   await help.locator('textarea[name=content]').fill('My order arrived damaged');await help.locator('button[name=submit]').click();await help.getByText('My order arrived damaged',{exact:true}).waitFor()
   await audit(help,'installed-widget')
  } finally {await visitor.close()}
  // A second workspace uses the same native identity and leads with installation.
  await page.goto(runtime.origin+'/projects/create');await page.getByLabel('Name',{exact:true}).fill('Second support team')
  await page.getByLabel('Website',{exact:true}).fill(runtime.origin);await page.getByLabel('Widget website origin',{exact:true}).fill(runtime.origin)
  await page.getByRole('button',{name:'Create project',exact:true}).click();await page.waitForURL(/\/widget-settings$/)
  assert.notEqual(new URL(page.url()).pathname.split('/')[2],projectId)
  await page.getByRole('heading',{name:'Install the widget',exact:false}).waitFor()
  await page.goto(base+'/activation');await page.locator('[data-testid="setup-list"]').waitFor();assert.deepEqual(errors,[])
  passed=true
 } finally {await browser.close();await runtime.close(passed)}
}
