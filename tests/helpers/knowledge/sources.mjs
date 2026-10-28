import assert from 'node:assert/strict'
import {knowledgeApp} from './app.mjs'

// Website sources: Add URL crawls once with its saved bounds, publishes, and a failed refresh keeps the last corpus.
export async function sourcesJourney(k){
 const {p,other,call,drain,search}=k
 await k.app.configure({APIFY_TOKEN:'test-only',APIFY_CRAWLER_ACTOR_ID:'selected-test-actor'})
 const starts=[];let rejectStart=false
 k.provider=async request=>{
  const url=new URL(request.url);assert.equal(url.host,'api.apify.com','only the crawler provider is called')
  if(request.method==='POST'){assert.equal(url.pathname,'/v2/acts/selected-test-actor/runs','the configured actor runs');starts.push(await request.json());if(rejectStart)throw new Error('Injected uncertain crawler start');return Response.json({data:{id:'test-run',defaultDatasetId:'test-corpus'}})}
  if(url.pathname==='/v2/actor-runs/test-run')return Response.json({data:{status:'SUCCEEDED',defaultDatasetId:'test-corpus'}})
  if(url.pathname==='/v2/datasets/test-corpus/items')return Response.json([{url:'https://crawl.example.test/guide',title:'Initial crawl',text:'Initialcrawlmarker retained support instructions'}])
  throw new Error('Unexpected provider path '+url.pathname)
 }
 const read=async id=>(await call(`/api/knowledge/${p}/datasets/${id}`,{status:200})).data
 try{
  for(const mode of ['adaptive']){
   const settings={url:`https://crawl.example.test/${mode}`,excluded_urls:['https://crawl.example.test/private/**'],max_crawl_depth:2,max_crawl_pages:7,refreshMode:mode}
   const created=(await call(`/api/knowledge/${p}/datasets`,{body:settings,status:201})).data;assert.equal(created.refresh?.status,'queued','Add URL dispatches its first refresh in either recurrence mode')
   const initial=await read(created.id);assert.equal(initial.status,'ingesting');assert.ok(initial.source_input,'the source keeps its recoverable input')
   // A duplicate delivery of the first stage starts the provider only once.
   const [first,...rest]=await k.app.takeJobs();assert.equal(first.id,created.refresh.id);assert.equal(rest.length,0)
   const before=starts.length;await k.app.runJobs([first]);await k.app.runJobs([first]);assert.equal(starts.length,before+1)
   assert.equal((await read(created.id)).status,'crawling','the source shows its running crawl')
   const submitted=starts.at(-1);assert.equal(submitted.startUrls[0].url,settings.url);assert.deepEqual(submitted.excludeUrlGlobs,settings.excluded_urls.map(glob=>({glob})));assert.equal(submitted.maxCrawlDepth,2);assert.equal(submitted.maxCrawlPages,7)
   await drain({twice:true})
   const ready=await read(created.id);assert.equal(ready.status,'ready');assert.equal(ready.page_count,1);assert.ok(ready.published_version)
   assert.ok(mode==='manual'?ready.next_refresh_at===null:ready.next_refresh_at>Date.now(),'recurrence governs later refreshes only')
   assert.ok((await search('Initialcrawlmarker')).some(citation=>citation.url==='https://crawl.example.test/guide'),'the new website enters retrieval')
   if(mode==='adaptive'){
    // An uncertain provider start fails the refresh without replay and keeps the published corpus.
    rejectStart=true;assert.equal((await call(`/api/knowledge/${p}/datasets/${created.id}/crawl`,{body:{}})).status,202)
    await drain({twice:true});const failed=await read(created.id),attempts=starts.length
    await k.app.scheduled();assert.deepEqual(await k.app.takeJobs(),[],'an uncertain start is never automatically replayed');assert.equal(starts.length,attempts)
    assert.equal(failed.status,'failed');assert.equal(failed.published_version,ready.published_version);assert.equal(failed.next_refresh_at,null)
    assert.ok((await search('Initialcrawlmarker')).some(citation=>citation.sourceVersion===ready.published_version),'the last usable corpus stays retrievable')
    rejectStart=false
   }
   assert.equal((await call(`/api/knowledge/${p}/datasets/${created.id}`,{method:'DELETE'})).status,200,'a source is removable after its refresh ends')
  }
  // Invalid addresses, exclusions and bounds, and another workspace, never start a crawl.
  const attempts=starts.length
  for(const body of [{url:'javascript:invalid'},{url:'https://crawl.example.test',excluded_urls:'private'},{url:'https://crawl.example.test',max_crawl_pages:0}])assert.equal((await call(`/api/knowledge/${p}/datasets`,{body})).status,400,JSON.stringify(body))
  assert.equal((await call(`/api/knowledge/${other}/datasets`,{body:{url:'https://crawl.example.test'}})).status,403)
  assert.deepEqual(await k.app.takeJobs(),[]);assert.equal(starts.length,attempts)
 }finally{k.provider=undefined}
}
