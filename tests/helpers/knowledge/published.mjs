import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRuntime} from '../emitted-runtime.mjs'
import {client} from '../../journeys/kit/http.mjs'

// KNOWLEDGE-001 through the built application's HTTP doors and real queue.
// Only crawler, embedding and vector-index network responses are faked.
export async function publishedKnowledgeJourney(){
 const directory=await mkdtemp(join(tmpdir(),'h2h-published-')),statePath=join(directory,'state.json'),diagnosticsPath=join(directory,'diagnostics.json')
 const title='Retained guide',content='Retainedcorpusmarker: the published support instructions.',slug='retained-guide'
 await writeFile(statePath,JSON.stringify({replacement:false}))
 let runtime,success=false
 try{
  const fixture=join(directory,'network.mjs')
  await writeFile(fixture,"import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';const statePath="+JSON.stringify(statePath)+",diagnosticsPath="+JSON.stringify(diagnosticsPath)+";const saved=await readFile(diagnosticsPath,'utf8').then(JSON.parse).catch(()=>({}));const points=new Map(saved.points||[]),searchedCollections=saved.searchedCollections||[];let failedEmbeddings=saved.failedEmbeddings||0;export default "+networkEdge.toString())
  runtime=await createRuntime({queueConsumers:true,outboundFixture:fixture,vars:{APP_ORIGIN:'https://app.example',APIFY_TOKEN:'test-only',OPENAI_API_KEY:'test-only',KNOWLEDGE_EMBEDDING_MODEL:'test-only',QDRANT_URL:'https://qdrant.test',QDRANT_API_KEY:'test-only'}})
  const tenant=await runtime.seedTenant({name:'Published support',email:'published@example.test',allowedOrigin:runtime.origin})
  const p=tenant.projectId,base='/api/knowledge/'+p,canonical='https://app.example/help/'+p+'/'+slug
  await writeFile(statePath,JSON.stringify({replacement:false,canonical,title,content}))
  const app=client(runtime.origin),call=(path,options={})=>app.call(path,{token:tenant.token,...options})
  const search=async(query,mode='lexical')=>(await call(base+'/search?'+new URLSearchParams({q:query,mode}),{status:200})).data.citations
  const category=(await call(base+'/categories',{body:{title:'Support drafts',summary:'Before publication',is_published:false},status:201})).data
  assert.ok(!(await app.call('/api/knowledge/public/'+p+'/categories',{status:200})).data.some(row=>row.id===category.id))
  await call(base+'/categories/'+category.id,{method:'PUT',body:{title:'Published guides',summary:'Current support instructions',is_published:true},status:200})
  const categories=(await app.call('/api/knowledge/public/'+p+'/categories',{status:200})).data
  assert.deepEqual(categories.map(({id,title,summary})=>({id,title,summary})),[{id:category.id,title:'Published guides',summary:'Current support instructions'}],'category edits and publication read back publicly')
  const article=(await call(base+'/articles',{body:{title,slug,content,summary:'Retained support',categoryIds:[category.id],status:'draft'},status:201})).data
  assert.equal((await app.call('/api/knowledge/public/'+p+'/articles/'+slug)).status,404)
  assert.deepEqual(await search('Retainedcorpusmarker'),[],'a newly authored draft is not a citation')
  await call(base+'/articles',{body:{id:article.id,title,slug,content,summary:'Retained support',categoryIds:[category.id],status:'published'},status:201})
  const published=(await app.call('/api/knowledge/public/'+p+'/articles/'+slug,{status:200})).data
  assert.equal(published.content,content);assert.equal(published.title,title)
  assert.deepEqual(published.category_ids,[category.id],'published article retains its authored category')
  assert.ok(published.publication_version)

  const dataset=(await call(base+'/datasets',{body:{name:'Published corpus'},status:201})).data.id
  const refresh=async()=>call(base+'/datasets/'+dataset+'/refresh',{body:{apifyDatasetId:'published-corpus',semantic:true},status:202})
  const read=async()=>(await call(base+'/datasets/'+dataset,{status:200})).data
  const settle=async(status)=>{
   const deadline=Date.now()+30000
   for(;;){
    const row=await read()
    if(['ready','failed'].includes(row.status)){assert.equal(row.status,status,JSON.stringify(row));return row}
    assert.ok(Date.now()<deadline,'the real refresh queue settles');await new Promise(resolve=>setTimeout(resolve,50))
   }
  }
  const first=await refresh(),ready=await settle('ready')
  assert.equal(ready.published_version,first.data.id);assert.equal(ready.page_count,1)
  const pages=async()=>(await call(base+'/datasets/'+dataset+'/pages',{status:200})).data
  const originalPages=await pages();assert.equal(originalPages.length,1);assert.equal(originalPages[0].content,content)
  const expected=[
   {id:'article:'+article.id,sourceVersion:published.publication_version,url:canonical,title,content},
   {id:'knowledge:'+originalPages[0].id,sourceVersion:ready.published_version,url:canonical,title,content}
  ].sort((a,b)=>a.id.localeCompare(b.id))
  const citations=async(mode)=>{
   const rows=await search('Retainedcorpusmarker',mode)
   for(const row of rows)assert.ok(row.score>0,'retrieval returns scored citations')
   return rows.map(({id,sourceVersion,url,title,content})=>({id,sourceVersion,url,title,content})).sort((a,b)=>a.id.localeCompare(b.id))
  }
  const publicReads=async()=>{
   const found=(await app.call('/api/knowledge/public/'+p+'/search?q=Retainedcorpusmarker',{status:200})).data
   assert.deepEqual(found.map(row=>row.id),[article.id])
   const home=(await app.call('/help/'+p,{status:200})).data
   assert.ok(home.includes('Published guides'));assert.ok(home.includes('href="/help/'+p+'/'+slug+'"'))
   const results=(await app.call('/help/'+p+'/search?keyword=Retainedcorpusmarker',{status:200})).data
   assert.match(results,/1 results found/);assert.ok(results.includes('href="/help/'+p+'/'+slug+'"'))
   const page=(await app.call('/help/'+p+'/'+slug,{status:200})).data
   assert.ok(page.includes(content),'the citation opens the retained public instructions')
   for(const html of [home,results,page])assert.doesNotMatch(html,/Replacementcorpusmarker/)
  }
  for(const mode of ['lexical','semantic'])assert.deepEqual(await citations(mode),expected,mode+' citation identity, version, URL and content')
  await publicReads()

  // Replacement documents are ingested before their vector page reaches this
  // failing network edge. No storage fault, internal call or invalid input.
  await writeFile(statePath,JSON.stringify({replacement:true,canonical,title,content}))
  const second=await refresh();assert.notEqual(second.data.id,ready.published_version)
  const failed=await settle('failed')
  const diagnostics=JSON.parse(await readFile(diagnosticsPath,'utf8'))
  assert.equal(diagnostics.failedEmbeddings,1,'the real refresh failed at the embedding HTTP edge without replay')
  assert.match(failed.error,/503/);assert.equal(failed.published_version,ready.published_version);assert.equal(failed.claim_token,null)
  // Read the same durable publications after restart, through both retrieval
  // modes, the pages API and the built public help centre and canonical links.
  await runtime.restart()
  assert.deepEqual(await pages(),originalPages)
  for(const mode of ['lexical','semantic'])assert.deepEqual(await citations(mode),expected,mode+' retains the last usable published corpus')
  assert.deepEqual(await search('Replacementcorpusmarker'),[],'the failed replacement is never retrieved')
  const {searchedCollections}=JSON.parse(await readFile(diagnosticsPath,'utf8'))
  assert.deepEqual([...new Set(searchedCollections)],['h2h_'+ready.published_version.replaceAll('-','')],'semantic retrieval still selects the published collection')
  assert.deepEqual((await app.call('/api/knowledge/public/'+p+'/search?q=Replacementcorpusmarker',{status:200})).data,[])
  await publicReads()
  success=true
 }finally{await runtime?.close(success);if(success)await rm(directory,{recursive:true,force:true})}
}

// Loaded only by the emitted runtime's outbound HTTP boundary. Fixture state
// changes provider responses, never application code or its durable records.
async function networkEdge(request){
 const {replacement,canonical,title,content}=JSON.parse(await readFile(statePath,'utf8'))
 const url=new URL(request.url)
 if(url.host==='api.apify.com'){
  assert.equal(url.pathname,'/v2/datasets/published-corpus/items');assert.equal(request.method,'GET')
  return Response.json([{url:canonical,title,text:replacement?'Replacementcorpusmarker: unusable new instructions.':content}])
 }
 if(url.host==='api.openai.com'){
  assert.equal(url.pathname,'/v1/embeddings')
  const body=await request.json();assert.equal(body.model,'test-only')
  if(body.input.some(text=>text.includes('Replacementcorpusmarker'))){
   failedEmbeddings++
   await writeFile(diagnosticsPath,JSON.stringify({failedEmbeddings,searchedCollections,points:[...points]}))
   return Response.json({error:'Embedding service unavailable'},{status:503})
  }
  return Response.json({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})
 }
 assert.equal(url.host,'qdrant.test','no other network edge is allowed')
 const collection=url.pathname.split('/')[2]
 if(url.pathname.endsWith('/points/search')){
  searchedCollections.push(collection)
  await writeFile(diagnosticsPath,JSON.stringify({failedEmbeddings,searchedCollections,points:[...points]}))
  return Response.json({result:(points.get(collection)||[]).map(point=>({...point,score:1}))})
 }
 if(url.pathname.endsWith('/points'))points.set(collection,(await request.json()).points)
 return Response.json({result:true})
}
