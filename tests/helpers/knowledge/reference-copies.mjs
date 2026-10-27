import assert from 'node:assert/strict'

/** Copied evidence moves through the same public doors as an ordinary reply. */
export async function referenceCopies({k,body,article,category,a,b,c,send,grants,call,app,p}){
 const transcript=async customer=>(await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,status:200})).data
 const createArticle=async(title,content,categoryIds=[category])=>(await call(`/api/knowledge/${p}/articles`,{body:{title,content,categoryIds,status:'published'},status:201})).data.id
 const editArticle=async(id,title,content)=>call(`/api/knowledge/${p}/articles`,{body:{id,title,content,categoryIds:[category],status:'published'},status:201})
 const noTokens=value=>assert.doesNotMatch(JSON.stringify(value),/⟦k:[^⟧]*⟧/u,'customer and application reads contain no opaque reference syntax')
 const refused=async(content,label)=>{
  const before=await transcript(c),response=await send(c,content)
  assert.ok([409,422].includes(response.status),`${label}: ${JSON.stringify(response.data)}`)
  assert.ok(response.data.blockedReferences?.some(reference=>reference.recipients?.some(recipient=>recipient.id===c.contactId&&!recipient.visible)),`${label}: refusal identifies the blocked customer`)
  const after=await transcript(c)
  assert.equal(after.revision,before.revision,`${label}: refused copy adds no transcript revision`)
  assert.deepEqual(after.messages.map(message=>message.id),before.messages.map(message=>message.id),`${label}: refused copy stores no reply`)
 }
 await grants([a.contactId])

 // Every stretch contains accented and full-case-fold characters, so an
 // unchanged ASCII tail cannot make a broken Unicode detector pass this case.
 const paragraphs=[
  'Café custodians verify Straße recovery ledgers before Café operators unlock Straße account controls.',
  'Café stewards preserve Straße inspection receipts until Café engineers approve Straße restoration notices.',
  'Café reviewers compare Straße recovery certificates while Café coordinators finish Straße identity checks.',
 ]
 const unicodeBody=paragraphs.join('\n\n')
 const unicodeArticle=await createArticle('Restoration custody instructions',unicodeBody)
 const variants=[
  ['punctuation within words',unicodeBody.replace(/([\p{L}\p{M}])(?=[\p{L}\p{M}])/gu,'$1,')],
  ['decomposed accents',unicodeBody.normalize('NFD')],
  ['compatibility characters',Array.from(unicodeBody,point=>/[A-Za-z]/.test(point)?String.fromCodePoint(point.codePointAt(0)+0xfee0):point).join('')],
  ['full case folding',unicodeBody.toUpperCase()],
  ['case and whitespace',unicodeBody.toUpperCase().replaceAll(' ',' \t\n ')],
  ['inline HTML within words',unicodeBody.replace(/[\p{L}\p{M}]+/gu,word=>`<strong>${word.slice(0,2)}</strong>${word.slice(2)}`)],
  ['inline Markdown within words',unicodeBody.replace(/[\p{L}\p{M}]+/gu,word=>`${word.slice(0,2)}**${word.slice(2)}**`)],
  ['HTML block boundaries',unicodeBody.split(/\s+/).map(word=>`<p>${word}</p>`).join('')],
  ['greeting in the same paragraph','Hello, I found the requested instructions: '+unicodeBody],
  ['middle sentence removed',[paragraphs[0],paragraphs[2]].join('\n\n')],
  ['paragraphs merged',paragraphs.join(' ')],
  ['HTML character entities',unicodeBody.replaceAll('é','&eacute;').replaceAll('ß','&#223;')],
 ]
 for(const [label,content] of variants)await refused(content,label)
 const allowed=await send(a,unicodeBody)
 assert.equal(allowed.status,200,JSON.stringify(allowed.data))
 assert.equal((await transcript(a)).messages.find(message=>message.id===allowed.data.message.id).content,unicodeBody,'the same copied source remains readable by its granted recipient')

 // Retained text pins what a reply says; current publication decides access.
 const oldBody='The cobalt archive keeper stores each recovery credential beneath a sealed ivory ledger while the appointed supervisor verifies the original customer identity. The silver inspection team then records a separate restoration receipt before releasing the protected account controls.'
 const versioned=await createArticle('Archive recovery instructions',oldBody)
 const pinned=(await call(`/api/knowledge/${p}/conversations/${a.conversation.id}/articles/${versioned}/insert`,{body:{mode:'text'},status:200})).data
 const pinnedReply=await send(a,pinned.token)
 assert.equal(pinnedReply.status,200,JSON.stringify(pinnedReply.data))
 const newBody='The garnet vault attendant arranges every clearance document beside an unopened bronze register while the designated inspector confirms the returning subscriber details. The turquoise review group afterwards prepares an independent access record before opening the guarded service console.'
 await editArticle(versioned,'Archive recovery instructions revised',newBody)
 await refused(newBody,'an article edit is indexed on the next reply')
 await refused(oldBody,'an earlier published article remains a copied source after editing')
 assert.equal((await transcript(a)).messages.find(message=>message.id===pinnedReply.data.message.id).content,oldBody,'editing a published article does not change or blank an earlier inserted reply')

 const settings=(await call(`/api/knowledge/${p}/experience`,{status:200})).data
 const locale=settings.defaultLocale==='fr'?'de':'fr'
 await call(`/api/knowledge/${p}/experience`,{method:'PUT',body:{...settings,locales:[...new Set([...settings.locales,locale])]},status:200})
 try{
  const translation='Les gardiens du registre protégé conservent chaque certificat de récupération dans une enveloppe scellée pendant que les responsables vérifient soigneusement les preuves originales de chaque client.'
  const reviewed='Les spécialistes de la chambre sécurisée rangent tous les documents confidentiels sous une couverture numérotée tandis que les inspecteurs autorisés contrôlent séparément les justificatifs présentés par les visiteurs.'
  const translate=content=>call(`/api/knowledge/${p}/articles/${unicodeArticle}/translations/${locale}`,{method:'PUT',body:{title:'Consignes de récupération',content,summary:'',reviewStatus:'reviewed'},status:200})
  await translate(translation)
  await refused(translation,'a newly reviewed translation is detected on the next reply')
  await translate(reviewed)
  await refused(reviewed,'replacement translation publication is detected immediately')
  await refused(translation,'earlier published translation bytes remain protected after replacement')
  const draft='Des voyageurs observent les oiseaux près du jardin municipal pendant que plusieurs musiciens préparent tranquillement leur concert dans une grande salle ouverte aux habitants du quartier.'
  await call(`/api/knowledge/${p}/articles/${unicodeArticle}/translations/${locale}`,{method:'PUT',body:{title:'Projet non publié',content:draft,reviewStatus:'draft'},status:200})
  const drafted=await send(c,draft)
  assert.equal(drafted.status,200,JSON.stringify(drafted.data))
  assert.equal((await transcript(c)).messages.find(message=>message.id===drafted.data.message.id).content,draft,'unpublished editorial drafts do not become detector sources')
 }finally{
  await call(`/api/knowledge/${p}/experience`,{method:'PUT',body:settings,status:200})
 }

 const shared='Our support team receives each request carefully and keeps the customer informed while the investigation continues toward a confirmed resolution.'
 await createArticle('Internal service conventions',shared+'\n\n'+newBody)
 const publicCategory=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Public service information',audience:'public'},status:201})).data.id
 const publicArticle=await createArticle('Service updates',shared,[publicCategory])
 const boilerplate=await send(c,shared)
 assert.equal(boilerplate.status,200,JSON.stringify(boilerplate.data))
 assert.equal((await transcript(c)).messages.find(message=>message.id===boilerplate.data.message.id).content,shared,'a public occurrence permits shared boilerplate even when another occurrence is restricted')
 const paraphrase='We can help you regain access after confirming who you are and checking that the recovery is safe.'
 const paraphrased=await send(c,paraphrase)
 assert.equal(paraphrased.status,200,JSON.stringify(paraphrased.data))
 assert.equal((await transcript(c)).messages.find(message=>message.id===paraphrased.data.message.id).content,paraphrase,'an original paraphrase remains operator speech')

 // Public help JSON exercises rendering without send admission rejecting an
 // unknown token first. A foreign public source still conveys no authority.
 const publicReference=(await call(`/api/knowledge/${p}/references/insert`,{body:{articleId:publicArticle,mode:'text'},status:200})).data
 const foreign=await app.seedWorkspace('knowledge-copies-'+crypto.randomUUID().slice(0,8))
 const foreignCall=(path,options={})=>app.call(path,{token:foreign.tokens.owner,...options})
 const unknown=publicReference.token.replace(/:[^⟧]+/u,':'+crypto.randomUUID().replaceAll('-',''))
 const prefix='Ordinary explanation before the reference. ',suffix=' Ordinary explanation after the reference.'
 const neutral=[]
 for(const [slug,token] of [['unknown-reference',unknown],['foreign-reference',publicReference.token]]){
  await foreignCall(`/api/knowledge/${foreign.projectId}/articles`,{body:{title:slug,slug,content:prefix+token+suffix,status:'published'},status:201})
  const visible=(await app.call(`/api/knowledge/public/${foreign.projectId}/articles/${slug}`,{status:200})).data
  noTokens(visible)
  assert.ok(visible.content.startsWith(prefix)&&visible.content.endsWith(suffix),'withholding a reference preserves surrounding ordinary words')
  assert.ok(!visible.content.includes(shared)&&!visible.content.includes(body),'unknown and foreign references disclose no source bytes')
  neutral.push(visible.content)
 }
 assert.equal(neutral[0],neutral[1],'unknown and wrong-project references have the same neutral rendering')

 // A customer retains their own words without receiving a knowledge grant.
 const current=await transcript(c)
 const authored=(await app.call(`/api/conversations/${c.conversation.id}/messages`,{token:c.token,body:{localId:crypto.randomUUID(),content:body,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data.message
 assert.equal((await transcript(c)).messages.find(message=>message.id===authored.id).content,body,'the unentitled author can read their own copied words')
 const account=(await call(`/api/dashboard/projects/${p}/conversations/${b.conversation.id}`,{status:200})).data.data.contact
 const participant=(await call(`/api/dashboard/projects/${p}/conversations/${c.conversation.id}/participants`,{body:{email:account.email},status:201})).data.data
 try{
  const issued=(await call(`/api/management/projects/${p}/connections/tokens`,{body:{name:'Copied text reader',scopes:['conversations:read']},status:201})).data
  const read=async()=>(await app.call(`/api/v1/conversations/${c.conversation.id}/messages`,{token:issued.token,status:200})).data
  const withheld=await read(),hidden=withheld.data.find(message=>message.id===authored.id)
  assert.ok(hidden,'the application receives the admitted message identity')
  assert.notEqual(hidden.content,body,'the author exception does not authorize an unentitled second reader')
  assert.ok(!JSON.stringify(withheld).includes(body))
  noTokens(withheld)
  assert.equal((await transcript(c)).messages.find(message=>message.id===authored.id).content,body,'another recipient losing access does not blank the author’s view')
  await grants([a.contactId,b.contactId])
  assert.equal((await read()).data.find(message=>message.id===authored.id).content,body,'granting the other reader restores the same authored copy')
 }finally{
  await call(`/api/dashboard/projects/${p}/conversations/${c.conversation.id}/participants/${participant.pivot.id}`,{method:'DELETE',status:200})
  await grants([a.contactId])
 }
}
