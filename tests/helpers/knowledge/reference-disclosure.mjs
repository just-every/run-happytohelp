import assert from 'node:assert/strict'

export async function referenceDisclosure({body,article,category,a,b,c,send,grants,call,app,p,issued}){
 const source='The cobalt dispatch office keeps every recovery authorisation inside its protected brass cabinet until the appointed account custodian signs the complete restoration ledger.'
 const id=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Retired recovery source',content:source,status:'published',categoryIds:[category]},status:201})).data.id
 await call(`/api/knowledge/${p}/articles/${id}`,{method:'DELETE',status:200})
 assert.equal((await send(c,source)).status,409,'publication bytes remain indexed if the article is deleted before the next copy')
 assert.equal((await call(`/api/knowledge/${p}/articles`,{body:{id,title:'Recycled public source',content:'An unrelated public replacement.',status:'published'}})).status,409,'a retired identity cannot revive earlier restricted references')
 await grants([])
 const routes=(await app.call('/_test/routes',{status:200})).data
 let swept=0
 for(const route of routes){
  if(!route.path.startsWith('/api/')&&!route.path.startsWith('/help/'))continue
  const values={projectId:p,project:p,projectKey:p,projectKeyOrId:p,p,conversationId:a.conversation.id,articleId:article,categoryId:category,contactId:a.contactId,slug:'restoration',id:route.path.includes('/articles/')?article:route.path.includes('/categories/')?category:a.conversation.id}
  const path=route.path.replace(/:([A-Za-z_0-9]+)(?:\{[^}]+\})?/g,(_,name)=>encodeURIComponent(values[name]||'unavailable')).replaceAll('*','unavailable')
  const response=await app.request(path,{token:path.startsWith('/api/v1/')?issued.token:a.token}),bytes=await response.text()
  assert.ok(!bytes.includes(body),route.path+' cannot disclose withdrawn knowledge')
  assert.doesNotMatch(bytes,/⟦k:[a-f0-9]{32}⟧/u,route.path+' renders every reference before disclosure')
  swept++
 }
 assert.ok(swept>0,'the canary discovers its doors from the mounted router')
 await grants([a.contactId])
 console.log(JSON.stringify({knowledgeCanaryRoutes:swept}))
}
