import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {bearer,providerJson,MailboxProviderError} from './http'
import {address,readCredential,sealCredential} from './store'
import type {MailboxRow,OAuthCredential,MailboxAddress} from './types'
import {auditStatement} from '../../audit/record'
export type OAuthProvider='gmail'|'microsoft'
const scopes={gmail:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic',microsoft:'offline_access User.Read Mail.Read Mail.Send'}
export function oauthConfig(env:Env,provider:OAuthProvider){
 const prefix=provider==='gmail'?'GOOGLE_MAIL':'MICROSOFT_MAIL'
 const clientId=env[`${prefix}_CLIENT_ID`],clientSecret=env[`${prefix}_CLIENT_SECRET`]
 return {clientId:typeof clientId==='string'?clientId:'',clientSecret:typeof clientSecret==='string'?clientSecret:'',scope:scopes[provider],
  authorize:provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  token:provider==='gmail'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token'}
}
export function assertOAuthConfig(env:Env,provider:OAuthProvider){
 const config=oauthConfig(env,provider)
 if(!config.clientId||!config.clientSecret||!env.INTEGRATION_ENCRYPTION_KEY)throw new HTTPException(503,{message:'Mailbox OAuth is not configured'})
 return config
}
export async function exchangeToken(env:Env,provider:OAuthProvider,params:Record<string,string>,prior?:OAuthCredential):Promise<OAuthCredential>{
 const config=assertOAuthConfig(env,provider)
 const token=await providerJson(config.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,...params}).toString()},65536)
 if(typeof token.access_token!=='string'||!token.access_token||(token.refresh_token!==undefined&&typeof token.refresh_token!=='string')||(!token.refresh_token&&!prior?.refreshToken)||!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=0)throw new HTTPException(502,{message:'Mailbox provider did not issue an offline credential'})
 return {accessToken:token.access_token,refreshToken:token.refresh_token||prior!.refreshToken,expiresAt:Date.now()+Number(token.expires_in)*1000}
}
export async function accessToken(env:Env,row:MailboxRow){
 const credential=await readCredential<OAuthCredential>(env,row)
 if(credential.expiresAt>Date.now()+60000)return credential.accessToken
 try{
  const next=await exchangeToken(env,row.provider as OAuthProvider,{grant_type:'refresh_token',refresh_token:credential.refreshToken},credential)
  const cipher=await sealCredential(env,row,next)
  const result=await env.DB.prepare(`UPDATE mailbox_connections SET credential_cipher=?,credential_version=credential_version+1,updated_at=? WHERE id=? AND project_id=? AND credential_version=? AND status='connected'`)
   .bind(cipher,Date.now(),row.id,row.project_id,row.credential_version).run()
  if(!result.meta.changes)throw new HTTPException(409,{message:'Mailbox credentials changed; try again'})
  row.credential_version++;row.credential_cipher=cipher
  await auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'mailbox.credential_refreshed',actor:{type:'system'},source:'system',target:{type:'mailbox',id:row.id}}).run()
  return next.accessToken
 }catch(error){
  if(error instanceof MailboxProviderError&&[400,401,403].includes(error.status))await env.DB.batch([env.DB.prepare("UPDATE mailbox_connections SET status='reconnect_required',error_code='oauth_refresh_rejected',updated_at=? WHERE id=? AND credential_version=? AND status='connected'").bind(Date.now(),row.id,row.credential_version),auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'mailbox.refresh_rejected',outcome:'failed',actor:{type:'system'},source:'system',target:{type:'mailbox',id:row.id}})])
  throw error
 }
}
export async function providerIdentity(provider:OAuthProvider,token:string):Promise<{address:string;addresses:MailboxAddress[]}>{
 if(provider==='gmail'){
  const [profile,aliases]=await Promise.all([
   providerJson('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:bearer(token)}),
   providerJson('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',{headers:bearer(token)}),
  ])
  const primary=address(profile.emailAddress)
  return {address:primary,addresses:[{address:primary,canSend:true},...(Array.isArray(aliases.sendAs)?aliases.sendAs:[]).filter((a:any)=>a.verificationStatus==='accepted').map((a:any)=>({address:address(a.sendAsEmail),canSend:true}))]}
 }
 const profile=await providerJson('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,proxyAddresses',{headers:bearer(token)})
 const primary=address(profile.mail||profile.userPrincipalName)
 // Graph Mail.Send does not establish permission to send from a proxy alias.
 const aliases=(Array.isArray(profile.proxyAddresses)?profile.proxyAddresses:[]).filter((a:unknown)=>typeof a==='string'&&/^smtp:/i.test(a as string)).map((a:string)=>({address:address(a.slice(5)),canSend:a.slice(5).toLowerCase()===primary}))
 return {address:primary,addresses:[...aliases,{address:primary,canSend:true}]}
}
