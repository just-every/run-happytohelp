import assert from 'node:assert/strict'

// Extend the existing reference journey through current grants, memberships,
// publication, recipient changes and the kit's real statement-boundary races.
export async function referenceAuthority({k,body,article,category,a,b,c,send,grants,call,app,p,insert,issued,mail}){
 const base=`/api/management/projects/${p}`,knowledge=`/api/knowledge/${p}`,publicBase=`/api/knowledge/public/${p}`,grantPath=`${knowledge}/categories/${category}/entitlements`
 const marker=body.split('. ')[0],token=/⟦k:[a-f0-9]{32}⟧/
 const absent=(value,label)=>{const serialized=JSON.stringify(value);assert.ok(!serialized.includes(body),label);assert.ok(!serialized.includes(marker),label);assert.doesNotMatch(serialized,token,label)}
 const transcript=async customer=>(await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,status:200})).data
 const visible=async(customer,label)=>assert.ok(JSON.stringify(await transcript(customer)).includes(body),label)
 const hidden=async(customer,label)=>absent(await transcript(customer),label)
 const help=async(customer,status)=>app.call(`${publicBase}/articles/restoration`,{token:customer.token,status})
 const email=async customer=>(await call(`/api/dashboard/projects/${p}/conversations/${customer.conversation.id}`,{status:200})).data.data.contact.email
 const note='Please keep this request in my account history.'
 async function customerNote(customer){
  const head=await transcript(customer)
  await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,body:{localId:crypto.randomUUID(),content:note,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId},status:200})
 }
 async function refused(customer,label,options){
  const before=await transcript(customer),sent=mail.length
  const response=options?await call(`/api/conversations/${customer.conversation.id}/messages`,options):await send(customer,insert.token)
  assert.equal(response.status,409,label)
  assert.ok(response.data.blockedReferences?.length,label)
  assert.deepEqual((await transcript(customer)).messages.map(message=>message.id),before.messages.map(message=>message.id),label+' stores no message')
  assert.equal(mail.length,sent,label+' sends no mail')
 }
 const apiMessages=async customer=>(await app.call(`/api/v1/conversations/${customer.conversation.id}/messages`,{token:issued.token,status:200})).data
 const aEmail=await email(a)
 async function transcriptMail(headers){
  return call(`/api/dashboard/projects/${p}/conversations/${a.conversation.id}`,{method:'PUT',body:{send_transcript_to:aEmail,idempotencyKey:crypto.randomUUID()},...(headers?{headers}:{})})
 }
 async function delivered(){
  const before=mail.length,response=await transcriptMail()
  assert.equal(response.status,200,JSON.stringify(response.data))
  assert.equal(response.data.transcript_delivery.state,'sent')
  assert.ok(mail.slice(before).some(message=>String(message.text||'').includes(body)||String(message.html||'').includes(body)),'authorized transcript reaches the captured provider with the pinned article text')
  for(const message of mail.slice(before))assert.doesNotMatch(JSON.stringify(message),token)
 }
 async function blockedTranscript(label){
  const before=mail.length,response=await transcriptMail()
  assert.equal(response.status,200);assert.equal(response.data.transcript_delivery.state,'failed')
  assert.equal(mail.length,before,label+' blocks delivery before the provider')
 }
 async function inaccessibleHelp(label,hiddenCategories=[]){
  for(const [path,options,status] of [
   [`${publicBase}/articles/restoration`,{},404],
   [`${publicBase}/articles`,{},200],
   [`${publicBase}/categories`,{},200],
   [`${publicBase}/experience`,{},200],
   [`${publicBase}/search?q=indigo`,{},200],
   [`${publicBase}/articles/restoration/helpful`,{body:{helpful:true}},404],
   [`${publicBase}/events`,{body:{kind:'view',slug:'restoration'}},404],
   [`${publicBase}/events`,{body:{kind:'click',slug:'restoration'}},404],
   [`/api/v1/articles/${article}?contact_id=${a.contactId}`,{token:issued.token},404],
   [`/api/v1/articles?contact_id=${a.contactId}`,{token:issued.token},200],
  ]){
   const response=await app.call(path,{token:a.token,...options,status})
   absent(response.data,label+': '+path)
   if(path===`${publicBase}/articles`)assert.ok(!response.data.some(row=>row.id===article))
   if(path===`${publicBase}/categories`)assert.ok(!response.data.some(row=>hiddenCategories.includes(row.id)))
   if(path.startsWith('/api/v1/articles?'))assert.ok(!response.data.data.some(row=>row.id===article))
  }
 }

 // Company membership is explicit and conveys no grant until the owner names
 // the company. A keeps an independent contact grant while B uses the company.
 const company=(await call(`${base}/companies`,{body:{name:'Recovery account',domains:[],attributes:{}},status:201})).data.company
 await call(`${base}/companies/${company.id}/members/${b.contactId}`,{method:'PUT',body:{},status:200})
 await grants([a.contactId])
 await help(b,404)
 await call(grantPath,{method:'PUT',body:{required:true,contactIds:[a.contactId],companyIds:[company.id]},status:200})
 await help(b,200);await help(c,404)
 assert.equal((await send(b,insert.token)).status,200)
 await visible(b,'a current explicitly granted company member receives the reference')
 await call(`${base}/companies/${company.id}/members/${b.contactId}`,{method:'DELETE',status:200})
 await help(b,404);await hidden(b,'company membership removal withdraws stored knowledge on the next read')
 absent(await apiMessages(b),'API reads also observe removed company membership')
 await refused(b,'removed company membership refuses the next delivery')
 await visible(a,'another independently entitled reader keeps their own content')
 await call(`${base}/companies/${company.id}/members/${b.contactId}`,{method:'PUT',body:{},status:200})
 await help(b,200);await visible(b,'re-adding explicit membership restores the pinned reference')
 assert.equal((await send(b,insert.token)).status,200)
 await grants([a.contactId])

 await customerNote(a)
 await delivered()
 const ancestor=(await call(`${knowledge}/categories`,{body:{title:'Recovery governance',audience:'public'},status:201})).data.id
 await call(`${knowledge}/categories/${category}`,{method:'PUT',body:{parentId:ancestor},status:200})
 await help(a,200)
 await call(`${knowledge}/categories/${ancestor}`,{method:'PUT',body:{is_published:false},status:200})
 // Every JSON help door uses the same published lineage, including mutations
 // that could otherwise acknowledge a hidden article and expose its existence.
 await inaccessibleHelp('unpublished ancestor',[ancestor,category])
 await hidden(a,'unpublished ancestry withdraws prior replies without deleting them')
 assert.ok(JSON.stringify(await transcript(a)).includes(note),'ordinary customer words remain visible')
 await refused(a,'unpublished ancestry refuses the next send')
 await blockedTranscript('unpublished ancestry')
 await call(`${knowledge}/categories/${ancestor}`,{method:'PUT',body:{is_published:true},status:200})
 await help(a,200);await visible(a,'republishing the ancestor restores prior reference text');await delivered()

 const original=(await call(`${knowledge}/articles`,{status:200})).data.find(row=>row.id===article)
 const publication={id:article,title:original.title,summary:original.summary,content:body,slug:original.slug,categoryIds:[category]}
 await call(`${knowledge}/articles`,{body:{...publication,status:'draft'},status:201})
 await inaccessibleHelp('unpublished article')
 await hidden(a,'unpublishing the article withdraws its stored references')
 await refused(a,'unpublishing the article refuses its next send')
 await blockedTranscript('unpublished article')
 await call(`${knowledge}/articles`,{body:{...publication,status:'published'},status:201})
 await visible(a,'republishing restores old snapshots despite a new publication version')

 // A new selected lineage withdraws the same pinned snapshot, independent of
 // the source's publication version. Restoring the lineage restores access.
 const other=(await call(`${knowledge}/categories`,{body:{title:'Separate selected account',audience:'selected'},status:201})).data.id
 await call(`${knowledge}/articles/${article}/categories`,{method:'PUT',body:{categoryIds:[other]},status:200})
 await help(a,404);await hidden(a,'moving the article into an ungranted collection withdraws old references')
 await refused(a,'the changed collection is enforced at the next send')
 await blockedTranscript('a new selected lineage')
 await call(`${knowledge}/articles/${article}/categories`,{method:'PUT',body:{categoryIds:[category]},status:200})
 await help(a,200);await visible(a,'restoring the article lineage restores the same pinned bytes');await delivered()

 // A participant changes the connected-app audience, not A's independently
 // authorized transcript view. Neither a new send nor command replay may leak.
 const head=await transcript(a),command={localId:crypto.randomUUID(),content:insert.token,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId}
 await call(`/api/conversations/${a.conversation.id}/messages`,{body:command,status:200})
 const participant=(await call(`/api/dashboard/projects/${p}/conversations/${a.conversation.id}/participants`,{body:{email:await email(c)},status:201})).data.data
 await refused(a,'an unentitled participant refuses a new send')
 await refused(a,'an unentitled participant refuses exact-command replay',{body:command})
 await visible(a,'the entitled requester still sees their own transcript after a recipient is added')
 absent(await apiMessages(a),'connected reads use every current recipient')
 await call(`/api/dashboard/projects/${p}/conversations/${a.conversation.id}/participants/${participant.pivot.id}`,{method:'DELETE',status:200})
 await visible(a,'removing the extra recipient preserves requester visibility')
 assert.equal((await call(`/api/conversations/${a.conversation.id}/messages`,{body:command,status:200})).data.duplicate,true,'removing the extra recipient restores exact-command replay without another stored message')
 const ccHead=await transcript(a)
 await refused(a,'an unentitled pending CC refuses admission',{body:{localId:crypto.randomUUID(),content:insert.token,expectedRevision:ccHead.revision,expectedLastMessageId:ccHead.lastMessageId,cc:[await email(c)]}})
 await visible(a,'a refused CC command does not withdraw the entitled viewer’s history')
 absent(await apiMessages(a),'a pending unentitled CC withdraws connected-application reads')
 const cleared=await transcript(a)
 await call(`/api/conversations/${a.conversation.id}/messages`,{body:{localId:crypto.randomUUID(),content:'The recipient list has been corrected.',expectedRevision:cleared.revision,expectedLastMessageId:cleared.lastMessageId,cc:[],bcc:[]},status:200})
 assert.ok(JSON.stringify(await apiMessages(a)).includes(body),'clearing pending CC restores the connected audience')

 // Existing fault headers commit one real D1 revocation at the chosen boundary;
 // setup and readback still use public routes, with no new fake database layer.
 const quote=value=>"'"+value.replaceAll("'","''")+"'"
 const revoke=`DELETE FROM knowledge_collection_entitlements WHERE project_id=${quote(p)} AND category_id=${quote(category)} AND contact_id=${quote(a.contactId)}`
 const raced=await transcript(a)
 await refused(a,'statement-time revocation wins message admission',{headers:{'x-test-statement':'INSERT INTO messages','x-test-before-statement':revoke},body:{localId:crypto.randomUUID(),content:insert.token,expectedRevision:raced.revision,expectedLastMessageId:raced.lastMessageId}})
 assert.ok(!(await call(grantPath,{status:200})).data.accounts.some(account=>account.id===a.contactId),'the admission race committed its revocation')
 await hidden(a,'the committed admission-time revocation also withdraws prior replies')
 await grants([a.contactId])
 const beforeClaim=mail.length,claim=await transcriptMail({'x-test-statement':'UPDATE email_deliveries SET updated_at','x-test-before-statement':revoke})
 assert.equal(claim.status,200);assert.equal(claim.data.transcript_delivery.state,'failed')
 assert.equal(mail.length,beforeClaim,'revocation at the final mail claim reaches no provider')
 assert.ok(!(await call(grantPath,{status:200})).data.accounts.some(account=>account.id===a.contactId),'the delivery-claim race committed its revocation')
 await grants([a.contactId]);await visible(a,'a new grant restores reads after both races');await delivered()
}
