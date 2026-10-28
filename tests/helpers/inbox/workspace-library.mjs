import assert from 'node:assert/strict'

// The workspace owner adds a crawlable library alongside the saved settings.
// Rejected edits preserve that library, including after an older corrupt row.
export async function workspaceLibrary(app){
 const base='/api/knowledge/p/datasets',token='token',definition={name:'Support library',url:'https://example.test',max_crawl_depth:3,max_crawl_pages:10}
 const request=(path,body,method)=>app.call(path,{token,body,method})
 const created=await app.ok(base,{token,body:definition}),path=base+'/'+created.id
 for(const limits of [{max_crawl_depth:-1},{max_crawl_pages:0},{max_crawl_depth:1.5},{max_crawl_pages:'50'}]){
  assert.equal((await request(base,{...definition,...limits})).status,400)
  assert.equal((await request(path,{...definition,...limits},'PUT')).status,400)
 }
 const stored=()=>app.first('SELECT max_crawl_depth,max_crawl_pages FROM knowledge_datasets WHERE id=?',created.id)
 assert.deepEqual(await stored(),{max_crawl_depth:3,max_crawl_pages:10})
 await app.configure({APIFY_TOKEN:'synthetic-library-crawler',APIFY_CRAWLER_ACTOR_ID:'synthetic-library-actor'})
 await app.takeJobs()
 const before=app.requests.length
 await app.db.prepare("UPDATE knowledge_datasets SET max_crawl_depth=-1,claim_token=NULL,status='ready' WHERE id=?").bind(created.id).run()
 const crawl=await request(path+'/crawl',{})
 if(crawl.status>=200&&crawl.status<300)for(const job of await app.takeJobs())if(job.datasetId===created.id)await app.runJobs([job])
 const state=await app.first('SELECT status FROM knowledge_datasets WHERE id=?',created.id)
 assert.ok(crawl.status>=400||state.status==='failed','stored invalid limits cannot enter the crawler')
 assert.equal(app.requests.length,before,'invalid stored limits never reach the provider')
 await app.db.prepare('UPDATE knowledge_datasets SET max_crawl_depth=3 WHERE id=?').bind(created.id).run()
}
