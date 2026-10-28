import assert from 'node:assert/strict'
import {knowledgeApp} from './app.mjs'
import {githubJourney} from './github.mjs'
import {corpusJourney} from './corpus.mjs'
import {experienceJourney} from './experience.mjs'
import {sourcesJourney} from './sources.mjs'

// Article and category authoring, owner search, and public help reads.
export async function authoringJourney(){
 const k=await knowledgeApp(),{app,p,other,call}=k
 try{
  const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Category',summary:'Summary'},status:201})).data;assert.ok(category.id)
  const authored=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Authored',summary:'Cobalt zephyr',content:'Copper horizon',categories:[category.id],is_published:true},status:201})).data
  assert.deepEqual(JSON.parse((await app.first('SELECT json_group_array(category_id) ids FROM knowledge_article_categories WHERE article_id=?',authored.id)).ids),[category.id],'an article joins its categories')
  await app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES('draft',?,'draft','Private','Draft body','Cobalt zephyr','draft',0),('foreign',?,'foreign','Foreign','Foreign body','Cobalt zephyr','published',0)").bind(p,other).run()
  // The owner's search finds title, summary and body, includes owned drafts and never another workspace.
  const articles=async query=>(await call(`/api/knowledge/${p}/articles?q=${encodeURIComponent(query)}`,{status:200})).data
  for(const phrase of ['Authored','Copper horizon'])assert.deepEqual((await articles(phrase)).map(row=>row.id),[authored.id],phrase)
  const summary=(await articles('Cobalt zephyr')).map(row=>row.id);assert.ok(summary.includes(authored.id)&&summary.includes('draft')&&!summary.includes('foreign'))
  assert.deepEqual(await articles('no matching phrase'),[]);assert.ok((await articles('   ')).some(row=>row.id===authored.id),'clearing the search restores the library')
  assert.equal((await app.call(`/api/knowledge/${p}/articles?q=Cobalt`)).status,401);assert.equal((await call(`/api/knowledge/${other}/articles?q=Cobalt`)).status,403)
  // Public help needs no actor and shows published articles of this workspace only.
  const publicSearch=await app.call(`/api/knowledge/public/${p}/search?q=Cobalt%20zephyr`,{status:200});assert.deepEqual(publicSearch.data.map(row=>row.id),[authored.id])
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/draft`)).status,404,'a draft is never read publicly')
  assert.deepEqual((await app.call(`/api/knowledge/public/${p}/articles/${(await app.first('SELECT slug FROM knowledge_articles WHERE id=?',authored.id)).slug}`,{status:200})).data.content,'Copper horizon')
  await sourcesJourney(k)
  // Category cycles and other workspaces are refused; a deleted article leaves public help.
  assert.equal((await call(`/api/knowledge/${p}/categories/${category.id}`,{method:'PUT',body:{title:'Cycle',parent_id:category.id}})).status,400)
  assert.equal((await call(`/api/knowledge/${other}/articles`,{body:{title:'Cross tenant',content:'No',is_published:true}})).status,403)
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles`,{status:200})).data.length,1)
  await call(`/api/knowledge/${p}/articles/${authored.id}`,{method:'DELETE',status:200});assert.deepEqual((await app.call(`/api/knowledge/public/${p}/articles`,{status:200})).data,[])
  await githubJourney(k)
  await corpusJourney(k)
  await experienceJourney(k)
  // A deleted workspace has no public help at all.
  await app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('pub',?,'published','Public','Published body','published',0)").bind(p).run()
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/published`)).status,200)
  await app.configure({OPENAI_API_KEY:'synthetic-happytohelp-5',BRAND_IMAGE_MODEL:'configured-image-model',BRAND_IMAGE_SIZE:'1024x1024',BRAND_IMAGE_QUALITY:'low'})
  const image=await call(`/api/site-preview/projects/${p}/brand-image-generations`,{body:{requestId:'deleted-workspace',prompt:'A simple support mark'},status:202});assert.ok(image.data.id)
  const pending=await app.takeJobs(),beforeDelete=app.requests.length
  await app.call(`/api/management/projects/${p}`,{token:k.token,method:'DELETE',status:200})
  await app.runJobs(pending);assert.equal(app.requests.length,beforeDelete,'a deleted workspace cannot pay for queued brand work')
  for(const path of ['articles','categories','search?q=Public','articles/published'])assert.equal((await app.call(`/api/knowledge/public/${p}/${path}`)).status,404,path)
 }finally{await k.close()}
}
