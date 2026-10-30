import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {appendFile,cp,mkdtemp,mkdir,readFile,readdir,rm,symlink,unlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {build,createServer} from 'vite'
import {pathToFileURL} from 'node:url'
import {auditPage} from '../journeys/kit/browser.mjs'

// The public journey's actual verification command. It validates the real docs builder and
// the retained manifest coverage policy; negative cases run this command against disposable trees.
export async function verifyDocs(root){
 const manifest=JSON.parse(await readFile(join(root,'docs/site.json'),'utf8'))
 const listed=new Set([...manifest.sections.flatMap(s=>s.pages),...manifest.githubOnly].map(p=>p.source))
 const markdown=[]
 async function walk(directory){
  for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
   const path=directory?directory+'/'+entry.name:entry.name
   if(entry.isDirectory())await walk(path)
   else if(entry.name.endsWith('.md'))markdown.push(path)
  }
 }
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(entry.isFile()&&entry.name.endsWith('.md'))markdown.push(entry.name)
  if(entry.isDirectory()&&!entry.name.startsWith('.')&&entry.name!=='node_modules'){
   if(entry.name==='docs')await walk('docs')
   else{try{await readFile(join(root,entry.name,'README.md'));markdown.push(entry.name+'/README.md')}catch(e){if(e.code!=='ENOENT')throw e}}
  }
 }
 assert.deepEqual(markdown.filter(path=>!listed.has(path)),[],'unlisted Markdown must be published or explicitly GitHub-only')
 const server=await createServer({root:resolve(new URL('../..',import.meta.url).pathname),configFile:false,server:{middlewareMode:true,ws:false,host:'127.0.0.1'},appType:'custom'})
 try{
  const {buildSite}=await server.ssrLoadModule('/src/ui/docs/build/site.ts')
  const site=buildSite(root)
  assert.deepEqual(site.problems,[],'broken Markdown links and anchors fail verification')
  return site
 }finally{await server.close()}
}

const execute=promisify(execFile),root=resolve(new URL('../..',import.meta.url).pathname)
const normalize=value=>value.replace(/\s+/g,' ').trim()
const css=(locator,key)=>locator.evaluate((node,key)=>getComputedStyle(node)[key],key)
async function emittedDocs(page,origin,site){
 const order=site.sections.flatMap(section=>section.pages)
 for(const [index,expected] of site.pages.entries()){
  const response=await page.goto(origin+expected.href)
  assert.equal(response.status(),200,expected.source)
  for(const header of ['content-security-policy','x-content-type-options','referrer-policy'])assert.ok(response.headers()[header],'docs security header '+header)
  assert.equal(await page.locator('h1').count(),1);assert.equal(normalize(await page.locator('h1').innerText()),normalize(expected.title))
  const actual=await page.locator('.docs-prose').evaluate((node,html)=>{
   const document=new DOMParser().parseFromString(html,'text/html'),normal=s=>s.replace(/\s+/g,' ').trim()
   return {body:normal(node.textContent),source:normal(document.body.textContent),headings:[...node.querySelectorAll('h2')].map(n=>[n.id,n.textContent]),expected:[...document.querySelectorAll('h2')].map(n=>[n.id,n.textContent]),links:[...node.querySelectorAll('a')].map(n=>n.getAttribute('href')),expectedLinks:[...document.querySelectorAll('a')].map(n=>n.getAttribute('href'))}
  },expected.html)
  assert.equal(actual.body,actual.source,'built page body matches current Markdown: '+expected.source)
  assert.deepEqual(actual.headings,actual.expected,'built heading sequence and GitHub-compatible ids: '+expected.source)
  assert.deepEqual(actual.links,actual.expectedLinks,'published links become docs routes, other repository files become GitHub links')
  assert.equal(await page.locator('.docs-prose [style],.docs-prose script,.docs-prose [onclick],.docs-prose [onerror]').count(),0,'escaped HTML and class-only highlighting')
  for(const table of await page.locator('.docs-table').all()){assert.equal(await table.getAttribute('role'),'region');assert.equal(await table.getAttribute('tabindex'),'0');assert.ok(await table.getAttribute('aria-label'))}
  const nav=page.locator('.docs-sidebar')
  assert.ok(await nav.isVisible(),'desktop section navigation')
  assert.deepEqual(await nav.locator('.docs-nav-section').allTextContents(),site.sections.map(s=>s.title))
  assert.deepEqual(await nav.locator('a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')).filter(href=>href.startsWith('/docs'))),order.map(p=>p.href))
  assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),expected.href)
  assert.equal(await page.locator('.docs-source a').getAttribute('href'),site.repository.url+'/edit/'+site.repository.branch+'/'+expected.source)
  assert.deepEqual(await page.locator('.docs-pager [rel="prev"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),order[index-1]?[order[index-1].href]:[])
  assert.deepEqual(await page.locator('.docs-pager [rel="next"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),order[index+1]?[order[index+1].href]:[])
  if(expected.toc.filter(h=>h.depth===2).length>=2){
   assert.ok(await page.locator('.docs-toc').isVisible())
   assert.deepEqual(await page.locator('.docs-toc a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),expected.toc.map(h=>'#'+h.id))
  }
  assert.equal(await css(page.locator('.docs-prose'),'fontSize'),'17px')
  assert.match(await css(page.locator('.docs-prose'),'fontFamily'),/^Outfit/)
  if(await page.locator('.docs-prose code').count())assert.match(await css(page.locator('.docs-prose code').first(),'fontFamily'),/monospace/)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'docs fit viewport: '+expected.source)
 }
}

async function temporaryBuild(){
 const directory=await mkdtemp(join(tmpdir(),'h2h-public-docs-')),command=join(root,'tests/helpers/public-docs-journey.mjs')
 const run=()=>execute(process.execPath,[command,directory],{cwd:root,maxBuffer:16*1024*1024})
 const {stdout}=await execute('git',['ls-files','-z'],{cwd:root,maxBuffer:4*1024*1024})
 for(const file of stdout.split('\0').filter(Boolean)){const target=join(directory,file);await mkdir(dirname(target),{recursive:true});await cp(join(root,file),target)}
 try{
  await run()
  const unlisted=join(directory,'docs/unlisted-public-proof.md')
  await writeFile(unlisted,'# Unlisted public proof\n')
  await assert.rejects(run(),error=>error.code===1&&error.stderr.includes('unlisted Markdown'),'actual verification command refuses an unlisted file')
  await unlink(unlisted)
  await appendFile(join(directory,'README.md'),'\n[Broken public link](docs/no-such-public-page.md)\n')
  await assert.rejects(run(),error=>error.code===1&&error.stderr.includes('does not exist'),'actual verification command refuses broken links')
  await cp(join(root,'README.md'),join(directory,'README.md'))
  // A fresh real Vite docs build must read changed Markdown, never a checked-in snapshot.
  const marker='Current source reached the public documentation build.'
  await appendFile(join(directory,'README.md'),'\n'+marker+'\n')
  await writeFile(join(directory,'public-docs-proof.mjs'),"export * from 'virtual:happytohelp-docs'\n")
  const server=await createServer({root,configFile:false,server:{middlewareMode:true,ws:false,host:'127.0.0.1'},appType:'custom'})
  try{
   const {docsSite}=await server.ssrLoadModule('/src/ui/docs/build/plugin.ts')
   const output=await build({root:directory,configFile:false,logLevel:'silent',plugins:[docsSite()],build:{write:false,minify:false,lib:{entry:join(directory,'public-docs-proof.mjs'),formats:['es']}}})
   const chunks=(Array.isArray(output)?output:[output]).flatMap(o=>o.output).filter(o=>o.type==='chunk')
   assert.ok(chunks.some(chunk=>chunk.code.includes(marker)),'every build consumes the current source')
  }finally{await server.close()}
  // Exercise the routes' own loader on the real docs dev plugin, without restarting it.
  await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir')
  const source=await readFile(join(directory,'README.md'),'utf8'),manifestPath=join(directory,'docs/site.json')
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
  const pluginHost=await createServer({root,configFile:false,server:{middlewareMode:true,ws:false,host:'127.0.0.1'},appType:'custom'})
  let dev
  try{
   const {docsSite}=await pluginHost.ssrLoadModule('/src/ui/docs/build/plugin.ts')
   dev=await createServer({root:directory,configFile:false,plugins:[docsSite()],server:{middlewareMode:true,ws:false,host:'127.0.0.1'},appType:'custom'})
   const {loadDocsPage}=await dev.ssrLoadModule('/src/ui/docs/load.ts')
   assert.ok((await loadDocsPage('')).page.html.includes(marker))
   const change=async edit=>{
    const hot=dev.environments.client.hot,send=hot.send
    const reload=new Promise(resolve=>{hot.send=function(...args){send.apply(this,args);if(args[0]?.type==='full-reload'){hot.send=send;resolve()}}})
    await edit();await reload
   }
   await change(()=>appendFile(join(directory,'README.md'),'\nCurrent source is served without a restart.\n'))
   assert.ok((await loadDocsPage('')).page.html.includes('Current source is served without a restart.'))
   await change(()=>appendFile(join(directory,'README.md'),'\n[Broken dev link](docs/missing-dev-proof.md)\n'))
   await assert.rejects(loadDocsPage(''),/does not exist/,'dev docs alone report a broken source link')
   // The plugin only intercepts its virtual docs modules: an unrelated module still loads.
   assert.ok((await dev.ssrLoadModule('/src/ui/homepage/repository.ts')).sourceUrl)
   await change(()=>writeFile(join(directory,'README.md'),source))
   const folder=join(directory,'docs/public-dev-proof');await mkdir(folder)
   await writeFile(join(folder,'page.md'),'# Added current page\n\nNew manifest content.\n')
   manifest.sections[0].pages.push({slug:'public-dev-proof',source:'docs/public-dev-proof/page.md',label:'Public dev proof'})
   await change(()=>writeFile(manifestPath,JSON.stringify(manifest)))
   assert.equal((await loadDocsPage('public-dev-proof')).page.title,'Added current page')
   await change(()=>rm(folder,{recursive:true}))
   await assert.rejects(loadDocsPage('public-dev-proof'),/does not exist/,'removing a listed folder reports its absence')
   manifest.sections[0].pages.pop()
   await change(()=>writeFile(manifestPath,JSON.stringify(manifest)))
   assert.ok((await loadDocsPage('')).page.html.includes(marker),'removing an unrelated folder leaves docs working')
   await assert.rejects(loadDocsPage('public-dev-proof'),error=>error.isNotFound===true)
  }finally{await dev?.close();await pluginHost.close()}
 }finally{await rm(directory,{recursive:true,force:true})}
}

export async function publicDocsJourney({page,origin,shot,repository}){
 const site=await verifyDocs(root)
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.setViewportSize({width:1440,height:900})
 await emittedDocs(page,origin,site)
 await temporaryBuild()
 // Detailed documentation surface: semantic landmarks, brand, measure, code, contents and keyboard navigation.
 const operations=await page.goto(origin+'/docs/operations')
 const bytes=(await operations.body()).byteLength
 console.log('PUBLIC_PROOF operations raw HTML bytes='+bytes)
 if(bytes>160*1024)console.log('PUBLIC_FINDING PUBLIC-005: operations raw HTML exceeds the retained 160 KB budget; no page changed; Gap remains open')
 const bodyText=await page.locator('.docs-prose > p').first().innerText()
 for(const entry of await page.locator('script[type="module"][src]').all()){
  const url=new URL(await entry.getAttribute('src'),origin),code=await (await page.request.get(url.href)).text()
  assert.ok(!code.includes(bodyText),'page body is absent from the client entry')
 }
 assert.equal(await page.getByRole('banner').count(),1);assert.equal(await page.getByRole('main').count(),1);assert.equal(await page.getByRole('contentinfo').count(),1)
 assert.equal(await page.locator('.site-header nav [aria-current]').getAttribute('href'),'/docs')
 assert.equal(await css(page.locator('.site-header nav [aria-current]'),'textDecorationColor'),'rgb(90, 216, 236)')
 assert.equal(await page.locator('.site-header .brand').innerHTML(),await page.locator('.site-footer .brand').innerHTML())
 const measure=await page.locator('.docs-prose > p').first().evaluate(node=>{const s=getComputedStyle(node),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=s.font;return node.getBoundingClientRect().width/context.measureText('0').width})
 console.log('PUBLIC_PROOF operations prose measure='+measure+'ch')
 if(measure<55||measure>80)console.log('PUBLIC_FINDING PUBLIC-005: operations prose measure falls outside retained 55–80 characters; no page changed; Gap remains open')
 for(const link of await page.locator('.docs-toc a').all()){
  const href=await link.getAttribute('href');assert.equal(await page.locator('[id="'+href.slice(1)+'"]').count(),1,'contents links reach real headings')
 }
 await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').getAttribute('href'),'#docs-content')
 await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'docs-content')
 const contents=page.locator('.docs-toc a').first();await contents.focus();await page.keyboard.press('Enter')
 assert.equal(new URL(page.url()).hash,await contents.getAttribute('href'))
 await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:'instant'})})
 await auditPage(page,shot('approved-docs-1440.png'))
 // Phone proof exercises the menu and contents controls once without another assertion matrix.
 await page.setViewportSize({width:390,height:900});await page.goto(origin+'/docs/operations')
 const menu=page.locator('.docs-menu summary');await menu.focus();await page.keyboard.press('Enter')
 await page.locator('.docs-menu').getByRole('link',{name:'Install',exact:true}).click()
 await page.waitForURL(origin+'/docs/install')
 const compact=page.locator('.docs-toc-compact summary');await compact.focus();await page.keyboard.press('Enter')
 await page.locator('.docs-toc-compact a').first().focus();await page.keyboard.press('Enter')
 await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:'instant'})})
 await auditPage(page,shot('approved-docs-390.png'))
 await page.setViewportSize({width:1440,height:900})
 const home=await page.goto(origin+'/docs/');assert.equal(home.status(),200);assert.equal(new URL(page.url()).pathname,'/docs')
 for(const path of ['/docs/missing-public-proof','/docs/INSTALL','/docs/install/deeper']){
  const response=await page.goto(origin+path);assert.equal(response.status(),404)
  assert.ok(await page.getByRole('link',{name:'Back to the homepage',exact:true}).isVisible())
  assert.ok(await page.getByRole('link',{name:'HappyToHelp',exact:true}).count()>0)
  assert.ok(response.headers()['content-security-policy'],'404 retains security headers')
 }
 assert.equal(site.repository.url,repository)
 console.log('PUBLIC_PROOF docs pages='+site.pages.length+' sections='+site.sections.length+'; all current built bodies, headings, links, navigation and source destinations checked')
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const site=await verifyDocs(resolve(process.argv[2]||'.'));console.log(JSON.stringify(site))}
 catch(error){console.error(error.message);process.exitCode=1}
}
