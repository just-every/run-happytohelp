import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {knowledgeApp} from './app.mjs'

export async function referenceJourney(){
 const k=await knowledgeApp({bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test'}}),{app,p,call}=k
 try{
  const mail=[];k.provider=async(request,entry)=>{assert.equal(new URL(request.url).host,'api.resend.com');mail.push(JSON.parse(entry.body));return Response.json({id:'mail-'+mail.length})}
  const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Selected accounts',audience:'signed-in',requires_entitlement:1},status:201})).data.id
  const body='The indigo recovery procedure requires a copper checkpoint before the violet console accepts any emergency account restoration request. Keep the amber access certificate inside the sealed support envelope until the overnight coordinator completes the identity inspection.'
  const article=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Account restoration',content:body,slug:'restoration',categoryIds:[category],status:'published'},status:201})).data.id
  await (await import('./upgrade-report.mjs')).upgradeReport(k,article)
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const contact=async name=>{const email=name+'@customer.test',contact_hash=createHmac('sha256',secret).update(email).digest('hex');const customer=(await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p',identifier:email,email,contact_hash},status:201})).data;const conversation=(await app.call('/api/conversations',{token:customer.token,body:{projectId:p},status:201})).data;return {...customer,conversation}}
  const [a,b,c]=await Promise.all(['reader-a','reader-b','reader-c'].map(contact))
  const cid=customer=>customer.contactId
  const grants=async ids=>call(`/api/knowledge/${p}/categories/${category}/entitlements`,{method:'PUT',body:{required:true,contactIds:ids,companyIds:[]},status:200})
  await grants([cid(a),cid(b)])
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/restoration`,{token:a.token})).status,200)
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/restoration`,{token:c.token})).status,404)
  const insert=(await call(`/api/knowledge/${p}/conversations/${a.conversation.id}/articles/${article}/insert`,{body:{mode:'text'},status:200})).data
  assert.equal(insert.preview.content,body);assert.ok(insert.token);assert.ok(!insert.token.includes('indigo'))
  const macro=async(title,content)=>(await call(`/api/management/projects/${p}/macros`,{body:{title,content,actions:{reply_type:'public'},scope:{visibility:'shared',roles:[],groups:[],brands:[]}},status:201})).data.data
  const saved=[await macro('Inserted article',insert.token),await macro('Pasted preview',insert.preview.content)]
  const apply=async(m,customers)=>{const tickets=[];for(const customer of customers){const ticket=(await call(`/api/conversations/${customer.conversation.id}`,{status:200})).data;tickets.push({id:ticket.id,expected_version:ticket.ticket_version})}return (await call(`/api/management/projects/${p}/macros/${m.id}/apply`,{body:{version:m.version,tickets,command_id:crypto.randomUUID()},status:200})).data.data.results}
  const send=async(customer,content)=>{const current=(await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,status:200})).data;return call(`/api/conversations/${customer.conversation.id}/messages`,{body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId}})}
  for(const m of saved)for(const targets of [[a,b,c],[a],[b],[c]]){
   await grants([cid(a),cid(b)])
   const applied=await apply(m,targets);assert.ok(applied.every(row=>row.status==='applied'),JSON.stringify(applied))
   await grants([cid(a)])
   for(const customer of targets.filter(customer=>customer!==a)){const before=mail.length,draft=(await call(`/api/management/projects/${p}/conversations/${customer.conversation.id}/macro-draft`,{status:200})).data.data;const refused=await send(customer,draft.content);assert.equal(refused.status,409,JSON.stringify(refused.data));assert.ok(refused.data.blockedReferences?.length);const transcript=(await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,status:200})).data;assert.equal(transcript.messages.length,0);assert.equal(mail.length,before)}
   if(targets.includes(a)){
    const draft=(await call(`/api/management/projects/${p}/conversations/${a.conversation.id}/macro-draft`,{status:200})).data.data
    assert.equal((await send(a,draft.content)).status,200)
    assert.ok(JSON.stringify((await app.call(`/api/conversations/${a.conversation.id}/messages`,{token:a.token,status:200})).data).includes(body))
   }
  }

  await grants([])
  const withheld=(await app.call(`/api/conversations/${a.conversation.id}/messages`,{token:a.token,status:200})).data
  assert.ok(!JSON.stringify(withheld).includes(body));assert.ok(!JSON.stringify(withheld).includes(insert.token))
  await grants([cid(a)])
  assert.ok(JSON.stringify((await app.call(`/api/conversations/${a.conversation.id}/messages`,{token:a.token,status:200})).data).includes(body))
  const issued=(await call(`/api/management/projects/${p}/connections/tokens`,{body:{name:'Reference reader',scopes:['conversations:read','articles:read']},status:201})).data
  await grants([])
  assert.ok(!JSON.stringify((await app.call(`/api/v1/conversations/${a.conversation.id}/messages`,{token:issued.token,status:200})).data).includes(body))
  await grants([cid(a)])
  assert.ok(JSON.stringify((await app.call(`/api/v1/conversations/${a.conversation.id}/messages`,{token:issued.token,status:200})).data).includes(body))
  for(const content of [body.toUpperCase().replaceAll(' ',' \n '),'Hello team, '+body,body.replace('Keep the amber access certificate inside the sealed support envelope until the overnight coordinator completes the identity inspection.',''),body.replaceAll(' ',' <b> </b> ')]){const response=await send(c,content);assert.equal(response.status,409,JSON.stringify(response.data))}
  assert.equal((await send(c,'I can help restore your account once we have checked your identity.')).status,200)
  const signed=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Signed in',audience:'signed-in',requires_entitlement:0},status:201})).data.id
  const publicArticle=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Reader guide',content:'A straightforward public reader guide.',slug:'reader-guide',categoryIds:[signed],status:'published'},status:201})).data.id
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/reader-guide`,{token:c.token})).status,200)
  await call(`/api/knowledge/${p}/categories/${signed}`,{method:'PUT',body:{title:'Signed in',audience:'signed-in',is_published:false},status:200})
  for(const path of [`/api/knowledge/public/${p}/articles/reader-guide`,`/api/v1/articles/${publicArticle}?contact_id=${cid(c)}`])assert.equal((await app.call(path,{token:path.startsWith('/api/v1')?issued.token:c.token})).status,404)
  await call(`/api/knowledge/${p}/categories/${signed}`,{method:'PUT',body:{title:'Signed in',audience:'signed-in',is_published:true},status:200})
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles/reader-guide`,{token:c.token})).status,200)
  await (await import('./reference-copies.mjs')).referenceCopies({k,body,article,category,a,b,c,send,grants,call,app,p})
  await (await import('./reference-get.mjs')).referenceGet({k,body,category,a,b,c,send,grants,call,app,p})
  await (await import('./reference-authority.mjs')).referenceAuthority({k,body,article,category,a,b,c,send,grants,call,app,p,insert,issued,mail})
  await (await import('./reference-ai.mjs')).referenceAi({k,body,article,category,a,b,c,send,grants,call,app,p,insert,issued,mail})
  await (await import('./reference-erasure.mjs')).referenceErasure()
  await (await import('./reference-disclosure.mjs')).referenceDisclosure({body,article,category,a,b,c,send,grants,call,app,p,issued})
  // Editor metadata retains direct and generated articles, in slug/block order,
  // while document sources never become article names. Duplicate requests and
  // retained publication versions still name each article only once per block.
  const dataset=crypto.randomUUID(),version=crypto.randomUUID(),generation=crypto.randomUUID(),documents=[crypto.randomUUID(),crypto.randomUUID()],blockIds=Array.from({length:3},()=>crypto.randomUUID().replaceAll('-','')).sort()
  await app.db.batch([
   app.db.prepare("INSERT INTO knowledge_datasets(id,project_id,name,published_version,created_at) VALUES(?,?,'Reference metadata',?,0)").bind(dataset,p,version),
   app.db.prepare("INSERT INTO knowledge_versions(id,dataset_id,fingerprint,created_at) VALUES(?,?,'reference-metadata',0)").bind(version,dataset),
   ...documents.map((id,i)=>app.db.prepare("INSERT INTO knowledge_documents(id,version_id,url,title,content) VALUES(?,?,?,'Document metadata','Document source')").bind(id,version,`https://source.example.test/reference-${i}`)),
   ...blockIds.map((id,i)=>app.db.prepare("INSERT INTO knowledge_reply_blocks(id,project_id,kind,payload_json,sources_json,generation_id,created_at,fingerprint) VALUES(?,?,'text',?,?,?,0,?)").bind(id,p,JSON.stringify({text:'Mixed reference sources'}),JSON.stringify(i===0?['article:'+article,'knowledge:'+documents[0]]:['knowledge:'+documents[1]]),i<2?generation:null,id)),
   ...[['article:'+publicArticle,'v1'],['article:'+article,'v1'],['article:'+article,'v2'],['knowledge:'+documents[1],'v1']].map(([source,revision])=>app.db.prepare('INSERT INTO knowledge_generation_sources(generation_id,project_id,source_id,source_version) VALUES(?,?,?,?)').bind(generation,p,source,revision)),
  ])
  const statements=(await app.call('/_test/knowledge-sql',{status:200})).data
  const ordered=(await app.db.prepare(statements.articleSources).bind(p,JSON.stringify([...blockIds].reverse().concat(blockIds[0],'missing-reference'))).all()).results
  assert.deepEqual(ordered,[...blockIds.slice(0,2).map(block_id=>({block_id,id:publicArticle,title:'Reader guide'})),...blockIds.slice(0,2).map(block_id=>({block_id,id:article,title:'Account restoration'}))],'mixed sources preserve the exact article rows and global slug/block order')
  const preview=(await call(`/api/knowledge/${p}/references/preview`,{body:{content:blockIds.map(id=>`⟦k:${id}⟧`).join(' '),conversationId:a.conversation.id},status:200})).data
  for(const id of blockIds){
   const reference=preview.references.find(row=>row.token===`⟦k:${id}⟧`)
   assert.ok(reference&&!reference.withheld,'published document and article sources remain readable by the granted recipient')
   assert.deepEqual(reference.articles,id===blockIds[2]?[]:[{id:publicArticle,title:'Reader guide'},{id:article,title:'Account restoration'}],'the editor sees the same ordered source titles for direct and generated articles')
  }
  await (await import('./reference-readback.mjs')).referenceReadback({app,p})
 }finally{await k.close()}
}
