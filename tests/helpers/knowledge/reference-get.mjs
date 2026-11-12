import assert from 'node:assert/strict'

/** Opening a conversation renders the references its text already holds and writes nothing. */
export async function referenceGet({k,body,category,a,c,send,call,app,p}){
 const open=async(path,token)=>{
  const response=await app.request(path,{token,headers:{'x-test-meter-d1':'1'}}),data=await response.json(),header=name=>Number(response.headers.get(name))
  assert.equal(response.status,200,path+': '+JSON.stringify(data))
  return {data,statements:header('x-test-d1-statements'),writes:header('x-test-d1-writes'),rowsRead:header('x-test-d1-rows-read')}
 }
 const tables=['knowledge_reply_blocks','knowledge_shingles','knowledge_index_dirty','knowledge_source_index','messages']
 const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await app.first(`SELECT count(*) n FROM ${table}`)).n])))
 // One conversation holds text that already carries a reference (a copied, entitled article).
 assert.equal((await send(a,body)).status,200)
 // Another holds plain text that matched no source when it was written; an article with those words is published afterwards.
 const plain=`The harbour ferry timetable ${crypto.randomUUID()} changes every autumn so please confirm your crossing the evening before you travel.`
 // It lives in a second conversation of that customer, so the saved-reply and mail journeys that follow keep their own text.
 const second=(await app.call('/api/conversations',{token:c.token,body:{projectId:p},status:201})).data,head=(await app.call(`/api/conversations/${second.id}/messages`,{token:c.token,status:200})).data
 await app.call(`/api/conversations/${second.id}/messages`,{token:c.token,body:{localId:crypto.randomUUID(),content:plain,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId},status:200})
 await call(`/api/knowledge/${p}/articles`,{body:{title:'Ferry timetable',content:plain,categoryIds:[category],status:'published'},status:201})
 const customer=[[a,'blocks'],[{conversation:second,token:c.token},'plain']],paths=(who)=>[[`/api/conversations/${who.conversation.id}/messages`,who.token,true],[`/api/conversations/${who.conversation.id}/messages`,k.token,true],[`/api/dashboard/projects/${p}/conversations/${who.conversation.id}/ticket`,k.token,false]]
 for(const [who,label] of customer)for(const [path,token,transcript] of paths(who)){
  const before=await counts(),opened=await open(path,token),after=await counts(),text=JSON.stringify(opened.data)
  if(process.env.H2H_REPORT_D1)console.error(`D1-OPEN ${label} ${path.split('/').slice(-1)[0]+' as '+(token===k.token?'owner':'customer')} statements=${opened.statements} rowsRead=${opened.rowsRead} writes=${opened.writes} blockRows ${before.knowledge_reply_blocks}->${after.knowledge_reply_blocks} shingleRows ${before.knowledge_shingles}->${after.knowledge_shingles}`)
  assert.deepEqual(after,before,`${label}: opening ${path.split('/').slice(-1)[0]+' as '+(token===k.token?'owner':'customer')} changes no table row count`)
  assert.equal(opened.writes,0,`${label}: opening a conversation sends no write statement to D1`)
  if(token!==k.token)assert.doesNotMatch(text,/⟦k:[^⟧]*⟧/u,'a customer read never shows opaque reference syntax')
  if(!transcript)continue
  if(label==='blocks')assert.ok(text.includes(body),'an existing reference renders its text for a reader with access')
  else assert.ok(text.includes(plain),'text stored without a reference is shown as stored')
 }
}
