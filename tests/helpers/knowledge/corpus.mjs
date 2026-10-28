import assert from 'node:assert/strict'
import {knowledgeApp} from './app.mjs'

const semantic={OPENAI_API_KEY:'test-only',KNOWLEDGE_EMBEDDING_MODEL:'test-only',QDRANT_URL:'https://qdrant.test',QDRANT_API_KEY:'test-only',INTERCOM_TOKEN:'test-only',FRESHDESK_TOKEN:'test-only',ZENDESK_TOKEN:'test-only',ZENDESK_EMAIL:'test@example.com'}

// A document corpus publishes over durable pages, retrieval stays in its workspace, a failed refresh keeps the
// last corpus, semantic retrieval is explicit, and help centers import with their hierarchy and repeat identity.
export async function corpusJourney(k){
 const {app,p,other,call,drain,search}=k
 const requestsBefore=app.requests.length
 try{
  const corpus=await k.dataset('Corpus'),refresh=body=>call(`/api/knowledge/${p}/datasets/${corpus}/refresh`,{body})
  const documents=Array.from({length:3},(_,i)=>({url:`https://example.com/${i}`,title:`Page ${i}`,content:`Corpus article ${i} `+'body '.repeat(230)}))
  assert.equal((await refresh({documents})).status,202)
  let pages=0;for(;;){const jobs=await app.takeJobs();if(!jobs.length)break;for(const job of jobs){await app.runJobs([job]);await app.runJobs([job]);pages++}}
  assert.ok(pages>0);assert.equal((await app.first('SELECT COUNT(*) n FROM knowledge_documents d JOIN knowledge_versions v ON v.id=d.version_id WHERE v.dataset_id=?',corpus)).n,documents.length)
  assert.equal((await search('Corpus')).length,3,'lexical ranking returns the best few');assert.equal((await search('Corpus','lexical',other)).length,0,'another workspace finds nothing')
  // Unsafe input is refused; an empty refresh fails and keeps the published corpus.
  assert.equal((await refresh({documents:[{url:'javascript:alert(1)',title:'x',content:'x'}]})).status,202);await drain()
  assert.equal((await call(`/api/knowledge/${p}/datasets/${corpus}`,{status:200})).data.status,'failed','a script address fails the refresh');assert.equal((await app.first("SELECT count(*) n FROM knowledge_documents WHERE url LIKE 'javascript:%'")).n,0)
  assert.equal((await refresh({documents:[]})).status,202);await drain()
  assert.equal((await search('Corpus')).length,3,'a failed refresh retains the published corpus');assert.equal((await call(`/api/knowledge/${p}/datasets/${corpus}`,{status:200})).data.status,'failed')
  // Semantic retrieval without an index is an explicit error, never a silent lexical fallback.
  const unavailable=await call(`/api/knowledge/${p}/search?q=Corpus&mode=semantic`);assert.equal(unavailable.status,503);assert.match(JSON.stringify(unavailable.data),/SEMANTIC_INDEX_UNAVAILABLE/)
  assert.equal(app.requests.length,requestsBefore,'lexical work calls no provider')

  // With an embedding model and vector index: paged embedding beyond 256 chunks, then per-collection MMR retrieval.
  await app.configure(semantic)
  const points=[];let embeddings=0
  k.provider=async request=>{
   const url=request.url
   if(url.includes('/v1/embeddings')){embeddings++;const body=await request.json();return Response.json({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})}
   if(url.includes('qdrant.test')){if(url.includes('/points/search'))return Response.json({result:[{score:1,vector:[1,0],payload:points[0].payload}]});if(url.includes('/points?'))points.push(...(await request.json()).points);return Response.json({result:true})}
   if(url.includes('.freshdesk.com'))return Response.json(url.includes('/articles')?[{id:3,title:'Freshdesk Imported',description:'<p>FD</p>',status:2}]:url.includes('/folders')?[{id:2,name:'Folder',visibility:1}]:[{id:1,name:'FD Category'}])
   if(url.includes('.zendesk.com'))return Response.json(url.includes('/articles')?{articles:[{id:3,title:'Zendesk Imported',body:'<p>ZD</p>',section_id:2,draft:false}]}:url.includes('/sections')?{sections:[{id:2,name:'ZD Section',category_id:1}]}:{categories:[{id:1,name:'ZD Category'}]})
   if(url.includes('api.intercom.io')){const data=url.includes('/collections')?[{id:'1',name:'Collection',description:'Summary'}]:url.includes('/sections')?[{id:'2',parent_id:'1',name:'Section'}]:[{id:'3',parent_type:'section',parent_id:'2',title:'Imported',body:'<h2>Help</h2><p>Imported <strong>body</strong> with a <a href="https://example.com">link</a></p><script>bad()</script>',state:'published'}];return Response.json({data,pages:{page:1,total_pages:1}})}
   throw new Error('Unexpected provider URL '+url)
  }
  assert.equal((await refresh({documents,semantic:true})).status,202);await drain()
  assert.ok(points.length>0);assert.ok(embeddings>0,'the corpus is actually embedded')
  assert.equal((await search('Corpus','semantic')).length,1,'semantic retrieval selects per collection')
  // Help center imports keep their hierarchy, convert HTML to Markdown without scripts, and repeat as the same article.
  for(let repeat=0;repeat<2;repeat++){assert.equal((await call(`/api/knowledge/${p}/import/intercom`,{body:{}})).status,200);await drain()}
  const imported=await app.sql("SELECT content FROM knowledge_articles WHERE title='Imported'");assert.equal(imported.length,1,'a repeated import keeps one article')
  assert.match(imported[0].content,/## Help/);assert.match(imported[0].content,/Imported \*\*body\*\*/);assert.match(imported[0].content,/\[link\]\(https:\/\/example.com\)/);assert.doesNotMatch(imported[0].content,/bad\(\)/)
  for(const [platform,title] of [['freshdesk','Freshdesk Imported'],['zendesk','Zendesk Imported']]){assert.equal((await call(`/api/knowledge/${p}/import/${platform}`,{body:{subdomain:'example'}})).status,200);await drain();assert.ok(await app.first('SELECT id FROM knowledge_articles WHERE title=?',title),platform)}
 }finally{k.provider=undefined}
}
