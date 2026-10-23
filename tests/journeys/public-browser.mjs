import {domainsBrowserJourney} from '../helpers/knowledge/domains-browser.mjs'
import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {assertHelpLinksReadable} from '../helpers/help-center-link-contrast.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'

const root=fileURLToPath(new URL('../..',import.meta.url))
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const retainedSlug='retained-browser-help'
let runtime,browser,success=true,fixture,requestForm,accents=[]
before(async()=>{
 runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',PUBLIC_HELP_HOSTS:JSON.stringify({localhost:retainedSlug,'second.localhost':'second-browser-help'})}});browser=await launchBrowser()
 fixture=await runtime.seedTenant({name:'Help Center Fixture',email:'help-center-fixture@example.test',allowedOrigin:runtime.origin})
 await runtime.execute(`INSERT INTO public_project_aliases(slug,project_id) VALUES('${retainedSlug}','${fixture.projectId}')`)
 const write=async(tenant,path,body)=>{const response=await fetch(runtime.origin+path,{method:'POST',headers:{Authorization:`Bearer ${tenant.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await response.text();assert.equal(response.status,201,`${path}: ${text}`);return JSON.parse(text)}
 const category=await write(fixture,`/api/knowledge/${fixture.projectId}/categories`,{name:'Getting started',slug:'getting-started',summary:'Set up your workspace and answer common questions.'})
 const nested=await write(fixture,`/api/knowledge/${fixture.projectId}/categories`,{name:'Account access',slug:'account-access',parentId:category.id,summary:'Sign in and manage access.'})
 await write(fixture,`/api/knowledge/${fixture.projectId}/articles`,{slug:'quick-start',title:'Quick start',summary:'Create a workspace and invite your team.',content:'# Quick start\n\nFollow these steps to **get started** with your workspace. Read [sign in](/help) next.',status:'published',categoryIds:[category.id]})
 await write(fixture,`/api/knowledge/${fixture.projectId}/articles`,{slug:'sign-in',title:'Sign in',summary:'Recover access to your account.',content:'Use the sign-in page to access your account.',status:'published',categoryIds:[nested.id]})
 await write(fixture,`/api/knowledge/${fixture.projectId}/articles`,{slug:'uncategorized',title:'Contact support',summary:'Get help from the team.',content:'Send the team a message when you need more help.',status:'published'})
 await write(fixture,`/api/knowledge/${fixture.projectId}/articles`,{slug:'webhooks-draft',title:'Webhooks and the API',summary:'Draft',content:'Draft',status:'draft'})
 const formResponse=await fetch(`${runtime.origin}/api/forms/projects/${fixture.projectId}/forms`,{method:'POST',headers:{Authorization:`Bearer ${fixture.token}`,'Content-Type':'application/json'},body:JSON.stringify({title:'Ask support',description:'Tell us what went wrong.',locale:'en',enabled:true,fields:[]})});assert.equal(formResponse.status,201);requestForm=(await formResponse.json()).data
 await fetch(`${runtime.origin}/api/knowledge/${fixture.projectId}/experience`,{method:'PUT',headers:{Authorization:`Bearer ${fixture.token}`,'Content-Type':'application/json'},body:JSON.stringify({defaultLocale:'en',locales:['en'],templates:{request:'Before request {{title}}\n{{content}}\nAfter request'}})}).then(response=>assert.equal(response.status,200))
 // Light, mid and dark configured brand colours: help links must stay readable on white whatever the brand.
 for(const color of ['#ffffff','#fff3a3','#777777','#204b3a']){const tenant=await runtime.seedTenant({name:'Accent '+color,email:`accent-${color.slice(1)}@example.test`,allowedOrigin:runtime.origin});await runtime.execute(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('${tenant.projectId}','{"primary_color":"${color}"}',1) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json`);await write(tenant,`/api/knowledge/${tenant.projectId}/articles`,{slug:'guide',title:'Guide',summary:'A guide.',content:'Read the [guide](https://example.test/guide).',status:'published'});accents.push({color,projectId:tenant.projectId})}
})
after(async()=>{await browser?.close();await runtime?.close(success)})
const axe=async page=>{if(!(await page.evaluate(()=>Boolean(window.axe))))await page.addScriptTag({path:axePath});return page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`))}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)
async function guarded(body){try{await body()}catch(error){success=false;throw error}}

for(const [label,viewport] of Object.entries(viewports))test(`a published help center at ${viewport.width}px: native, retained and host addresses, search to article and back, readable brand links and framed 404s that hide drafts`,async()=>guarded(async()=>{
 const shot=await evidence('help-center'),context=await browser.newContext({viewport}),page=await context.newPage(),failures=[]
 page.on('requestfailed',request=>failures.push(request.url()));page.on('response',response=>{if(response.status()>=400&&['stylesheet','image','font','script'].includes(response.request().resourceType()))failures.push(response.url())})
 const hostOrigin=new URL(runtime.origin);hostOrigin.hostname='localhost'
 try{
  for(const route of [{path:`/${fixture.projectId}`,text:'Getting started'},{path:`/${fixture.projectId}/search?keyword=workspace`,text:'Quick start'},{path:`/${fixture.projectId}/quick-start`,text:'Quick start'},{path:`/${retainedSlug}/`,text:'Getting started'},{path:`/${retainedSlug}/quick-start`,text:'Quick start'},{origin:hostOrigin,path:'/',text:'Getting started'},{origin:hostOrigin,path:'/search?keyword=workspace',text:'Quick start'}]){
   failures.length=0;const response=await page.goto(new URL(route.path,route.origin||runtime.origin).href,{waitUntil:'domcontentloaded'});assert.equal(response?.status(),200,route.path)
   await page.getByText(route.text,{exact:true}).first().waitFor();assert.ok(await page.locator('input[type="search"]').count());assert.ok(await noOverflow(page),route.path);assert.deepEqual(failures,[],route.path)
  }
  await page.screenshot({path:shot(label+'-index.png'),fullPage:true})
  for(const entry of [{origin:runtime.origin,base:`/${fixture.projectId}`},{origin:runtime.origin,base:`/${retainedSlug}`},{origin:hostOrigin,base:''}]){
   const home=new URL(entry.base||'/',entry.origin).href;await page.goto(home,{waitUntil:'domcontentloaded'})
   await page.locator('input[type="search"]').fill('workspace');await page.getByRole('button',{name:'Search'}).click();await page.waitForURL(new URL(`${entry.base}/search?keyword=workspace`,entry.origin).href)
   const analytics=await fetch(`${runtime.origin}/api/knowledge/${fixture.projectId}/analytics`,{headers:{Authorization:`Bearer ${fixture.token}`}});assert.equal(analytics.status,200)
   const priorClicks=(await analytics.json()).totals.clicks
   await page.getByRole('link',{name:'Quick start',exact:true}).click();await page.waitForURL(new URL(`${entry.base}/quick-start`,entry.origin).href)
   // A host-root link loads a new document, so observe the saved click rather than its old document's fetch response.
   await page.waitForFunction(async({projectId,token,priorClicks})=>{const response=await fetch(`/api/knowledge/${projectId}/analytics`,{headers:{Authorization:`Bearer ${token}`}});return response.ok&&(await response.json()).totals.clicks===priorClicks+1},{projectId:fixture.projectId,token:fixture.token,priorClicks},{polling:100,timeout:5000})
   await page.locator('.help-center-brand').click();await page.waitForURL(home);await page.getByText('Getting started',{exact:true}).first().waitFor()
  }
  await page.goto(`${runtime.origin}/${fixture.projectId}/quick-start`);await assertHelpLinksReadable(page)
  for(const accent of accents){await page.goto(`${runtime.origin}/${accent.projectId}/guide`);await assertHelpLinksReadable(page)}
  await page.goto(`${runtime.origin}/help/${fixture.projectId}/quick-start`)
  await page.getByRole('link',{name:'Submit a request',exact:true}).click()
  assert.match(page.url(),/afterReading=[a-f0-9-]{36}/)
  await page.getByRole('heading',{name:'Ask support',exact:true}).waitFor()
  assert.match(await page.locator('.help-center-content').innerText(),/Before request Ask support/)
  assert.match(await page.locator('#customer-request').getAttribute('data-after-reading'),/^[a-f0-9-]{36}$/)
  assert.ok(await noOverflow(page),'request form fits the viewport')
  await page.screenshot({path:shot(label+'-request-template.png'),fullPage:true})
  // Help Center 404s: HTML in the help frame; a draft looks exactly like a missing article.
  const pages={}
  for(const [id,path,known] of [['missing article',`/help/${fixture.projectId}/nope`,true],['unpublished draft',`/help/${fixture.projectId}/webhooks-draft`,true],['unknown project','/help/does-not-exist',false],['unroutable','/help/a/b/c',false]]){
   const response=await page.goto(runtime.origin+path,{waitUntil:'networkidle'});assert.equal(response.status(),404,id);assert.match(response.headers()['content-type'],/^text\/html/)
   assert.equal(await page.locator('[data-help-center-nav]').count(),1,id);assert.equal(await page.locator('input[type="search"]').count(),known?1:0,id)
   assert.equal(await page.locator('.help-center-content a').getAttribute('href'),known?`/help/${fixture.projectId}`:'/',id);assert.ok(await noOverflow(page),id);assert.deepEqual(await axe(page),[],id)
   if(known)assert.equal(await page.locator('.help-center-lockup, .help-center-brand svg').count(),0,'a workspace page carries only its own brand')
   pages[id]=await (await fetch(runtime.origin+path)).text()
  }
  assert.equal(pages['unpublished draft'],pages['missing article'],'a draft is indistinguishable from a missing article')
  await page.screenshot({path:shot(label+'-404.png'),fullPage:true})
  await domainsBrowserJourney({runtime,browser,fixture,viewport,shot})
 }finally{await context.close()}
}))

// The H1 and h2 sequence of a Markdown file as written, outside fenced code.
function headings(source){let fenced=false;const lines=readFileSync(join(root,source),'utf8').split('\n').filter(line=>{if(/^\s*(```|~~~)/.test(line))fenced=!fenced;return !fenced});const text=line=>line.replace(/^#+\s+/,'').replace(/`/g,'').trim();return {h1:text(lines.find(line=>/^# /.test(line))),h2:lines.filter(line=>/^## /.test(line)).map(text)}}

for(const [label,viewport] of Object.entries(viewports))test(`the documentation and the application 404 at ${viewport.width}px: every manifest page renders its Markdown with working links and pager, keyboard reachable and accessible, and every way back works`,async()=>guarded(async()=>{
 const {readManifest}=await import('../../src/ui/docs/build/manifest.ts'),pages=readManifest(root).pages,repository=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).repository.url
 const shot=await evidence('docs'),context=await browser.newContext({viewport}),page=await context.newPage(),external=[],errors=[],fetched=new Map()
 page.on('request',request=>{if(!request.url().startsWith(runtime.origin)&&!request.url().startsWith('data:'))external.push(request.url())});page.on('pageerror',error=>errors.push(error.message))
 const open=async path=>{const response=await page.goto(runtime.origin+path,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);return response}
 const fetchPage=async path=>{if(!fetched.has(path)){const response=await fetch(runtime.origin+path);fetched.set(path,{status:response.status,html:await response.text()})}return fetched.get(path)}
 const desktop=viewport.width>=861
 try{
  for(const [index,entry] of pages.entries()){
   const response=await open(entry.href);assert.equal(response.status(),200,entry.href)
   const {h1,h2}=headings(entry.source)
   assert.deepEqual(await page.locator('h1').allTextContents(),[h1],`${entry.href} h1 is the Markdown H1`);assert.deepEqual((await page.locator('.docs-prose h2').allTextContents()).map(text=>text.trim()),h2,`${entry.href} h2s in order`)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),`${entry.href} overflow`)
   assert.deepEqual(await page.getByRole('navigation',{name:'Documentation'}).evaluateAll(navs=>navs.map(nav=>nav.className)),[desktop?'docs-sidebar':'docs-menu'],`${entry.href} one Documentation navigation`)
   assert.deepEqual(await axe(page),[],`${entry.href} axe at ${viewport.width}px`)
   if(!desktop)continue
   assert.deepEqual(await page.locator('.docs-sidebar a[aria-current="page"]').allTextContents(),[entry.label],`${entry.href} current page`)
   assert.equal(await page.locator('a[rel="prev"]').count()?await page.locator('a[rel="prev"]').getAttribute('href'):null,pages[index-1]?.href??null,`${entry.href} previous`)
   assert.equal(await page.locator('a[rel="next"]').count()?await page.locator('a[rel="next"]').getAttribute('href'):null,pages[index+1]?.href??null,`${entry.href} next`)
   assert.equal(await page.getByRole('link',{name:'Edit this page on GitHub'}).getAttribute('href'),`${repository}/edit/main/${entry.source}`)
   const markdown=readFileSync(join(root,entry.source),'utf8')
   for(const href of await page.locator('.docs-prose a, .docs-toc a, .docs-toc-compact a').evaluateAll(links=>links.map(link=>link.getAttribute('href')))){
    if(href.startsWith('/docs')){const [path,hash]=href.split('#'),target=await fetchPage(path);assert.equal(target.status,200,`${entry.href}: ${href}`);if(hash)assert.ok(target.html.includes(`id="${hash}"`),`${entry.href}: ${href} anchor`)}
    else if(href.startsWith('#'))assert.ok(await page.evaluate(id=>Boolean(document.getElementById(id)),decodeURIComponent(href.slice(1))),`${entry.href}: ${href}`)
    else if(href.startsWith(`${repository}/`)&&!markdown.includes(href)){const match=new RegExp(`^${repository}/(blob|tree)/main/([^#]+)`).exec(href);assert.ok(match&&existsSync(join(root,match[2])),`${entry.href}: ${href}`)}
    else assert.match(href,/^(https?:|mailto:)/,`${entry.href}: ${href}`)
   }
  }
  if(desktop){
   await open('/docs/security');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to the content');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'docs-content')
   await open('/docs/operations');await page.locator('.docs-toc').getByRole('link',{name:'Contact erasure',exact:true}).click();await page.waitForFunction(()=>location.hash==='#contact-erasure')
   await page.waitForFunction(()=>{const top=document.getElementById('contact-erasure').getBoundingClientRect().top;return top>=0&&top<=80},null,{timeout:5000})
   await open('/');await page.locator('.hero-copy').getByRole('link',{name:'Read the docs'}).click();await page.waitForURL(`${runtime.origin}/docs`)
   await open('/');await page.getByRole('link',{name:'Read the installation guide'}).click();await page.waitForURL(`${runtime.origin}/docs/install`)
  }else{
   await open('/docs');for(let tab=0;tab<12&&!(await page.evaluate(()=>document.activeElement.matches('.docs-menu summary')));tab++)await page.keyboard.press('Tab')
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.docs-menu summary')),'Tab reaches the Docs menu');await page.keyboard.press('Enter');assert.equal(await page.locator('.docs-menu details').evaluate(details=>details.open),true,'Enter opens the Docs menu')
   await page.screenshot({path:shot(label+'-menu-open.png')})
  }
  assert.deepEqual(external,[],'the docs make no third-party request');assert.deepEqual(errors,[])
  for(const path of ['/docs/does-not-exist','/docs/Install','/docs/index','/docs/a/b','/this-page-does-not-exist','/foo/bar/baz']){
   const response=await open(path);assert.equal(response.status(),404,path);assert.equal(await page.title(),'Page not found · HappyToHelp',path);assert.equal(await page.locator('h1').innerText(),'Page not found.',path)
   assert.equal(await page.getByRole('link',{name:'Back to the homepage'}).getAttribute('href'),'/');assert.equal(await page.getByRole('link',{name:'Open your workspace'}).getAttribute('href'),'/projects')
   assert.ok(await noOverflow(page),path);assert.deepEqual(await axe(page),[],path)
  }
  await page.screenshot({path:shot(label+'-app-404.png'),fullPage:true})
  await page.getByRole('link',{name:'Back to the homepage'}).click();await page.waitForURL(runtime.origin+'/')
  await open('/nothing/here');await page.getByRole('link',{name:'Open your workspace'}).click();await page.waitForURL(url=>!url.pathname.includes('nothing'))
  const slash=await open('/docs/');assert.equal(slash.status(),200);assert.match(new URL(page.url()).pathname,/^\/docs\/?$/)
  for(const path of ['/docs','/docs/install','/docs/operations']){await open(path);await page.screenshot({path:shot(`${path.slice(1).replace(/\//g,'-')}-${label}.png`),fullPage:true})}
 }finally{await context.close()}
}))
