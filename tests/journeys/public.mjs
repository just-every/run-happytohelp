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
   const response=await request(base+tail),html=await response.text();assert.equal(response.status,200,base+tail);assert.equal(response.headers.get('referrer-policy'),'same-origin',base+tail);assert.ok(html.includes(`action="${base}/search"`),'search stays on the retained path')
   assert.doesNotMatch(html,signIn,'a public-only collection needs no sign-in link')
   assert.match(html,/class="help-center-controls"/,'customer request controls are available on every retained help path')
   assert.ok(html.includes(`href="/help/${tenant.projectId}/requests${tail==='/retained-guide'?'?afterReading=':'"'}`),'request form entry stays in this workspace and carries a receipt only from an article')
   assert.ok(html.includes(`href="/portal/${tenant.projectId}/requests"`),'customer portal entry stays in this workspace')
   if(!tail||tail.startsWith('/search'))assert.ok(html.includes(`href="${base}/retained-guide"`),'article links retain their entry path')
  }
  const formResponse=await request(`/api/forms/projects/${tenant.projectId}/forms`,{token:tenant.token,body:{title:'Ask support',description:'Tell us what went wrong.',locale:'en',enabled:true,fields:[]}})
  assert.equal(formResponse.status,201);const form=(await formResponse.json()).data
  await edit('experience',{defaultLocale:'en',locales:['en'],templates:{request:'Before request {{title}}\n{{content}}\nAfter request'}},'PUT')
  const article=await (await request(`/${slug}/formatted`)).text();
  const requestLink=article.match(/href="([^"]*requests\?afterReading=[^"]+)"/)[1].replaceAll('&amp;','&')
  const choose=await (await request(requestLink)).text()
  assert.match(choose,/Before request Ask support/);assert.match(choose,/After request/);assert.match(choose,/data-after-reading="[a-f0-9-]{36}"/)
  const directForm=await (await request(`/help/${tenant.projectId}/requests/${form.id}`)).text();assert.match(directForm,/Before request Ask support/);assert.match(directForm,/id="customer-request"/)
  assert.match(article,/<strong>Knowledge<\/strong>/);assert.doesNotMatch(article,/<script>alert/)
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
  assert.equal((await request('/docs')).status,200);assert.equal((await request('/help/docs')).status,200)
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
