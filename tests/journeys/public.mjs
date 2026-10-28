import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {on,once} from 'node:events'
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {client} from './kit/http.mjs'

const root=fileURLToPath(new URL('../..',import.meta.url))
async function withRuntime(options,body){const runtime=await createRuntime(options);let success=false;try{await body(runtime,client(runtime.origin));success=true}finally{await runtime.close(success)}}

test('the site serves its documentation, branded 404s, legacy resource redirects and local assets, and nothing retired',async()=>{
 await withRuntime({},async(runtime,{request,call})=>{
  const html=await (await request('/')).text()
  assert.match(html,/HappyToHelp/i);assert.doesNotMatch(html,/<h1>Foundation<\/h1>/)
  assert.equal((await call('/api/identity/session')).status,401);assert.equal((await call('/api/management/bootstrap')).status,401)
  assert.equal((await call('/api/identity/local-owner-session',{body:{},headers:{Origin:runtime.origin,'Sec-Fetch-Site':'same-origin'}})).status,404)
  const tenant=await runtime.seedTenant({name:'Retired routes',email:'synthetic-happytohelp-retired@example.test',allowedOrigin:runtime.origin}),billing=`/api/management/projects/${tenant.projectId}/billing`
  for(const [path,method] of [[billing,'GET'],[billing+'/top-up','POST'],[billing+'/setup','POST'],[billing+'/portal','POST'],[billing+'/automated','PUT'],[billing+'/toggle','POST'],['/api/management/webhooks/stripe','POST']])assert.equal((await call(path,{method,body:method==='GET'?undefined:{},token:tenant.token})).status,404)
  for(const path of ['/health/extra','/api','/api/this-route-does-not-exist'])assert.equal((await call(path)).status,404)

  for(const route of ['/projects','/login','/setup','/docs','/docs/install'])assert.ok(html.includes(`href="${route}"`),route)
  assert.doesNotMatch(html,/waitlist|pricing|widget\.js|stripe|<\?php|@extends\(/i)
  assert.doesNotMatch(html,/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"]*\.(?:woff2?|css|js)\b/i,'no third-party font, stylesheet or script')
  for(const font of ['/fonts/outfit/outfit-latin-wght-normal.woff2','/fonts/outfit/outfit-latin-ext-wght-normal.woff2']){const response=await request(font);assert.equal(response.status,200,font);assert.match(response.headers.get('content-type')||'',/font\/woff2/,font)}
  for(const asset of html.matchAll(/(?:src|href)="(\/(?:site-assets|homepage)\/[^"?]+)/g))assert.equal((await request(asset[1])).status,200,asset[1])
  for(const [path,title] of [['/docs','HappyToHelp'],['/docs/install','Install HappyToHelp']]){const docs=await request(path);assert.equal(docs.status,200,path);assert.match(docs.headers.get('content-type')||'',/^text\/html/);const page=await docs.text();assert.match(page,new RegExp(`<h1[^>]*class="docs-title"[^>]*>${title}</h1>`),path);assert.match(page,/class="h2h-home h2h-docs"/,path)}
  for(const path of ['/docs/does-not-exist','/docs/Install']){const missing=await request(path);assert.equal(missing.status,404,path);assert.match(await missing.text(),/<title>Page not found · HappyToHelp<\/title>/,path)}
  for(const path of ['/marketing','/pricing','/waitlist','/features/sales','/company/terms','/demo?website=https://example.com'])assert.equal((await request(path)).status,404,path)
  assert.equal((await request('/waitlist',{method:'POST',raw:true,body:new URLSearchParams({email:'removed@example.invalid'})})).status,404)
  // Retained legacy widget documentation addresses land on their documented anchors.
  for(const page of ['install','widget-hash','javascript-api','javascript-options','values','safety']){
   const response=await request(`/resources/${page}`);assert.equal(response.status,308,page);assert.equal(response.headers.get('location'),`/docs/legacy-entry-points#${page}`,page)
   const destination=await request(response.headers.get('location'));assert.equal(destination.status,200,page);assert.ok((await destination.text()).includes(`id="${page}"`),'documentation anchor '+page)
  }
  for(const path of ['/this-page-does-not-exist','/foo/bar/baz','/does-not-exist','/admin/x/y/z']){
   const notFound=await request(path),page=await notFound.text();assert.equal(notFound.status,404,path);assert.match(notFound.headers.get('content-type')||'',/^text\/html/,path)
   assert.match(page,/<title>Page not found · HappyToHelp<\/title>/,path);assert.match(page,/<a [^>]*href="\/"[^>]*>Back to the homepage<\/a>/,path);assert.match(page,/<a [^>]*href="\/projects"[^>]*>Open your workspace<\/a>/,path)
  }
  for(const path of ['/help/no-such-project','/help/no-such-project/no-such-article','/help/a/b/c']){const missing=await request(path);assert.equal(missing.status,404,path);assert.match(missing.headers.get('content-type')||'',/^text\/html/,path);assert.match(await missing.text(),/data-help-center-nav/,path)}
  const api=await request('/api/public-site/nothing');assert.equal(api.status,404);assert.match(api.headers.get('content-type')||'',/^text\/plain/)
 })
})

test('a published help center: Markdown rendered safely, complete summary search paging, retained aliases and configured hosts, and drafts, other workspaces and deleted ones indistinguishable from missing',async()=>{
 const slug='retained-help-slug'
 await withRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',PUBLIC_HELP_HOSTS:JSON.stringify({localhost:slug,'127.0.0.1':slug})}},async(runtime,{request})=>{
  const helpOrigin=new URL(runtime.origin);helpOrigin.hostname='localhost'
  const host=path=>fetch(new URL(path,helpOrigin))
  assert.equal((await host('/')).status,404,'a configured host with an unknown project exposes no center')
  const tenant=await runtime.seedTenant({name:'Retained support',email:'retained-help@example.test',allowedOrigin:runtime.origin}),other=await runtime.seedTenant({name:'Other support',email:'other-help@example.test',allowedOrigin:runtime.origin})
  const signIn=/href="[^"]*\?access=signin/
  const edit=async(path,body,method='POST')=>{const response=await request(`/api/knowledge/${tenant.projectId}/${path}`,{body,method,token:tenant.token});assert.ok(response.ok,await response.clone().text());return response.json()}
  await edit('categories',{title:'Public guides'})
  // The legacy importer retains aliases in this table; native identity stays separate.
  await runtime.execute(`INSERT INTO public_project_aliases(slug,project_id) VALUES('${slug}','${tenant.projectId}'); INSERT INTO public_project_aliases(slug,project_id) VALUES('docs','${tenant.projectId}'); INSERT INTO public_project_aliases(slug,project_id) VALUES('survey','${tenant.projectId}')`)
  const publish=async(owner,body)=>{const response=await request(`/api/knowledge/${owner.projectId}/articles`,{body:{summary:'retained support guide',content:'Retained instructions.',status:'published',...body},token:owner.token});assert.equal(response.status,201,await response.text())}
  await publish(tenant,{slug:'retained-guide',title:'retained-guide'})
  await publish(tenant,{slug:'formatted',title:'Formatted',content:'# Hello\n\n**Knowledge** <script>alert(1)</script>'})
  await publish(tenant,{slug:'signin',title:'Sign-in instructions',content:'Retained customer sign-in instructions.'})
  await publish(tenant,{slug:'private-guide',title:'private-guide',content:'Secret draft',summary:'violet lantern',status:'draft'})
  await publish(other,{slug:'foreign-guide',title:'foreign-guide',content:'Other project',summary:'violet lantern'})
  for(let i=0;i<18;i++)await publish(tenant,{slug:`guide-${i}`,title:`Guide ${String(i).padStart(2,'0')}`,content:'Instructions for your account.',summary:'violet lantern'})
  for(const base of [`/${tenant.projectId}`,`/${slug}`,`/help/${slug}`])for(const tail of ['','/','/search?keyword=retained','/retained-guide']){
   const response=await request(base+tail),html=await response.text();assert.equal(response.status,200,base+tail);assert.ok(html.includes(`action="${base}/search"`),'search stays on the retained path')
   assert.doesNotMatch(html,signIn,'a public-only collection needs no sign-in link')
   assert.match(html,/class="help-center-controls"/,'customer request controls are available on every retained help path')
   assert.ok(html.includes(`href="/help/${tenant.projectId}/requests"`),'request form entry stays in this workspace')
   assert.ok(html.includes(`href="/portal/${tenant.projectId}/requests"`),'customer portal entry stays in this workspace')
   if(!tail||tail.startsWith('/search'))assert.ok(html.includes(`href="${base}/retained-guide"`),'article links retain their entry path')
  }
  const article=await (await request(`/${slug}/formatted`)).text();assert.match(article,/<strong>Knowledge<\/strong>/);assert.doesNotMatch(article,/<script>alert/)
  assert.match(await (await request(`/${slug}/signin`)).text(),/Retained customer sign-in instructions/)
  assert.match(await (await request('/survey/retained-guide')).text(),/Retained instructions/)
  assert.equal((await request(`/${slug}?access=signin`)).status,200)
  const secret=await (await request(`/${tenant.projectId}/search?keyword=Secret`)).text();assert.match(secret,/0 results found/);assert.doesNotMatch(secret,/Secret draft/)
  // Summary-only matches use the same publication and workspace fences and page boundaries as title and body matches.
  const links=html=>[...html.matchAll(new RegExp(`<h4><a href="/${slug}/([^"]+)">`,'g'))].map(match=>match[1])
  const first=await (await request(`/${slug}/search?keyword=violet%20lantern`)).text(),nextHref=first.match(/<a href="([^"]+)">Next<\/a>/)?.[1].replaceAll('&amp;','&');assert.ok(nextHref,'summary matches offer the next page')
  const next=await (await request(nextHref)).text();assert.deepEqual([...links(first),...links(next)].sort(),Array.from({length:18},(_,i)=>`guide-${i}`).sort(),'every owned published summary match appears once across pages')
  assert.doesNotMatch(next,/>Next<\/a>/);assert.match(next,/>Previous<\/a>/);assert.deepEqual(links(await (await request(`/${slug}/search?keyword=violet%20lantern&page=100`)).text()),[])
  // Drafts, another workspace's article and a never-written one are byte-identical HTML 404s in the help frame.
  const missing=await request(`/${tenant.projectId}/never-written`),draft=await request(`/${tenant.projectId}/private-guide`),foreign=await request(`/${tenant.projectId}/foreign-guide`)
  for(const response of [missing,draft,foreign]){assert.equal(response.status,404);assert.match(response.headers.get('content-type')||'',/^text\/html/)}
  const missingHtml=await missing.text();assert.equal(await draft.text(),missingHtml);assert.equal(await foreign.text(),missingHtml)
  assert.match(missingHtml,/data-help-center-nav/);assert.match(missingHtml,/type="search"/);assert.match(missingHtml,/name="robots" content="noindex"/);assert.doesNotMatch(missingHtml,/Secret draft|private-guide|never-written/)
  assert.equal((await request(`/api/public-site/projects/${tenant.projectId}/alias`,{method:'PUT',body:{slug:'new-slug'}})).status,401,'aliases change only with authority')
  // /docs is the site's documentation; an older alias named docs stays reachable at /help/docs.
  assert.match(await (await request('/docs')).text(),/class="h2h-home h2h-docs"/);assert.equal((await request('/help/docs')).status,200)
  for(const path of ['/','/search?keyword=retained','/retained-guide']){const html=await (await host(path)).text();assert.ok(html.includes('action="/search"'),'host search stays at its root');assert.ok(html.includes('class="help-center-brand" href="/"'),'host brand returns to its root');if(path!=='/retained-guide')assert.ok(html.includes('href="/retained-guide"'))}
  assert.equal((await fetch(new URL('/retained-guide',helpOrigin),{method:'HEAD'})).status,200)
  for(const path of ['/private-guide','/foreign-guide','/missing-guide'])assert.equal((await host(path)).status,404,path)
  for(const path of ['/','/run']){const response=await request(path,{headers:{Forwarded:'host=localhost','X-Forwarded-Host':'localhost','X-Original-Host':'localhost'}});if(path==='/')assert.equal(response.status,200);assert.ok(response.status<500);assert.doesNotMatch(await response.text(),/data-help-center-nav/,'forwarded headers cannot replace the application origin')}
  const privateApi=await host('/api/management/projects');assert.equal(privateApi.status,401,'a help host does not turn a private API into public knowledge')
  // The same public doors apply audiences, reviewed locales, templates and old slugs.
  const members=await edit('categories',{title:'Customer articles',audience:'signed-in'})
  const helpPaths=[`/${slug}`,`/help/${tenant.projectId}`,`/${slug}/search?keyword=retained`,`/${slug}/retained-guide`]
  for(const path of helpPaths)assert.match(await (await request(path)).text(),signIn,'a restricted collection offers sign-in before it has articles')
  assert.match(await (await host('/')).text(),signIn)
  assert.doesNotMatch(await (await request(`/${other.projectId}`)).text(),signIn,'another workspace cannot add a sign-in link')
  await edit(`categories/${members.id}/audience`,{is_published:false},'PUT')
  assert.doesNotMatch(await (await request(`/${slug}`)).text(),signIn,'unpublished restricted collections offer no customer access or sign-in entry')
  await edit(`categories/${members.id}/audience`,{audience:'public',is_published:true},'PUT')
  assert.doesNotMatch(await (await request(`/${slug}`)).text(),signIn,'making the last restricted collection public removes sign-in')
  await edit('articles',{slug:'collection-publication',title:'Collection publication',summary:'',content:'Visible while its collection is published.',status:'published',categoryIds:[members.id]})
  assert.equal((await request(`/${slug}/collection-publication`)).status,200)
  await edit(`categories/${members.id}/audience`,{is_published:false},'PUT')
  const unpublished=await request(`/${slug}/collection-publication`),publicationMiss=await request(`/${slug}/missing-publication`)
  assert.equal(unpublished.status,404);assert.equal(await unpublished.text(),await publicationMiss.text(),'an article in an unpublished collection is indistinguishable from a miss')
  assert.equal((await request(`/api/knowledge/public/${tenant.projectId}/articles/collection-publication`)).status,404)
  await edit(`categories/${members.id}/audience`,{is_published:true},'PUT')
  assert.equal((await request(`/${slug}/collection-publication`)).status,200,'republishing its collection restores the same article')
  await edit(`categories/${members.id}/audience`,{audience:'signed-in'},'PUT')
  await edit('articles',{slug:'customer-only',title:'Customer-only instructions',content:'Private collection content',status:'published',categoryIds:[members.id]})
  for(const path of [`/${slug}`,`/${slug}/search?keyword=Private%20collection`])assert.doesNotMatch(await (await request(path)).text(),/Private collection content|Customer-only instructions/)
  const hidden=await request(`/${slug}/customer-only`),absent=await request(`/${slug}/absent-private`);assert.equal(hidden.status,404);assert.equal(await hidden.text(),await absent.text())
  const articles=await (await request(`/api/knowledge/${tenant.projectId}/articles`,{token:tenant.token})).json(),formatted=articles.find(a=>a.slug==='formatted')
  await edit('experience',{defaultLocale:'en',locales:['en','fr'],templates:{article:'Customer guide: {{title}}\n{{content}}\nContact the support team if you need help.'}},'PUT')
  const languageSettings=await request(`/api/knowledge/${other.projectId}/experience`,{token:other.token,method:'PUT',body:{defaultLocale:'en',locales:['en','fr']}});assert.equal(languageSettings.status,200)
  const publicLanguages=await (await request(`/${other.projectId}?locale=fr`)).text()
  assert.match(publicLanguages,/<select[^>]+name="locale"/);assert.doesNotMatch(publicLanguages,signIn,'public-only centres retain their language controls')
  await edit(`articles/${formatted.id}/translations/fr`,{title:'Premiers pas',content:'Instructions relues pour votre compte.',summary:'Bien commencer',reviewStatus:'reviewed'},'PUT')
  const french=await request(`/${slug}/formatted?locale=fr`),frenchHtml=await french.text();assert.equal(french.status,200);assert.match(frenchHtml,/<html lang="fr"/);assert.match(frenchHtml,/Instructions relues/);assert.match(frenchHtml,/Customer guide: Premiers pas/);assert.match(frenchHtml,/Was this helpful\?/);assert.match(french.headers.get('cache-control'),/private, no-store/)
  await edit(`articles/${formatted.id}/translations/fr`,{title:'Not approved',content:'Unreviewed replacement',summary:'Draft',reviewStatus:'draft'},'PUT')
  const reviewed=await (await request(`/${slug}/formatted?locale=fr`)).text();assert.match(reviewed,/Instructions relues/);assert.doesNotMatch(reviewed,/Unreviewed replacement/)
  const feedback=await request(`/api/knowledge/public/${tenant.projectId}/articles/formatted/helpful`,{raw:true,body:new URLSearchParams({helpful:'yes',comment:'Clear steps',locale:'fr',returnTo:`/${slug}/formatted?locale=fr`})});assert.equal(feedback.status,303);assert.equal(new URL(feedback.headers.get('location'),runtime.origin).pathname,`/${slug}/formatted`);assert.match(await (await request(feedback.headers.get('location'))).text(),/Thank you for your feedback/)
  await edit('articles',{...formatted,slug:'formatted-current'})
  const redirect=await request(`/${slug}/formatted`);assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),`/${slug}/formatted-current`);assert.match(await (await request(`/${slug}/formatted-current`)).text(),/Knowledge/)
  assert.equal((await request(`/api/management/projects/${tenant.projectId}`,{method:'DELETE',token:tenant.token})).status,200)
  for(const address of [new URL('/',helpOrigin),new URL('/search?keyword=retained',helpOrigin),new URL('/retained-guide',helpOrigin),new URL(`/${slug}`,runtime.origin),new URL(`/help/${slug}/retained-guide`,runtime.origin)]){const response=await fetch(address);assert.equal(response.status,404,'deleted workspace '+address.pathname);assert.doesNotMatch(await response.text(),/retained-guide|Retained instructions/)}
  // The same configuration can name a native workspace id directly.
  await runtime.execute(`DELETE FROM public_project_aliases WHERE slug='${slug}'; INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('${slug}','Direct native help','direct-native-help','https://example.test',1); INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('direct-guide','${slug}','direct-guide','Direct native guide','Native instructions.','published',1)`)
  for(const path of ['/','/search?keyword=Native','/direct-guide'])assert.equal((await host(path)).status,200,'configured native id '+path)
 })
})

test('the documentation build refuses broken links and unlisted Markdown, escapes raw HTML, and a running dev server follows edits, additions and removals without a restart',{timeout:120000},async({signal})=>{
 const {readManifest}=await import('../../src/ui/docs/build/manifest.ts'),{buildSite}=await import('../../src/ui/docs/build/site.ts'),{docsSite}=await import('../../src/ui/docs/build/plugin.ts')
 // This repository: every Markdown file at the root, under docs/ or a top-level README is published or GitHub-only, and the site builds clean.
 const manifest=readManifest(root),listed=new Set([...manifest.pages,...manifest.githubOnly].map(entry=>entry.source))
 const inScope=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--','*.md'],{cwd:root,encoding:'utf8'}).split('\n').filter(file=>/^([^/]+\.md|docs\/.+\.md|[^./][^/]*\/README\.md)$/.test(file))
 assert.ok(inScope.includes('README.md'));assert.deepEqual(inScope.filter(file=>!listed.has(file)),[],'add each to docs/site.json, as a page or GitHub-only with a reason')
 const site=buildSite(root);assert.deepEqual(site.problems,[]);assert.equal(site.pages.length,manifest.pages.length)
 const fixture=await realpath(await mkdtemp(join(tmpdir(),'h2h-docs-')))
 try{
  await mkdir(join(fixture,'docs'))
  const page=(slug,source,label='Label')=>({slug,source,label}),manifestOf=(pages,githubOnly=[])=>JSON.stringify({sections:[{title:'Guide',pages}],githubOnly})
  const files={'package.json':JSON.stringify({repository:{url:'https://github.com/just-every/run-happytohelp'}}),'docs/site.json':manifestOf([page('','README.md','Home'),page('guide','docs/GUIDE.md','Guide')],[{source:'NOTES.md',reason:'Maintainer notes'}]),'README.md':'# Fixture\n\nRead [the second part](docs/GUIDE.md#second). Hello <script>alert(1)</script> <img src=x onerror=alert(1)>\n','docs/GUIDE.md':'# Guide\n\n## Second\n','NOTES.md':'# Notes\n\n## Kept\n'}
  for(const [path,text] of Object.entries(files))await writeFile(join(fixture,path),text)
  // Invalid manifests are refused: home not first, reserved or uppercase slugs, duplicates, missing sources, reasonless GitHub-only entries.
  for(const invalid of [manifestOf([page('guide','docs/GUIDE.md'),page('','README.md')]),manifestOf([page('','README.md'),page('index','docs/GUIDE.md')]),manifestOf([page('','README.md'),page('Guide','docs/GUIDE.md')]),manifestOf([page('','README.md'),page('guide','docs/GUIDE.md'),page('guide','NOTES.md')]),manifestOf([page('','README.md'),page('guide','docs/MISSING.md')]),manifestOf([page('','README.md')],[{source:'NOTES.md',reason:' '}]),manifestOf([page('','README.md')],[{source:'GONE.md',reason:'Stale'}])]){await writeFile(join(fixture,'docs/site.json'),invalid);assert.throws(()=>readManifest(fixture),invalid)}
  await writeFile(join(fixture,'docs/site.json'),files['docs/site.json'])
  const built=buildSite(fixture);assert.deepEqual(built.problems,[]);assert.doesNotMatch(built.pages[0].html,/<script|<img/);assert.match(built.pages[0].html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  await writeFile(join(fixture,'README.md'),'# Fixture\n\n[bad](docs/GUIDE.md#third) [gone](NOTES.md#lost) [missing](docs/MISSING.md) [self](#nowhere) [js](javascript:alert(1)) ![External](https://example.com/a.png)\n')
  assert.deepEqual(buildSite(fixture).problems,['README.md: docs/MISSING.md (docs/MISSING.md does not exist)','README.md: javascript:alert(1) (unsupported link scheme)','README.md: https://example.com/a.png (images must be files in docs/media/)','README.md: #third (no such heading in docs/GUIDE.md)','README.md: #lost (no such heading in NOTES.md)','README.md: #nowhere (no such heading in README.md)'])
  await writeFile(join(fixture,'README.md'),files['README.md'])
  // vite dev: the docs plugin in a running server over the fixture, its loader evaluated once and kept fresh.
  const server=await createServer({root:fixture,configFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,ws:false,watch:{usePolling:true,interval:100}},plugins:[docsSite()]})
  const sent=[];for(const environment of Object.values(server.environments)){const send=environment.hot.send.bind(environment.hot);environment.hot.send=(payload,...rest)=>{sent.push({environment:environment.name,...payload});return send(payload,...rest)}}
  const errors=()=>sent.filter(payload=>payload.type==='error'),reloaded=()=>[...new Set(sent.filter(payload=>payload.type==='full-reload').map(payload=>payload.environment))]
  const observe=async(event,path)=>{for await(const [file] of on(server.watcher,event,{signal}))if(file===join(fixture,path))return}
  const until=async(check,label)=>{const deadline=Date.now()+5000;for(;;){try{return await check()}catch(error){if(Date.now()>deadline)throw new Error(`${label} within 5 s: ${error.message}`)}await new Promise(done=>setTimeout(done,100))}}
  try{
   if(!server.watcher._readyEmitted)await once(server.watcher,'ready',{signal})
   const pageModule=async slug=>(await server.ssrLoadModule(`virtual:happytohelp-docs/page/${slug}`)).default,index=()=>server.ssrLoadModule('virtual:happytohelp-docs')
   const {loadDocsPage}=await server.ssrLoadModule(join(root,'src/ui/docs/load.ts'))
   assert.match((await pageModule('index')).html,/<a href="\/docs\/guide#second">the second part<\/a>/)
   const firstLoad=await loadDocsPage('guide');assert.match(firstLoad.page.html,/<h2 id="second">Second<\/h2>/)
   const changed=observe('change','docs/GUIDE.md');await writeFile(join(fixture,'docs/GUIDE.md'),'# Guide\n\n## Second\n\n## Third\n');await changed
   await until(async()=>assert.match((await pageModule('guide')).html,/<h2 id="third">Third<\/h2>/),'an edited page is served')
   const edited=await loadDocsPage('guide');assert.ok(edited.version>firstLoad.version,'the docs version moves on with the edit');assert.equal((await index()).version,edited.version)
   const broke=observe('change','README.md');await writeFile(join(fixture,'README.md'),'# Fixture\n\nRead [the missing part](docs/MISSING.md).\n');await broke
   await until(async()=>{const error=await pageModule('index').then(()=>null,rejection=>rejection);assert.ok(error);assert.match(error.message,/README\.md: docs\/MISSING\.md/)},'a broken link is reported')
   assert.match((await index()).problem,/README\.md: docs\/MISSING\.md/,'the index still loads for routes that do not show docs');await assert.rejects(loadDocsPage('guide'),/README\.md: docs\/MISSING\.md/)
   const added=[observe('add','docs/THIRD.md'),observe('change','docs/site.json')]
   await writeFile(join(fixture,'README.md'),files['README.md']);await writeFile(join(fixture,'docs/THIRD.md'),'# Third page\n');await writeFile(join(fixture,'docs/site.json'),manifestOf([page('','README.md','Home'),page('guide','docs/GUIDE.md','Guide'),page('third','docs/THIRD.md','Third')],[{source:'NOTES.md',reason:'Maintainer notes'}]));await Promise.all(added)
   await until(async()=>assert.deepEqual((await loadDocsPage('third')).sections[0].pages.map(entry=>entry.href),['/docs','/docs/guide','/docs/third']),'a page added to docs/site.json is listed');assert.equal((await index()).problem,null)
   // A docs folder removed with its Markdown is dropped, not served from the cache, and sends no error.
   const subAdded=[observe('add','docs/sub/PAGE.md'),observe('change','docs/site.json')];await mkdir(join(fixture,'docs/sub'));await writeFile(join(fixture,'docs/sub/PAGE.md'),'# Sub page\n\n## Inside\n');await writeFile(join(fixture,'docs/site.json'),manifestOf([page('','README.md','Home'),page('sub','docs/sub/PAGE.md','Sub')],[{source:'NOTES.md',reason:'Maintainer notes'},{source:'docs/GUIDE.md',reason:'Kept'},{source:'docs/THIRD.md',reason:'Kept'}]));await Promise.all(subAdded)
   await until(async()=>assert.match((await loadDocsPage('sub')).page.html,/<h2 id="inside">Inside<\/h2>/),'the added folder is served');await until(async()=>assert.deepEqual(reloaded(),['client']),'the addition reloads the browser')
   sent.length=0;const subRemoved=[observe('unlink','docs/sub/PAGE.md'),observe('unlinkDir','docs/sub')];await rm(join(fixture,'docs/sub'),{recursive:true,force:true});await Promise.all(subRemoved)
   await until(async()=>assert.deepEqual(reloaded(),['client']),'the browser reloads when a docs folder is removed');assert.deepEqual(errors(),[])
   assert.match((await index()).problem??'',/docs\/sub\/PAGE\.md" does not exist/);await assert.rejects(loadDocsPage('sub'),/docs\/sub\/PAGE\.md" does not exist/)
  }finally{await server.close()}
 }finally{await rm(fixture,{recursive:true,force:true})}
})
