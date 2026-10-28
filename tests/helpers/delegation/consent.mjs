import assert from 'node:assert/strict'
import {applicationsApp,challengeOf,consentPage,decide} from './applications.mjs'

// Native consent, PKCE, scoped evidence, atomic article repair, stale and audience
// revisions, erasure and revocation, all through the application's own routes.
export async function consentJourney(){
 const t=await applicationsApp(),{run,one,call}=t
 try{
  await run("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('p','Support','widget-p','https://customer.test',1),('q','Other','widget-q','https://other.test',1)")
  await run("INSERT INTO users(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',1),('peer','peer@test.example','Peer',1)");await run("INSERT INTO memberships VALUES('p','owner','owner'),('p','peer','operator')")
  await t.session('native-session','owner','p','owner')
  await run("INSERT INTO contacts(id,project_id,name,created_at) VALUES('contact','p','Customer',1)");await run("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('case','p','contact',1,1)")
  await run("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('msg','p','case','client-msg','contact','contact','Private question',1,1)")
  await run("INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES('article','p','guide','Guide','Original','Summary','draft',1)")
  const register={account_id:'p',id:'slate',origin:'https://slate.test',redirect_uri:'https://slate.test/callback'}
  assert.equal((await call('/delegation/settings/clients',{cookie:'native-session',form:true,body:register})).status,303)
  assert.equal((await call('/delegation/settings/clients',{cookie:'native-session',form:true,body:{...register,id:'evil',redirect_uri:'https://evil.test'},origin:'https://evil.test'})).status,403,'a cross-site form cannot register an application')
  const target='projects/p/articles/article',caseTarget='projects/p/conversations/case',verifier='v'.repeat(64),challenge=await challengeOf(verifier)
  const request={client_id:'slate',redirect_uri:register.redirect_uri,response_type:'code',state:'opaque-state',code_challenge:challenge,code_challenge_method:'S256',account_id:'p',scope:'support.conversation.read knowledge.article.read knowledge.article.update knowledge.article.publish',targets:JSON.stringify([target,caseTarget])}
  // Approve on the consent screen, then exchange the single-use code with the PKCE verifier.
  async function connect(scope=request.scope){
   const page=await consentPage(call,new URLSearchParams({...request,scope}),'native-session');assert.equal(page.request.origin,'https://slate.test');assert.equal(page.project.name,'Support')
   const approved=await decide(call,page,'approve','native-session');assert.equal(approved.status,303);assert.equal((await decide(call,page,'approve','native-session')).status,400,'a consent form is single use')
   const redirect=new URL(approved.headers.get('location'));assert.equal(redirect.searchParams.get('state'),'opaque-state')
   const tokenBody={grant_type:'authorization_code',client_id:'slate',redirect_uri:register.redirect_uri,code:redirect.searchParams.get('code'),code_verifier:verifier}
   assert.equal((await call('/api/delegation/v1/token',{form:true,body:{...tokenBody,code_verifier:'x'.repeat(64)}})).status,401,'a wrong verifier is refused')
   const exchange=await call('/api/delegation/v1/token',{form:true,body:tokenBody});assert.equal(exchange.status,200);assert.equal((await call('/api/delegation/v1/token',{form:true,body:tokenBody})).status,401,'a code is single use')
   return (await exchange.json()).access_token
  }
  await t.session('peer-session','peer','p','operator')
  assert.equal((await call('/delegation/settings/clients',{cookie:'peer-session',form:true,body:{...register,id:'peer-app'}})).status,403)
  const badRedirect=new URLSearchParams({...request,redirect_uri:register.redirect_uri+'/extra'})
  assert.equal((await call('/delegation/authorize/request?'+badRedirect,{cookie:'native-session'})).status,400)
  const deniedPage=await consentPage(call,new URLSearchParams(request),'native-session')
  assert.equal((await decide(call,deniedPage,'deny','native-session')).status,303)
  assert.equal((await decide(call,deniedPage,'approve','native-session')).status,400)
  const token=await connect(),api=(path,body)=>call('/api/delegation/v1'+path,{token,body})
  const source=async()=>{const response=await api('/evidence?target='+target);assert.equal(response.status,200);return response.json()}
  const audience=async(status='draft')=>(await api('/audience?'+new URLSearchParams({target,operation:'happytohelp.article.update',intendedStatus:status}))).json()
  // The grant is a bearer for selected targets only; a native session is not a grant and a grant is not a session.
  assert.equal((await call('/api/delegation/v1/identity',{token:'native-session'})).status,401);assert.equal((await call('/api/delegation/v1/identity',{cookie:token})).status,401)
  assert.equal((await api('/identity')).status,200);assert.equal((await api('/evidence?target=projects/q/articles/article')).status,403)
  const first=await source();assert.equal(first.audience.kind,'source-principals');assert.match((await (await api('/evidence?target='+caseTarget)).json()).text,/Private question/)
  const draftAudience=await audience();assert.deepEqual(draftAudience.principalIds,['owner','peer']);const publicAudience=await audience('published');assert.equal(publicAudience.kind,'public');assert.notEqual(draftAudience.audienceRevision,publicAudience.audienceRevision)
  // One atomic repair with an exact receipt; replay returns it, a changed payload conflicts.
  const content={title:'Repaired guide',content:'Publication safe text',summary:'Fixed',status:'published'}
  const effect={operationKey:'repair-one',operation:'happytohelp.article.update',target,expectedRevision:first.revision,expectedAudienceRevision:publicAudience.audienceRevision,content}
  const result=await api('/effects',effect);assert.equal(result.status,200,await result.clone().text());const confirmed=await result.json();assert.equal(confirmed.receipt.afterRevision,(await source()).revision)
  const concurrent=await Promise.all([api('/effects',effect),api('/effects',effect)]);for(const replay of concurrent)assert.equal(replay.status,200);assert.equal((await api('/effects',{...effect,content:{...content,title:'Changed replay'}})).status,409)
  assert.equal((await one('SELECT count(*) n FROM edition_receipts')).n,1);assert.equal((await api('/effects/repair-one')).status,200);assert.equal((await api('/effects/missing')).status,404)
  assert.equal((await (await call('/api/knowledge/public/p/articles/guide')).json()).content,'Publication safe text','the repair is published through native help')
  // A later native edit is observed, not overwritten; an effect from the old revision is stale.
  await run("UPDATE knowledge_articles SET content='Native edit',updated_at=1 WHERE id='article'");assert.notEqual((await source()).revision,confirmed.receipt.afterRevision)
  const reconciled=await (await api('/effects/repair-one')).json();assert.equal(reconciled.receipt.afterRevision,confirmed.receipt.afterRevision);assert.notEqual(reconciled.observed.revision,reconciled.receipt.afterRevision)
  assert.equal((await api('/effects',{...effect,operationKey:'stale'})).status,409)
  // A category added to the selected article changes its evidence revision too.
  const beforeCategory=await source(),intended=await audience(content.status)
  await run("INSERT INTO knowledge_categories(id,project_id,name,slug) VALUES('cat','p','Refunds','refunds')")
  await run("INSERT INTO knowledge_article_categories(article_id,category_id) VALUES('article','cat')")
  assert.equal((await api('/effects',{...effect,operationKey:'category-stale',expectedRevision:beforeCategory.revision,expectedAudienceRevision:intended.audienceRevision})).status,409)
  // An audience change between read and write conflicts; a narrower grant cannot read the publication audience.
  const oldAudience=await audience();await run("DELETE FROM memberships WHERE user_id='peer'");const current=await source()
  assert.equal((await api('/effects',{...effect,operationKey:'audience-race',expectedRevision:current.revision,expectedAudienceRevision:oldAudience.audienceRevision,content:{...content,status:'draft'}})).status,409)
  const narrow=await connect('knowledge.article.read knowledge.article.update')
  assert.equal((await call('/api/delegation/v1/audience?'+new URLSearchParams({target,operation:'happytohelp.article.update',intendedStatus:'published'}),{token:narrow})).status,403)
  // The exact receipt survives restart, but current authority is checked even for a receipt read.
  await t.app.configure({});assert.equal((await api('/effects/repair-one')).status,200)
  await run("UPDATE edition_clients SET enabled=0 WHERE id='slate'");assert.equal((await api('/effects/repair-one')).status,401)
  await run("UPDATE edition_clients SET enabled=1 WHERE id='slate'")
  // Erased evidence is gone; membership loss suspends the grant; revoking ends it.
  await run("UPDATE messages SET content='',erased_at=1 WHERE id='msg'");assert.equal((await api('/check?target='+caseTarget)).status,404)
  const settings=await call('/delegation/settings/data?account_id=p',{cookie:'native-session'});assert.equal(settings.status,200);assert.ok((await settings.json()).data.grants.some(grant=>!grant.revokedAt))
  await run("DELETE FROM memberships WHERE user_id='owner'");assert.equal((await api('/identity')).status,401);assert.equal((await api('/effects/repair-one')).status,401)
  await run("INSERT INTO memberships VALUES('p','owner','owner')");assert.equal((await api('/revoke',{})).status,200);assert.equal((await api('/identity')).status,401);assert.equal((await api('/effects/repair-one')).status,401)
 }finally{await t.close()}
}
