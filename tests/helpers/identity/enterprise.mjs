import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inflateRawSync} from 'node:zlib'
import {generateKeyPair,exportJWK,SignJWT} from 'jose'
import {startApp} from '../../journeys/kit/app.mjs'
import {challengeOf,consentPage,decide} from '../delegation/applications.mjs'
const require=createRequire(import.meta.url),{SignedXml}=require(require.resolve('xml-crypto',{paths:[require.resolve('@node-saml/node-saml')]}))
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')

async function samlSigner(){
 const directory=await mkdtemp(join(tmpdir(),'h2h-saml-'))
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-subj','/CN=synthetic-happytohelp-1','-days','1'],{stdio:'ignore'})
  const key=await readFile(join(directory,'key.pem'),'utf8'),certificate=await readFile(join(directory,'cert.pem'),'utf8')
  const sign=(xml,node)=>{const signer=new SignedXml({privateKey:key,publicCert:certificate,signatureAlgorithm:'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',canonicalizationAlgorithm:'http://www.w3.org/2001/10/xml-exc-c14n#'});signer.addReference({xpath:`//*[local-name()='${node}']`,transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],digestAlgorithm:'http://www.w3.org/2001/04/xmlenc#sha256'});signer.computeSignature(xml,{location:{reference:`//*[local-name()='${node}']/*[local-name()='Issuer']`,action:'after'}});return signer.getSignedXml()}
  return {certificate,answer({issuer,requestId,recipient,audience,subject,expired=false,wrongRecipient=false,tamper=false}){
   const now=new Date().toISOString(),until=new Date(Date.now()+(expired?-60000:180000)).toISOString()
   let xml=`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${escape(recipient)}" InResponseTo="${escape(requestId)}"><saml:Issuer>${escape(issuer)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}"><saml:Issuer>${escape(issuer)}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${escape(subject)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${escape(requestId)}" Recipient="${escape(wrongRecipient?'https://elsewhere.example/callback':recipient)}" NotOnOrAfter="${until}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${new Date(Date.now()-30000).toISOString()}" NotOnOrAfter="${until}"><saml:AudienceRestriction><saml:Audience>${escape(audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now}" SessionIndex="synthetic-happytohelp-2"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`
   xml=sign(sign(xml,'Assertion'),'Response');if(tamper)xml=xml.replace(escape(subject),'attacker')
   return Buffer.from(xml).toString('base64')
  }}
 }finally{await rm(directory,{recursive:true,force:true})}
}

export async function enterpriseJourney(){
 const signing=await samlSigner(),keys=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-happytohelp-3'},codes=new Map()
 const app=await startApp({bindings:{RER_INSTALLATION_ID:'synthetic-happytohelp-4',APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,6).toString('base64')},outbound:async(request,entry)=>{
  const url=new URL(request.url)
  if(url.pathname.endsWith('/keys'))return Response.json({keys:[jwk]})
  assert.equal(url.pathname,'/token');const form=new URLSearchParams(entry.body),issued=codes.get(form.get('code'));assert.ok(issued,'only an issued authorization code is exchanged')
  assert.equal(form.get('client_secret'),'synthetic-happytohelp-5');assert.equal(await challengeOf(form.get('code_verifier')),issued.challenge)
  assert.equal(form.get('redirect_uri'),issued.callback)
  const token=await new SignJWT({nonce:issued.nonce,...issued.claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issued.issuer).setAudience(issued.audience).setSubject(issued.subject).setIssuedAt().setExpirationTime(issued.expired?new Date(Date.now()-60000):'3m').sign(keys.privateKey)
  return Response.json({id_token:token})
 }})
 try{
  for(const protocol of ['oidc','saml']){
   const w=await app.seedWorkspace('enterprise-'+protocol),other=await app.seedWorkspace('foreign-'+protocol),P=`/api/management/projects/${w.projectId}`,owner=w.tokens.owner
   const input={protocol,issuer:'https://synthetic-happytohelp.okta.com',clientId:'synthetic-happytohelp-6',clientSecret:'synthetic-happytohelp-5',authorizationEndpoint:'https://synthetic-happytohelp.okta.com/authorize',tokenEndpoint:'https://synthetic-happytohelp.okta.com/token',jwksUri:'https://synthetic-happytohelp.okta.com/keys',entryPoint:'https://synthetic-happytohelp.okta.com/saml',certificate:signing.certificate}
   assert.equal((await app.call(P+'/identity-connections',{token:w.tokens.admin,body:input})).status,403,'provider configuration never replaces native owner authority')
   const connection=(await app.ok(P+'/identity-connections',{token:owner,body:input})).data,base=new URL(connection.scimBase).pathname,token=connection.scimToken
   assert.equal((await app.call(base+'/Users',{token:other.tokens.owner})).status,401)
   assert.equal((await app.call(base+'/Users',{token,body:{externalId:'owner',userName:`owner-enterprise-${protocol}@example.test`}})).status,409,'SCIM cannot take over an existing native account')
   const principal=await app.ok(base+'/Users',{token,body:{externalId:'synthetic-happytohelp-7',userName:`staff-${protocol}@example.test`,displayName:'Provisioned staff',active:true}})
   assert.equal((await app.ok(base+'/Users?filter='+encodeURIComponent('userName eq "'+principal.userName+'"'),{token})).totalResults,1)
   const user=(await app.first('SELECT user_id FROM enterprise_principals WHERE id=?',principal.id)).user_id
   const begin=async(overrides={})=>{
    const response=await app.request(new URL(connection.signInUrl).pathname),location=new URL(response.headers.get('location')),cookie=response.headers.get('set-cookie').split(';')[0]
    assert.equal(response.status,302)
    if(protocol==='oidc'){
     const code=crypto.randomUUID(),state=location.searchParams.get('state');codes.set(code,{nonce:location.searchParams.get('nonce'),challenge:location.searchParams.get('code_challenge'),callback:connection.callbackUrl,issuer:input.issuer,audience:input.clientId,subject:principal.externalId,...overrides})
     return {path:new URL(connection.callbackUrl).pathname+'?'+new URLSearchParams({state,code}),options:{headers:{Cookie:cookie}}}
    }
    const xml=inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest'),'base64')).toString(),requestId=xml.match(/\bID="([^"]+)"/)[1]
    return {path:new URL(connection.callbackUrl).pathname,options:{method:'POST',raw:true,headers:{Cookie:cookie,Origin:input.issuer,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({RelayState:location.searchParams.get('RelayState'),SAMLResponse:signing.answer({issuer:input.issuer,requestId,recipient:connection.callbackUrl,audience:connection.callbackUrl.replace('/callback',''),subject:principal.externalId,...overrides})}).toString()}}
   }
   const submit=attempt=>app.request(attempt.path,attempt.options)
   const accepted=await begin(),login=await submit(accepted);assert.equal(login.status,302,await login.clone().text())
   const session=login.headers.getSetCookie().find(s=>s.startsWith('h2h_session=')).split(';')[0].slice('h2h_session='.length)
   assert.equal((await submit(accepted)).status,403,'a signed assertion/code cannot be replayed')
   const mismatched=await begin();assert.equal((await app.request(mismatched.path,{...mismatched.options,headers:{...mismatched.options.headers,Cookie:''}})).status,403,'login CSRF is refused')
   for(const invalid of protocol==='oidc'?[{expired:true},{claims:{nonce:'wrong'}},{audience:'foreign'},{issuer:'https://foreign.okta.com'},{subject:'unprovisioned'}]:[{wrongRecipient:true},{audience:'foreign'},{expired:true},{tamper:true},{issuer:'foreign'}])assert.equal((await submit(await begin(invalid))).status,403,JSON.stringify(invalid))
   const concurrent=await begin(),race=await Promise.all([submit(concurrent),submit(concurrent)]);assert.deepEqual(race.map(r=>r.status).sort(),[302,403],'one request creates at most one session')
   // Owner-assigned permissions apply to SSO sessions and connected applications.
   const role=(await app.ok(P+'/roles',{token:owner,body:{name:'Identity reviewer',base:'operator',permissions:['conversations.notes','conversations.follow','knowledge.edit']}})).data
   await app.ok(P+'/agents/'+user,{token:owner,method:'PUT',body:{role:role.id}})
   for(const path of [P+'/audit/export',`/api/dashboard/projects/${w.projectId}/reports?format=summary.csv`])assert.equal((await app.call(path,{token:session})).status,403)
   assert.equal((await app.call(P+'/refund-approvals',{token:session,body:{}})).status,403)
   assert.equal((await app.call(`/api/knowledge/${w.projectId}/articles`,{token:session,body:{title:'Must not publish',content:'No'}})).status,403)
   assert.equal((await app.call(`/api/management/projects/${other.projectId}/agents`,{token:session})).status,403,'membership remains a brand boundary')
   assert.equal((await app.call(P+'/agents/'+user,{token:owner,method:'PUT',body:{role:'owner'}})).status,409)
   await app.db.prepare('INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES(?,?,?,?,?,?,?,1)').bind('article-'+protocol,w.projectId,'private','Private','Retained text','','draft').run()
   await app.ok(P+'/agents/'+user,{token:owner,method:'PUT',body:{role:'operator'}})
   const browser=(path,{cookie,body}={})=>app.request(path,{method:body?'POST':'GET',raw:true,headers:{Cookie:'h2h_session='+cookie,...(body?{'Content-Type':'application/x-www-form-urlencoded',Origin:app.origin}:{})},body:body&&new URLSearchParams(body).toString()})
   const client={account_id:w.projectId,id:'synthetic-happytohelp-8',origin:'https://client.example',redirect_uri:'https://client.example/callback'},article=`projects/${w.projectId}/articles/article-${protocol}`,verifier='synthetic-happytohelp-9'.repeat(3)
   assert.equal((await browser('/delegation/settings/clients',{cookie:owner,body:client})).status,303)
   const consent=new URLSearchParams({client_id:client.id,redirect_uri:client.redirect_uri,response_type:'code',state:'synthetic-happytohelp-10',code_challenge:await challengeOf(verifier),code_challenge_method:'S256',account_id:w.projectId,scope:'knowledge.article.read knowledge.article.update',targets:JSON.stringify([article])})
   const approved=await decide(browser,await consentPage(browser,consent,session),'approve',session);assert.equal(approved.status,303,await approved.clone().text())
   const exchange=await app.request('/api/delegation/v1/token',{method:'POST',raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.id,redirect_uri:client.redirect_uri,code:new URL(approved.headers.get('location')).searchParams.get('code'),code_verifier:verifier}).toString()})
   const grant=(await exchange.json()).access_token,delegated=(path,body)=>app.call('/api/delegation/v1'+path,{token:grant,body})
   const frontier=(await delegated('/evidence?target='+article)).data.revision,audience=(await delegated('/audience?'+new URLSearchParams({target:article,operation:'happytohelp.article.update',intendedStatus:'draft'}))).data.audienceRevision
   await app.ok(P+'/agents/'+user,{token:owner,method:'PUT',body:{role:role.id}})
   const pending=await begin()
   const switched=(await app.ok('/api/identity/switch-project',{token:session,body:{projectId:w.projectId}})).token
   await app.ok(base+'/Users/'+principal.id,{token,method:'PATCH',body:{Operations:[{op:'replace',path:'active',value:false}]}})
   for(const stale of [session,switched])assert.equal((await app.call('/api/identity/session',{token:stale})).status,401)
   assert.equal((await submit(pending)).status,403,'a callback pending at deprovisioning cannot create authority')
   assert.ok([401,403].includes((await delegated('/evidence?target='+article)).status))
   assert.ok([401,403].includes((await delegated('/effects',{operationKey:'synthetic-happytohelp-11',operation:'happytohelp.article.update',target:article,expectedRevision:frontier,expectedAudienceRevision:audience,content:{title:'Private',content:'Must not apply',summary:'',status:'draft'}})).status))
   assert.equal((await app.first('SELECT content FROM knowledge_articles WHERE id=?','article-'+protocol)).content,'Retained text')
   await app.ok(base+'/Users/'+principal.id,{token,method:'PATCH',body:{Operations:[{op:'replace',value:{active:true}}]}})
   assert.ok([401,403].includes((await delegated('/evidence?target='+article)).status),'reactivation does not resurrect a grant')
   assert.equal((await app.first('SELECT role_key FROM member_roles WHERE project_id=? AND user_id=?',w.projectId,user)).role_key,'collaborator')
   const rotated=await app.ok(P+'/identity-connections/'+connection.id+'/token',{token:owner,body:{}})
   assert.equal((await app.call(base+'/Users',{token})).status,401);assert.equal((await app.call(base+'/Users',{token:rotated.scimToken})).status,200)
   await app.ok(P+'/identity-connections/'+connection.id,{token:owner,method:'DELETE'})
   assert.equal((await app.call('/api/identity/session',{token:owner})).status,200,'native owner remains usable after provider removal')
   assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action='identity.deprovisioned'",w.projectId)).n)
  }
 }finally{await app.close()}
}
