import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {createSites} from '../site-read-sites.mjs'

// The one-time read of a new workspace's website, from its creation through the queued job and the scheduler, on the
// real application. Only the network is faked: DNS-over-HTTPS and the websites themselves (helpers/site-read-sites).
export async function siteReadJourney(){
 let app
 const sites=createSites({
  // The owner edits the name, and the scheduler gives up on the read, while the site is still being read.
  async onHome(host){
   if(host!=='racy.example.com')return
   const {id}=await app.first("SELECT id FROM projects WHERE allowed_origin='https://racy.example.com'")
   await app.db.batch([app.db.prepare("UPDATE projects SET name='Typed by the owner' WHERE id=?").bind(id),app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.site_read.state','uncertain') WHERE project_id=?").bind(id)])
  },
 })
 app=await startApp({captureQueue:true,bindings:{H2H_SETUP_TOKEN:'synthetic-site-read-setup-token',RATE_LIMITS:JSON.stringify({projectsPerAccountDay:100,projectsPerIpDay:100})},outbound:request=>sites.handler(request)})
 try{
  const settingsOf=async project=>JSON.parse((await app.first('SELECT settings_json FROM project_settings WHERE project_id=?',project)).settings_json)
  const readOf=async project=>(await settingsOf(project)).site_read
  const nameOf=async project=>(await app.first('SELECT name FROM projects WHERE id=?',project)).name
  // What the read leaves behind: the workspace's private knowledge source (what the assistant searches), and no article.
  const datasets=project=>app.sql('SELECT d.id,d.name,d.url,d.status,d.published_version,d.refresh_mode,d.next_refresh_at,d.source_input,v.semantic,v.embedding_model FROM knowledge_datasets d LEFT JOIN knowledge_versions v ON v.id=d.published_version WHERE d.project_id=?',project)
  const documents=project=>app.sql('SELECT f.url,f.title,f.content FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE d.project_id=? ORDER BY f.title',project)
  const articleCount=async project=>(await app.first('SELECT count(*) n FROM knowledge_articles WHERE project_id=?',project)).n
  const nothingWritten=async(project,why)=>{
   assert.equal((await datasets(project)).length,0,`${why}: no source`)
   assert.equal((await app.first('SELECT count(*) n FROM knowledge_documents f JOIN knowledge_versions v ON v.id=f.version_id JOIN knowledge_datasets d ON d.id=v.dataset_id WHERE d.project_id=?',project)).n,0,`${why}: no document`)
   assert.equal(await articleCount(project),0,`${why}: no article`)
  }
  const settle=async project=>app.until(async()=>{const state=(await readOf(project))?.state;return state&&state!=='queued'&&state!=='running'&&readOf(project)},{timeout:15000,message:`site read for ${project}`})
  // The first owner claims the installation for the Acme website; every later workspace is created by that owner.
  const owner=(await app.call('/api/identity/bootstrap',{body:{email:'owner@acme.example.com',password:'synthetic-site-read-owner-password-123',allowedOrigin:'https://acme.example.com',setupToken:'synthetic-site-read-setup-token'},status:201})).data
  const queued=new Map()
  const take=async()=>{for(const job of await app.takeJobs())if(job.type==='site.read')queued.set(job.projectId,job)}
  const create=async(origin,name='Acme Example')=>{const id=(await app.call('/api/management/projects',{token:owner.token,body:{name,allowed_origin:origin},status:201})).data.id;await take();assert.ok(queued.has(id),'creation queues the read');return id}
  const run=async project=>{await app.runJobs([queued.get(project)]);return settle(project)}
  const knowledge=(project,path,init={})=>app.call(`/api/knowledge/${project}${path}`,{token:owner.token,...init})
  const scheduled=async()=>{await app.scheduled();await take()}

  // The page set and its limits, written as one private knowledge source and no article, by a read that respects robots and the origin.
  await take();const acme=owner.projectId,done=await run(acme)
  assert.equal(done.state,'done')
  const [source,...others]=await datasets(acme)
  assert.equal(others.length,0,'exactly one knowledge source')
  assert.deepEqual([source.status,source.refresh_mode,source.semantic,source.embedding_model,source.next_refresh_at,source.source_input],['ready','manual',0,null,null,null],'a lexical source nothing refreshes')
  assert.equal(source.url,'https://acme.example.com');assert.ok(source.published_version&&source.name,'published, with a name')
  const pages=await documents(acme)
  assert.deepEqual(pages.map(page=>page.title),['Frequently asked questions','Getting started','Moved page','Shipping and returns']);assert.equal(done.pages,4)
  assert.ok(pages.every(page=>page.url.startsWith('https://acme.example.com/')&&page.title&&page.content),'same-origin https pages with a title and content')
  const body=pages.find(page=>page.title==='Getting started').content
  assert.ok(body.includes('## Next steps')&&body.includes('- Check your order number.')&&!body.includes('Navigation')&&!body.includes('Copyright'),'page text is the body, without navigation or footer')
  assert.equal(await articleCount(acme),0,'no article of any status is written')
  const acmeRequests=sites.siteRequests()
  assert.ok(acmeRequests.every(r=>r.host==='acme.example.com'),'no request leaves the origin')
  assert.ok(acmeRequests.every(r=>!r.headers.cookie&&!r.headers.authorization),'no cookie or authorization header')
  assert.ok(acmeRequests.every(r=>/HappyToHelp-Site-Reader/.test(r.headers['user-agent'])),'identifying User-Agent')
  const paths=acmeRequests.map(r=>r.path)
  assert.deepEqual(paths.slice(0,2),['/robots.txt','/'],'robots first, then home')
  assert.ok(!paths.some(p=>p.startsWith('/private/')),'robots.txt disallow respected')
  assert.ok(paths.includes('/help/new-page'),'a same-origin redirect is followed')
  assert.ok(!paths.includes('/help/nav-only')&&!paths.includes('/blog/post-1')&&!paths.some(p=>p.endsWith('.pdf')),'only help-like pages')
  assert.ok(sites.requests.filter(r=>r.kind==='dns').every(r=>r.host==='acme.example.com'),'DNS is checked for the origin only')
  assert.ok(sites.requests.some(r=>r.kind==='dns'),'DNS was verified as public before reading')

  // The assistant can answer from it: lexical search (the mode search_knowledge uses) cites the page, with no model key,
  // embedding provider, crawler or file store configured, and without a request to anyone but the website.
  const found=(await knowledge(acme,'/search?q=frequently',{status:200})).data
  assert.equal(found.mode,'lexical');assert.deepEqual(found.citations.map(citation=>citation.url),['https://acme.example.com/faq']);assert.equal(found.citations[0].title,'Frequently asked questions')
  assert.equal((await knowledge(acme,'/search?q=quasar-unrelated-word')).data.citations.length,0)
  assert.deepEqual((await knowledge(acme,'/datasets')).data.map(row=>row.id),[source.id])
  assert.deepEqual((await knowledge(acme,`/datasets/${source.id}/pages`)).data.map(page=>page.title).sort(),pages.map(page=>page.title))
  assert.deepEqual((await knowledge(acme,'/articles')).data,[],'no draft or published article')
  assert.deepEqual((await app.call(`/api/knowledge/public/${acme}/articles`)).data,[],'the public help routes list nothing')
  assert.deepEqual((await app.call(`/api/knowledge/public/${acme}/search?q=frequently`,{status:200})).data,[],'the public help routes find nothing')
  assert.ok(sites.requests.every(r=>r.host==='acme.example.com'),'nothing but the website was asked, search included')
  // Name and colour replaced while still the values setup derived.
  assert.equal(await nameOf(acme),'Acme Widgets & Co');assert.equal((await settingsOf(acme)).primary_color,'#1a7f64');assert.deepEqual([done.name,done.colour],['Acme Widgets & Co','#1a7f64'])

  // Once only: a duplicate delivery and the scheduler read nothing and write nothing.
  const before=sites.requests.length
  await app.runJobs([queued.get(acme)]);await scheduled()
  assert.equal(sites.requests.length,before,'no further request')
  assert.deepEqual([(await datasets(acme)).length,(await documents(acme)).length],[1,4],'no second source, no duplicate page')
  assert.equal((await readOf(acme)).state,'done')
  // The owner's deletion sticks: the source goes through the product's route and no later read brings it back.
  await knowledge(acme,`/datasets/${source.id}`,{method:'DELETE',status:200})
  assert.deepEqual([(await datasets(acme)).length,(await documents(acme)).length],[0,0])
  assert.equal((await knowledge(acme,'/search?q=frequently')).data.citations.length,0)
  await app.runJobs([queued.get(acme)]);await scheduled()
  assert.deepEqual([(await datasets(acme)).length,(await readOf(acme)).state,sites.requests.length],[0,'done',before],'not re-created, not read again')

  // The owner's edits made before the read runs survive: nothing is replaced unless it still equals the derived value.
  const derive=(project,settings)=>app.db.prepare("UPDATE project_settings SET settings_json=json_patch(settings_json,?) WHERE project_id=?").bind(JSON.stringify(settings),project).run()
  const edited=await create('https://quiet.example.com','Quiet Derived');await derive(edited,{primary_color:'#ff0000',derived:{name:'Quiet Derived',colour:true}})
  await app.db.prepare("UPDATE projects SET name='Our own name' WHERE id=?").bind(edited).run()
  assert.equal((await run(edited)).state,'done');assert.equal(await nameOf(edited),'Our own name');assert.equal((await settingsOf(edited)).primary_color,'#ff0000')
  assert.equal((await documents(edited)).length,1,'the source is still written')
 }finally{await app.close()}
}
