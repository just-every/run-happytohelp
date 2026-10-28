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
  const token=await connect(),api=(path,body)=>call('/api/delegation/v1'+path,{token,body})
  const source=async()=>{const response=await api('/evidence?target='+target);assert.equal(response.status,200);return response.json()}
  const audience=async(status='draft')=>(await api('/audience?'+new URLSearchParams({target,operation:'happytohelp.article.update',intendedStatus:status}))).json()
  // The grant is a bearer for selected targets only; a native session is not a grant and a grant is not a session.
  assert.equal((await call('/api/delegation/v1/identity',{token:'native-session'})).status,401);assert.equal((await call('/api/delegation/v1/identity',{cookie:token})).status,401)
  assert.equal((await api('/identity')).status,200);assert.equal((await api('/evidence?target=projects/q/articles/article')).status,403)
  const first=await source();assert.equal(first.audience.kind,'source-principals');assert.match((await (await api('/evidence?target='+caseTarget)).json()).text,/Private question/)
  const draftAudience=await audience();assert.deepEqual(draftAudience.principalIds,['owner','peer']);const publicAudience=await audience('published');assert.equal(publicAudience.kind,'source-principals','an intended publication is not public evidence before publication');assert.notEqual(draftAudience.audienceRevision,publicAudience.audienceRevision)
  // One atomic repair with an exact receipt; replay returns it, a changed payload conflicts.
  const content={title:'Repaired guide',content:'Publication safe text',summary:'Fixed',status:'published'}
  const effect={operationKey:'repair-one',operation:'happytohelp.article.update',target,expectedRevision:first.revision,expectedAudienceRevision:publicAudience.audienceRevision,content}
  const result=await api('/effects',effect);assert.equal(result.status,200,await result.clone().text());const confirmed=await result.json();const published=await source();assert.equal(confirmed.receipt.afterRevision,published.revision);assert.equal(published.audience.kind,'public','the published public lineage is classified as public evidence')
  assert.equal((await api('/effects',effect)).status,200);assert.equal((await api('/effects',{...effect,content:{...content,title:'Changed replay'}})).status,409)
  assert.equal((await one('SELECT count(*) n FROM edition_receipts')).n,1);assert.equal((await api('/effects/repair-one')).status,200);assert.equal((await api('/effects/missing')).status,404)
  assert.equal((await (await call('/api/knowledge/public/p/articles/guide')).json()).content,'Publication safe text','the repair is published through native help')
  // A later native edit is observed, not overwritten; an effect from the old revision is stale.
  await run("UPDATE knowledge_articles SET content='Native edit',updated_at=1 WHERE id='article'");assert.notEqual((await source()).revision,confirmed.receipt.afterRevision)
  const reconciled=await (await api('/effects/repair-one')).json();assert.equal(reconciled.receipt.afterRevision,confirmed.receipt.afterRevision);assert.notEqual(reconciled.observed.revision,reconciled.receipt.afterRevision)
  assert.equal((await api('/effects',{...effect,operationKey:'stale'})).status,409)
  // Unlinked categories change nothing; every link or ancestry change makes prior evidence stale.
  const beforeCategory=await source(),beforeArticle=await one("SELECT * FROM knowledge_articles WHERE id='article'")
  await run("INSERT INTO knowledge_categories(id,project_id,name,slug) VALUES('cat-root','p','Root','root'),('cat-other','p','Other root','other-root'),('unrelated','p','Unrelated','unrelated')")
  await run("INSERT INTO knowledge_categories(id,project_id,parent_id,name,slug) VALUES('cat','p','cat-root','Category','category')")
  const afterCategory=await source();assert.equal(afterCategory.revision,beforeCategory.revision);assert.equal(afterCategory.text,beforeCategory.text);assert.deepEqual(await one("SELECT * FROM knowledge_articles WHERE id='article'"),beforeArticle)
  await run("DELETE FROM knowledge_categories WHERE id='unrelated'");assert.equal((await source()).revision,beforeCategory.revision)
  for(const [operationKey,sql] of [
   ['category-linked',"INSERT INTO knowledge_article_categories(article_id,category_id) VALUES('article','cat')"],['category-ancestor-edited',"UPDATE knowledge_categories SET name='Renamed root' WHERE id='cat-root'"],
   ['category-reparented',"UPDATE knowledge_categories SET parent_id='cat-other' WHERE id='cat'"],['category-unlinked',"DELETE FROM knowledge_article_categories WHERE article_id='article' AND category_id='cat'"],
   ['primary-category-linked',"UPDATE knowledge_articles SET category_id='cat' WHERE id='article'"],['primary-category-unlinked',"UPDATE knowledge_articles SET category_id=NULL WHERE id='article'"],
   ['category-relinked',"INSERT INTO knowledge_article_categories(article_id,category_id) VALUES('article','cat')"],['category-deleted',"DELETE FROM knowledge_categories WHERE id='cat'"],
  ]){
   const before=await source(),intended=await audience(content.status);await run(sql)
   const after=await source(),article=await one("SELECT * FROM knowledge_articles WHERE id='article'");assert.notEqual(after.revision,before.revision,operationKey)
   const rejected=await api('/effects',{...effect,operationKey,expectedRevision:before.revision,expectedAudienceRevision:intended.audienceRevision});assert.equal(rejected.status,409,operationKey);assert.equal((await rejected.json()).error.code,'REVISION_CONFLICT',operationKey)
   assert.deepEqual(await one("SELECT * FROM knowledge_articles WHERE id='article'"),article,operationKey);assert.equal((await api('/effects/'+operationKey)).status,404,operationKey)
   const observed=await (await api('/effects/repair-one')).json();assert.equal(observed.receipt.afterRevision,confirmed.receipt.afterRevision);assert.equal(observed.observed.revision,after.revision)
  }
  assert.deepEqual(JSON.parse((await source()).text).categories,[])
  // An audience change between read and write conflicts; a narrower grant cannot read the publication audience.
  const oldAudience=await audience();await run("DELETE FROM memberships WHERE user_id='peer'");const current=await source()
  assert.equal((await api('/effects',{...effect,operationKey:'audience-race',expectedRevision:current.revision,expectedAudienceRevision:oldAudience.audienceRevision,content:{...content,status:'draft'}})).status,409)
  const narrow=await connect('knowledge.article.read knowledge.article.update')
  assert.equal((await call('/api/delegation/v1/audience?'+new URLSearchParams({target,operation:'happytohelp.article.update',intendedStatus:'published'}),{token:narrow})).status,403)
  // Erased evidence is gone; membership loss suspends the grant; revoking ends it.
  await run("UPDATE messages SET content='',erased_at=1 WHERE id='msg'");assert.equal((await api('/check?target='+caseTarget)).status,404)
  const settings=await call('/delegation/settings/data?account_id=p',{cookie:'native-session'});assert.equal(settings.status,200);assert.ok((await settings.json()).data.grants.some(grant=>!grant.revokedAt))
  await run("DELETE FROM memberships WHERE user_id='owner'");assert.equal((await api('/identity')).status,401);assert.equal((await api('/effects/repair-one')).status,401)
  await run("INSERT INTO memberships VALUES('p','owner','owner')");assert.equal((await api('/revoke',{})).status,200);assert.equal((await api('/identity')).status,401);assert.equal((await api('/effects/repair-one')).status,401)
 }finally{await t.close()}
}

// Settings and consent data re-check the session, project and role; decisions land back in the app.
export async function pagesJourney(){
 const t=await applicationsApp('documents-installation'),{run,one,call}=t
 try{
  await run("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('p','Support','widget-p','https://customer.test',1),('q','Other','widget-q','https://other.test',1)")
  await run("INSERT INTO users(id,email,name,created_at) VALUES('owner','owner@test.example','Owner Person',1),('operator','op@test.example','Operator',1),('outsider','out@test.example','Outsider',1)")
  await run("INSERT INTO memberships VALUES('p','owner','owner'),('p','operator','operator'),('q','outsider','owner')")
  for(const [token,user,project,role] of [['owner-session','owner','p','owner'],['operator-session','operator','p','operator'],['outsider-session','outsider','q','owner']])await t.session(token,user,project,role)
  const client={account_id:'p',id:'docs',origin:'https://docs.test',redirect_uri:'https://docs.test/callback'}
  // Registering: the owner can, a duplicate is a distinct conflict, an operator cannot.
  assert.equal((await call('/delegation/settings/clients',{cookie:'owner-session',form:true,body:client})).status,303)
  const duplicate=await call('/delegation/settings/clients',{cookie:'owner-session',form:true,body:client});assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error.code,'CLIENT_EXISTS')
  assert.equal((await call('/delegation/settings/clients',{cookie:'operator-session',form:true,body:{...client,id:'op'}})).status,403)
  // Settings data: the member's own project, its grants, and who may register.
  assert.equal((await call('/delegation/settings/data?account_id=p')).status,401);assert.equal((await call('/delegation/settings/data?account_id=p',{cookie:'outsider-session'})).status,403);assert.equal((await call('/delegation/settings/data',{cookie:'owner-session'})).status,400)
  const ownerResponse=await call('/delegation/settings/data?account_id=p',{cookie:'owner-session'});assert.equal(ownerResponse.headers.get('cache-control'),'no-store')
  const owner=(await ownerResponse.json()).data
  assert.deepEqual({project:owner.project,role:owner.role,canRegister:owner.canRegister,grants:owner.grants,clients:owner.clients},{project:'p',role:'owner',canRegister:true,grants:[],clients:[{id:'docs',origin:'https://docs.test',redirectUri:'https://docs.test/callback'}]})
  assert.equal((await (await call('/delegation/settings/data?account_id=p',{cookie:'operator-session'})).json()).data.canRegister,false)
  // Consent data is bound to the session; approval redirects to the application, cancel returns to settings.
  const query=new URLSearchParams({client_id:'docs',account_id:'p',redirect_uri:client.redirect_uri,response_type:'code',state:'1e3',code_challenge:'a'.repeat(43),code_challenge_method:'S256',scope:'knowledge.article.read knowledge.article.update',targets:JSON.stringify(['projects/p/articles/a'])})
  assert.equal((await call('/delegation/authorize/request?'+query)).status,401);assert.equal((await call('/delegation/authorize/request?'+query,{cookie:'outsider-session'})).status,403);assert.equal((await call('/delegation/authorize/request?client_id=docs',{cookie:'owner-session'})).status,400)
  const badRedirect=new URLSearchParams(query);badRedirect.set('redirect_uri','https://docs.test/callback/extra');assert.equal((await call('/delegation/authorize/request?'+badRedirect,{cookie:'owner-session'})).status,400,'only the exact registered callback')
  const first=await consentPage(call,query,'owner-session');assert.deepEqual(first.principal,{id:'owner',name:'Owner Person',email:'owner@test.example'});assert.deepEqual(first.project,{id:'p',name:'Support'});assert.deepEqual(first.request.scope,['knowledge.article.read','knowledge.article.update'])
  assert.equal((await decide(call,first,'approve','operator-session')).status,400,'another session cannot use the form')
  const approved=await decide(call,first,'approve','owner-session');assert.equal(approved.status,303);const callback=new URL(approved.headers.get('location'));assert.equal(callback.origin+callback.pathname,client.redirect_uri);assert.equal(callback.searchParams.get('state'),'1e3');assert.ok(callback.searchParams.get('code'))
  const second=await consentPage(call,query,'owner-session'),cancelled=await decide(call,second,'deny','owner-session');assert.equal(cancelled.status,303);assert.equal(cancelled.headers.get('location'),'/delegation/settings?account_id=p&cancelled=1')
  assert.equal((await decide(call,second,'approve','owner-session')).status,400,'a cancelled form cannot be approved later')
  assert.equal((await one("SELECT count(*) n FROM edition_grants WHERE project_id='p'")).n,1)
  const after=(await (await call('/delegation/settings/data?account_id=p',{cookie:'owner-session'})).json()).data
  assert.deepEqual(after.grants.map(g=>({clientId:g.clientId,scopes:g.scopes,targets:g.targets,revokedAt:g.revokedAt})),[{clientId:'docs',scopes:['knowledge.article.read','knowledge.article.update'],targets:['projects/p/articles/a'],revokedAt:null}])
  // A project deleted between the consent preflight and its atomic batch issues neither grant nor code.
  const raced=await consentPage(call,query,'owner-session')
  const refused=await decide(call,raced,'approve','owner-session',{'x-test-before-batch':`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{"deleted_at":1}',1)`})
  assert.equal(refused.status,400);assert.equal((await one("SELECT count(*) n FROM edition_grants WHERE project_id='p'")).n,1)
  await run("DELETE FROM project_settings WHERE project_id='p'")
  // Without an installation id, consent is unavailable rather than issuing unbound grants.
  await t.app.configure({RER_INSTALLATION_ID:undefined})
  assert.equal((await call('/delegation/authorize/request?'+query,{cookie:'owner-session'})).status,503)
 }finally{await t.close()}
}
