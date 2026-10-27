import assert from 'node:assert/strict'

// The public help -> request form -> admitted ticket flow, with independent portal identities.
export async function attributionAuthorityCases(f){
 const {app,p,owner,form,valid,signin}=f,path=`/api/forms/${p}/${form.id}/submissions`
 const reader=await signin('synthetic-hh-reader@example.com',`/help/${p}/authority-guide`),peer=await signin('synthetic-hh-peer@example.com',`/help/${p}/authority-guide`)
 const contact=(await app.first('SELECT id FROM contacts WHERE project_id=? AND email=?',p,'synthetic-hh-reader@example.com')).id
 const article=(await app.call(`/api/knowledge/${p}/articles`,{...owner,body:{title:'Authority guide',slug:'authority-guide',content:'Public support instructions',status:'published'},status:201})).data.id
 const read=async(options={})=>{const page=await app.call(`/help/${p}/authority-guide`,{...options,status:200});return page.data.match(/requests\?read=([a-f0-9-]{72})/)[1]}
 const count=async()=>(await app.first("SELECT count(*) n FROM knowledge_events WHERE project_id=? AND article_id=? AND kind='ticket'",p,article)).n
 const submit=async(token,identity=reader,options={})=>(await app.call(path,{...identity,...options,body:{...valid,locale:'en',...options.body,localId:crypto.randomUUID(),knowledgeRead:token},status:201})).data
 const known=await read(reader);assert.equal((await app.first('SELECT contact_id FROM knowledge_read_receipts WHERE token=?',known)).contact_id,contact,'known portal reader identity binds the receipt')
 await submit(known,peer);assert.equal(await count(),0,'another identity cannot use a known reader receipt')
 const admitted=await submit(known);assert.equal(await count(),1)
 assert.deepEqual(await app.first("SELECT article_id,locale,brand,contact_id FROM knowledge_events WHERE id=?",`ticket:${admitted.ticket.id}`),{article_id:article,locale:'en',brand:'app.example',contact_id:contact})
 await submit(known);assert.equal(await count(),1,'receipt possession cannot attribute a second ticket')
 const anonymous=await read(),anonymousTicket=await submit(anonymous)
 assert.equal((await app.first('SELECT contact_id FROM knowledge_read_receipts WHERE token=?',anonymous)).contact_id,null,'anonymous possession never becomes proof of reader identity')
 assert.equal((await app.first('SELECT contact_id FROM knowledge_events WHERE id=?',`ticket:${anonymousTicket.ticket.id}`)).contact_id,null)
 const initial=await count()
 for(const [name,options] of [['cross-brand',{base:'https://second.example',headers:{Cookie:reader.headers.Cookie,Origin:'https://second.example'}}],['cross-locale',{body:{locale:'es'}}],['expired',{}]]){
  const token=await read(reader)
  if(name==='expired')await app.db.prepare('UPDATE knowledge_read_receipts SET expires_at=1 WHERE token=?').bind(token).run()
  await submit(token,reader,options);assert.equal(await count(),initial,name+' cannot be attributed')
 }
 const foreignProject=f.foreign.projectId,foreignOwner={token:f.foreign.tokens.owner}
 const foreignForm=(await app.call(`/api/forms/projects/${foreignProject}/forms`,{...foreignOwner,body:{title:'Other workspace requests',enabled:true,locale:'en',fields:[]},status:201})).data.data
 const token=await read(reader),mailBefore=f.mail.length
 await app.call(`/api/portal/${foreignProject}/access/request`,{headers:{Origin:'https://app.example'},body:{email:'synthetic-hh-reader@example.com'},status:202})
 const mail=f.mail.slice(mailBefore).find(item=>[].concat(item.to).includes('synthetic-hh-reader@example.com')),url=new URL(mail.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0])
 const verified=await app.request(url.pathname+url.search);assert.equal(verified.status,303)
 const foreignCookie=verified.headers.get('set-cookie').split(';')[0]
 await app.call(`/api/forms/${foreignProject}/${foreignForm.id}/submissions`,{headers:{Cookie:foreignCookie,Origin:'https://app.example'},body:{subject:'Other workspace question',message:'Please help in this workspace',fields:{},localId:crypto.randomUUID(),knowledgeRead:token},status:201})
 assert.equal((await app.first('SELECT conversation_id FROM knowledge_read_receipts WHERE token=?',token)).conversation_id,null,'another workspace cannot consume this receipt even with its own admitted ticket')
 assert.equal(await count(),initial,'foreign workspace admission cannot create attribution here')
 const category=(await app.call(`/api/knowledge/${p}/categories`,{...owner,body:{title:'Named readers'},status:201})).data.id
 const grants=`/api/knowledge/${p}/categories/${category}/entitlements`
 await app.call(grants,{...owner,method:'PUT',body:{contactIds:[contact]},status:200})
 await app.call(`/api/knowledge/${p}/articles/${article}/categories`,{...owner,method:'PUT',body:{categoryIds:[category]},status:200})
 // A retained answer is historical state. Company ticket visibility alone
 // cannot disclose the restricted knowledge it used, including an uncited answer.
 const peerId=(await app.first('SELECT id FROM contacts WHERE project_id=? AND email=?',p,'synthetic-hh-peer@example.com')).id
 const company=(await app.ok(`/api/management/projects/${p}/companies`,{...owner,body:{name:'Authority partners',domains:[],attributes:{}}})).company
 for(const id of [contact,peerId])await app.ok(`/api/management/projects/${p}/companies/${company.id}/members/${id}`,{...owner,method:'PUT',body:{}})
 await app.ok(`/api/management/projects/${p}/companies/${company.id}`,{...owner,method:'PATCH',body:{portalCompanyView:true}})
 const answer=crypto.randomUUID(),generation=crypto.randomUUID(),version=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',article)).publication_version
 await app.db.batch([
  app.db.prepare("INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) VALUES(?,?,?,'completed',1,'{}','synthetic-no-provider','synthetic-assistant','{}','2026-10-27','2026-10-27')").bind(generation,p,admitted.ticket.id),
  app.db.prepare('INSERT INTO ai_generation_sources VALUES(?,?,?,?)').bind(generation,p,`article:${article}`,version),
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash) VALUES(?,?,?,?,'synthetic-assistant','ai','Private account answer from the guide',(SELECT coalesce(max(revision),0)+1 FROM messages WHERE conversation_id=?),?,'synthetic-intent')").bind(answer,p,admitted.ticket.id,`generation:${generation}`,admitted.ticket.id,Date.now())
 ])
 const detail=async identity=>app.ok(`/api/portal/${p}/tickets/${admitted.ticket.id}`,identity)
 assert.ok((await detail(reader)).messages.some(message=>message.id===answer),'the independently entitled requester can read the stored answer')
 assert.ok(!(await detail(peer)).messages.some(message=>message.id===answer),'company ticket visibility never implies knowledge entitlement')
 await app.call(grants,{...owner,method:'PUT',body:{contactIds:[contact,peerId]},status:200})
 assert.ok((await detail(peer)).messages.some(message=>message.id===answer),'the company viewer needs their own current knowledge grant')
 await app.call(grants,{...owner,method:'PUT',body:{contactIds:[contact]},status:200})
 assert.ok(!(await detail(peer)).messages.some(message=>message.id===answer),'viewer revocation suppresses the stored answer immediately')
 const restricted=await read(reader)
 await app.call(grants,{...owner,method:'PUT',body:{contactIds:[]},status:200})
 await submit(restricted);assert.equal(await count(),initial,'restricted access is rechecked at attribution admission')
 await app.call(grants,{...owner,method:'PUT',body:{required:false,contactIds:[]},status:200})
 assert.equal((await app.call(`/help/${p}/authority-guide`)).status,200,'explicitly removing the named-account requirement makes a public collection public')
}
