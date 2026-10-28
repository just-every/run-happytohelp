import assert from 'node:assert/strict'
import {knowledgeApp} from './app.mjs'
import {experienceJourney} from './experience.mjs'

// A workspace builds its library from a retained corpus, authors the customer
// article and publishes it. Refresh failures and audience changes keep custody.
export async function publicationJourney(){
 const k=await knowledgeApp({bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-library-mail',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'fixture-native-knowledge',APIFY_TOKEN:'synthetic-crawler',APIFY_CRAWLER_ACTOR_ID:'synthetic-crawler-actor'}})
 const {app,p,other,call,search}=k
 try{
  const dataset=await k.dataset('Returns evidence'),path=`/api/knowledge/${p}/datasets/${dataset}`
  const documents=Array.from({length:21},(_,i)=>({url:`https://example.com/returns/${i}`,title:`Returns ${i}`,content:`Cobalt returns policy ${i}. Keep the receipt to return an unused order.`}))
  const started=(await call(path+'/refresh',{body:{documents},headers:{'x-test-fault':'queue-unavailable'},status:202})).data
  await app.scheduled();await k.drain({twice:true})
  const ready=(await call(path,{status:200})).data
  assert.equal(ready.status,'ready');assert.equal(ready.published_version,started.id)
  const citations=await search('Cobalt returns')
  assert.ok(citations.length>0);assert.ok(citations.every(c=>c.url.startsWith('https://example.com/returns/')&&c.sourceVersion===started.id))
  assert.deepEqual(await search('Cobalt returns','lexical',other),[])
  assert.equal((await call(`/api/knowledge/${other}/datasets/${dataset}`)).status,403)
  await call(path+'/refresh',{body:{documents:[]},status:202});await k.drain()
  assert.equal((await call(path,{status:200})).data.status,'failed')
  assert.ok((await search('Cobalt returns')).some(c=>c.sourceVersion===started.id),'failed refresh retains the published version')
  assert.equal((await call(`/api/knowledge/${p}/search?q=Cobalt&mode=semantic`)).status,503,'semantic selection cannot silently substitute lexical search')

  for(const input of [{url:'javascript:invalid'},{url:'https://crawl.example.test',max_crawl_pages:0},{url:'https://crawl.example.test',max_crawl_depth:-1}])assert.equal((await call(`/api/knowledge/${p}/datasets`,{body:input})).status,400)
  // Crawl a source once and retain its exact source input for an explicit refresh.
  let starts=0,lost=false
  k.provider=async request=>{
   const url=new URL(request.url);assert.equal(url.hostname,'api.apify.com')
   if(request.method==='POST'){
    starts++;const body=await request.json();assert.equal(body.startUrls[0].url,'https://crawl.example.test/guide')
    assert.deepEqual(body.excludeUrlGlobs,[{glob:'https://crawl.example.test/private/**'}])
    if(lost)throw new TypeError('provider accepted, acknowledgement lost')
    return Response.json({data:{id:'synthetic-run',defaultDatasetId:'synthetic-corpus'}})
   }
   return Response.json(url.pathname.includes('/datasets/')?[{url:'https://crawl.example.test/guide',title:'Delivery',text:'Copper delivery instructions'}]:{data:{status:'SUCCEEDED',defaultDatasetId:'synthetic-corpus'}})
  }
  const crawled=(await call(`/api/knowledge/${p}/datasets`,{body:{url:'https://crawl.example.test/guide',excluded_urls:['https://crawl.example.test/private/**'],max_crawl_pages:7,max_crawl_depth:2,refreshMode:'manual'},status:201})).data
  await k.drain({twice:true});assert.equal(starts,1)
  const published=(await call(`/api/knowledge/${p}/datasets/${crawled.id}`,{status:200})).data
  assert.equal(published.status,'ready');assert.ok((await search('Copper delivery')).some(c=>c.sourceVersion===published.published_version))
  lost=true;await call(`/api/knowledge/${p}/datasets/${crawled.id}/crawl`,{body:{},status:202});await k.drain({twice:true})
  const requests=starts;await app.scheduled();await k.drain();assert.equal(starts,requests)
  assert.ok((await search('Copper delivery')).some(c=>c.sourceVersion===published.published_version),'uncertain paid refresh leaves known knowledge usable')

  // Explicitly selected semantic indexing and scoped incumbent imports use their
  // actual network adapters. Repeating an import retains one source identity.
  await app.configure({OPENAI_API_KEY:'synthetic-library-model',KNOWLEDGE_EMBEDDING_MODEL:'synthetic-embedding',QDRANT_URL:'https://qdrant.test',QDRANT_API_KEY:'synthetic-vectors',INTERCOM_TOKEN:'synthetic-intercom',FRESHDESK_TOKEN:'synthetic-freshdesk',ZENDESK_TOKEN:'synthetic-zendesk',ZENDESK_EMAIL:'owner@example.test'})
  const points=[]
  k.provider=async request=>{
   const url=new URL(request.url)
   if(url.pathname.includes('/embeddings')){const body=await request.json();return Response.json({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})}
   if(url.hostname==='qdrant.test'){
    if(url.pathname.endsWith('/search'))return Response.json({result:[{score:1,vector:[1,0],payload:points[0].payload}]})
    if(request.method==='PUT'&&url.search)points.push(...(await request.json()).points)
    return Response.json({result:true})
   }
   if(url.hostname.endsWith('.freshdesk.com'))return Response.json(url.pathname.includes('/articles')?[{id:3,title:'Freshdesk returns',description:'<p>Receipt required</p>',status:2}]:url.pathname.includes('/folders')?[{id:2,name:'Returns',visibility:1}]:[{id:1,name:'Customer help'}])
   if(url.hostname.endsWith('.zendesk.com'))return Response.json(url.pathname.includes('/articles')?{articles:[{id:3,title:'Zendesk returns',body:'<p>Receipt required</p>',section_id:2,draft:false}]}:url.pathname.includes('/sections')?{sections:[{id:2,name:'Returns',category_id:1}]}:{categories:[{id:1,name:'Customer help'}]})
   if(url.hostname==='api.intercom.io')return Response.json({data:url.pathname.includes('/collections')?[{id:'1',name:'Customer help'}]:url.pathname.includes('/sections')?[{id:'2',parent_id:'1',name:'Returns'}]:[{id:'3',parent_type:'section',parent_id:'2',title:'Intercom returns',body:'<p>Receipt required</p><script>unsafe()</script>',state:'published'}],pages:{page:1,total_pages:1}})
   throw new Error('Unexpected provider '+url.hostname)
  }
  await call(path+'/refresh',{body:{documents,semantic:true},status:202});await k.drain()
  assert.ok(points.length>0)
  assert.equal((await call(`/api/knowledge/${p}/search?q=Cobalt&mode=semantic`)).status,503,'every selected source must have a semantic index')
  await call(`/api/knowledge/${p}/datasets/${crawled.id}/refresh`,{body:{documents:[{url:'https://crawl.example.test/guide',title:'Delivery',content:'Copper delivery instructions'}],semantic:true},status:202});await k.drain()
  assert.ok((await search('Cobalt returns','semantic')).length>0)
  for(const platform of ['intercom','freshdesk','zendesk']){
   for(let repeat=0;repeat<2;repeat++){await call(`/api/knowledge/${p}/import/${platform}`,{body:{subdomain:'example'},status:200});await k.drain()}
   const imported=(await call(`/api/knowledge/${p}/articles?q=${platform}`,{status:200})).data
   assert.equal(imported.length,1);assert.doesNotMatch(imported[0].content||'',/unsafe\(\)/)
  }

  const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Returns'},status:201})).data
  const content=`Keep the receipt. Source: ${citations[0].url}`
  const article=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Cobalt customer returns',slug:'cobalt-returns',content,categories:[category.id],is_published:false},status:201})).data
  assert.ok((await call(`/api/knowledge/${p}/articles?q=Cobalt%20customer`,{status:200})).data.some(a=>a.id===article.id),'owners can find their draft')
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/cobalt-returns`)).status,404)
  await call(`/api/knowledge/${p}/articles`,{body:{id:article.id,title:'Cobalt customer returns',slug:'cobalt-returns',content,categoryIds:[category.id],status:'published'},status:201})
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/cobalt-returns`,{status:200})).data.content,content)
  assert.ok((await app.call(`/api/knowledge/public/${p}/search?q=Cobalt%20customer`,{status:200})).data.some(a=>a.id===article.id))
  assert.equal((await call(`/api/knowledge/${other}/articles/${article.id}/history`)).status,403)
  // The emitted-page journey in tests/journeys/public.mjs covers the canonical
  // help aliases and rendered search; this API runtime owns publication custody.

  // Audience publication and version review continue on this same library.
  await experienceJourney(k)
  await call(`/api/knowledge/${p}/articles/${article.id}`,{method:'DELETE',status:200})
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/cobalt-returns`)).status,404)
  await app.ok(`/api/management/projects/${p}`,{token:k.token,method:'DELETE'})
  for(const route of ['articles','categories','search?q=Cobalt'])assert.equal((await app.call(`/api/knowledge/public/${p}/${route}`)).status,404)
 }finally{await k.close()}
}
