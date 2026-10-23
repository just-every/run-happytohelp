import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import {createLocalJWKSet,jwtVerify} from 'jose'
import {DOMParser} from '@xmldom/xmldom'
import type {AppEnv} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {decryptToken} from '../../integrations/secrets'
import {base64url} from '../../integrations/mailboxes/http'
import {sessionCookie} from '../session'
import {connection,random,text,audit,type Connection} from './model'
import {providerJson} from './provider'

type State={id:string;connection_id:string;version:number;browser_hash:string;verifier:string;nonce:string;request_id:string|null;created_at:number;expires_at:number;consumed_at:number|null}
export const sso=new Hono<AppEnv>()
const P='/sso/:connectionId',origin=(c:Context<AppEnv>)=>new URL(String(c.env.APP_ORIGIN||c.req.url)).origin
const callback=(c:Context<AppEnv>,row:Connection)=>`${origin(c)}/api/identity/sso/${row.id}/callback`
const entity=(c:Context<AppEnv>,row:Connection)=>`${origin(c)}/api/identity/sso/${row.id}`
const cookieName=(id:string)=>'h2h_sso_'+id
const browserCookie=(c:Context<AppEnv>,id:string,value:string,age=300)=>`${cookieName(id)}=${value}; Path=/api/identity/sso/; HttpOnly; ${new URL(c.req.url).protocol==='https:'?'Secure; SameSite=None;':'SameSite=Lax;'} Max-Age=${age}`
async function saml(c:Context<AppEnv>,row:Connection,state:State){
 const {SAML,ValidateInResponseTo}=await import('@node-saml/node-saml')
 const config=JSON.parse(row.config_json)
 return new SAML({issuer:entity(c,row),audience:entity(c,row),idpIssuer:row.issuer,idpCert:config.certificate,entryPoint:config.entryPoint,callbackUrl:callback(c,row),wantAssertionsSigned:true,wantAuthnResponseSigned:true,validateInResponseTo:ValidateInResponseTo.always,acceptedClockSkewMs:30000,maxAssertionAgeMs:300000,requestIdExpirationPeriodMs:300000,signatureAlgorithm:'sha256',digestAlgorithm:'sha256',disableRequestedAuthnContext:true,identifierFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',generateUniqueId:()=>state.request_id!,cacheProvider:{
  saveAsync:async(key,value)=>key===state.request_id?{value,createdAt:state.created_at}:null,
  getAsync:async key=>key===state.request_id&&!state.consumed_at&&state.expires_at>Date.now()?new Date(state.created_at).toISOString():null,
  // The final database transaction consumes the request atomically with the session.
  removeAsync:async key=>key===state.request_id?new Date(state.created_at).toISOString():null,
 }})
}
// A callback is bounded before any XML/JWT parser runs.
async function boundedBody(c:Context<AppEnv>){const reader=c.req.raw.body?.getReader();if(!reader)throw new HTTPException(400);let size=0;const chunks:Uint8Array[]=[];try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>256*1024)throw new HTTPException(413);chunks.push(p.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}const bytes=new Uint8Array(size);let at=0;for(const p of chunks){bytes.set(p,at);at+=p.length}return new URLSearchParams(new TextDecoder().decode(bytes))}
sso.get(`${P}/start`,async c=>{
 const row=await connection(c),config=JSON.parse(row.config_json),now=Date.now(),id=random(),browser=random(),verifier=random(),nonce=random()
 const state:State={id,connection_id:row.id,version:row.version,browser_hash:await hashToken(browser),verifier,nonce,request_id:'_'+random(),created_at:now,expires_at:now+300000,consumed_at:null}
 // Bound outstanding attempts without making a sign-in replace native recovery.
 const pending=await c.env.DB.prepare('SELECT count(*) n FROM enterprise_states WHERE connection_id=? AND expires_at>?').bind(row.id,now).first<{n:number}>();if(pending!.n>=1000)throw new HTTPException(429)
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM enterprise_states WHERE expires_at<?').bind(now-86400000),c.env.DB.prepare('INSERT INTO enterprise_states VALUES(?,?,?,?,?,?,?,?,?,NULL)').bind(id,row.id,row.version,state.browser_hash,verifier,nonce,state.request_id,now,now+300000)])
 let url:string
 if(row.protocol==='oidc'){
  const u=new URL(config.authorizationEndpoint),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))
  for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:callback(c,row),response_type:'code',scope:'openid',state:id,nonce,code_challenge:challenge,code_challenge_method:'S256'}))u.searchParams.set(key,value as string)
  url=u.href
 }else url=await (await saml(c,row,state)).getAuthorizeUrlAsync(id,undefined,{})
 c.header('Set-Cookie',browserCookie(c,row.id,browser));c.header('Cache-Control','no-store');return c.redirect(url)
})
async function finish(c:Context<AppEnv>,row:Connection,state:State,subject:string){
 const principal=await c.env.DB.prepare('SELECT p.id,p.user_id,m.role FROM enterprise_principals p JOIN memberships m ON m.project_id=p.project_id AND m.user_id=p.user_id WHERE p.connection_id=? AND p.external_id=? AND p.active=1').bind(row.id,subject).first<{id:string;user_id:string;role:string}>()
 if(!principal||principal.role==='owner')throw new HTTPException(403,{message:'Your identity must be provisioned and active before sign-in'})
 const now=Date.now(),token=random()+random(),hash=await hashToken(token)
 // The guard is repeated inside the insert: a concurrent SCIM deactivation or
 // connection removal wins before session authority can be created.
 const valid=`EXISTS(SELECT 1 FROM enterprise_states st JOIN enterprise_connections ec ON ec.id=st.connection_id JOIN enterprise_principals p ON p.connection_id=ec.id JOIN memberships m ON m.project_id=p.project_id AND m.user_id=p.user_id WHERE st.id=? AND st.consumed_at IS NULL AND st.expires_at>? AND ec.enabled=1 AND ec.version=st.version AND p.id=? AND p.active=1 AND m.role=? AND m.role<>'owner')`
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) SELECT ?,?,?,?,? WHERE ${valid}`).bind(hash,principal.user_id,row.project_id,principal.role,now+8*3600000,state.id,now,principal.id,principal.role),
  c.env.DB.prepare('INSERT INTO enterprise_sessions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=?)').bind(hash,principal.id,row.version,now,hash),
  c.env.DB.prepare('UPDATE enterprise_states SET consumed_at=?,verifier=\'\',nonce=\'\' WHERE id=? AND consumed_at IS NULL').bind(now,state.id),
 ])
 if(!result[0].meta.changes)throw new HTTPException(403,{message:'Sign-in expired or authority was withdrawn'})
 await audit(c,row,'identity.sso_succeeded',principal.user_id).run()
 c.header('Set-Cookie',sessionCookie(token,c.req.url,8*3600));c.header('Set-Cookie',browserCookie(c,row.id,'',0),{append:true});c.header('Cache-Control','no-store')
 return c.redirect(`/projects/${encodeURIComponent(row.project_id)}/activation`)
}
for(const method of ['GET','POST'] as const)sso.on(method,`${P}/callback`,async c=>{
 const row=await connection(c);if((row.protocol==='oidc')!==(method==='GET'))throw new HTTPException(405)
 const params=method==='GET'?new URL(c.req.url).searchParams:await boundedBody(c),id=text(params.get(row.protocol==='oidc'?'state':'RelayState'),100)
 const state=await c.env.DB.prepare('SELECT * FROM enterprise_states WHERE id=? AND connection_id=? AND consumed_at IS NULL AND expires_at>? AND version=?').bind(id,row.id,Date.now(),row.version).first<State>()
 const cookie=c.req.header('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName(row.id)+'='))?.slice(cookieName(row.id).length+1)
 if(!state||!cookie||await hashToken(cookie)!==state.browser_hash)throw new HTTPException(403,{message:'Sign-in state or browser does not match'})
 try{
  const config=JSON.parse(row.config_json);let subject:string
  if(row.protocol==='oidc'){
   const code=text(params.get('code'),4096),secret=await decryptToken(c.env,row.project_id,row.secret_cipher!)
   const tokens=await providerJson(config.tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:config.clientId,client_secret:secret,redirect_uri:callback(c,row),code_verifier:state.verifier})})
   const jwks=await providerJson(config.jwksUri),{payload}=await jwtVerify(text(tokens.id_token,20000),createLocalJWKSet(jwks),{issuer:row.issuer,audience:config.clientId,algorithms:['RS256','ES256'],requiredClaims:['sub','iss','aud','exp','iat','nonce'],maxTokenAge:'5m',clockTolerance:30})
   if(payload.nonce!==state.nonce||payload.azp!==undefined&&payload.azp!==config.clientId||Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==config.clientId)throw new Error('Identity token binding mismatch')
   subject=text(payload.sub)
  }else{
   const encoded=text(params.get('SAMLResponse'),240000),xml=atob(encoded)
   if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('XML declarations refused')
   const {profile,loggedOut}=await (await saml(c,row,state)).validatePostResponseAsync({SAMLResponse:encoded})
   if(!profile||loggedOut||profile.issuer!==row.issuer)throw new Error('SAML issuer mismatch')
   const assertion=(profile.getAssertion?.() as any)?.Assertion,confirmation=assertion?.Subject?.[0]?.SubjectConfirmation
   if(!Array.isArray(confirmation)||confirmation.length!==1||confirmation[0].$?.Method!=='urn:oasis:names:tc:SAML:2.0:cm:bearer')throw new Error('SAML subject confirmation required')
   const confirmed=confirmation[0].SubjectConfirmationData?.[0]?.$
   if(confirmed?.Recipient!==callback(c,row)||confirmed?.InResponseTo!==state.request_id||!Number.isFinite(Date.parse(confirmed?.NotOnOrAfter))||Date.parse(confirmed.NotOnOrAfter)<=Date.now())throw new Error('SAML recipient or request mismatch')
   const document=new DOMParser({errorHandler:()=>{throw new Error('Malformed SAML XML')}}).parseFromString(profile.getSamlResponseXml!(),'text/xml')
   if(document.documentElement?.getAttribute('Destination')!==callback(c,row))throw new Error('SAML destination mismatch')
   subject=text(profile.nameID)
  }
  return await finish(c,row,state,subject)
 }catch(error){
  await c.env.DB.prepare('UPDATE enterprise_states SET consumed_at=?,verifier=\'\',nonce=\'\' WHERE id=? AND consumed_at IS NULL').bind(Date.now(),state.id).run()
  await audit(c,row,'identity.sso_refused',undefined,'refused').run()
  if(error instanceof HTTPException&&error.status===403)throw error
  throw new HTTPException(403,{message:'Identity provider response could not be verified; start sign-in again'})
 }
})
