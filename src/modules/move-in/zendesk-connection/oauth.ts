import type {Env} from '../../../platform/env'
import {ZendeskError} from './errors'
import {SCOPES,zendeskFetch} from './http'
import {getConnection,markReconnect,openAccess,openRefresh,sealedGrant,type ConnectionRow,type TokenGrant} from './store'
/** Requested lifetimes: the longest Zendesk grants a public client (48 hours, 90 days). */
export const ACCESS_SECONDS=172800,REFRESH_SECONDS=7776000
const REFRESH_MARGIN=5*60*1000
export function authorizationUrl(subdomain:string,clientId:string,redirectUri:string,state:string,challenge:string){
 const url=new URL(`https://${subdomain}.zendesk.com/oauth/authorizations/new`)
 url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,scope:SCOPES.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}).toString()
 return url.href
}
/** Public PKCE client: the verifier proves the request; no client secret exists. */
export async function exchangeCode(subdomain:string,clientId:string,code:string,redirectUri:string,verifier:string):Promise<TokenGrant>{
 const response=await zendeskFetch(subdomain,'/oauth/tokens',{method:'POST',body:{grant_type:'authorization_code',code,client_id:clientId,redirect_uri:redirectUri,code_verifier:verifier,scope:SCOPES.join(' '),expires_in:ACCESS_SECONDS,refresh_token_expires_in:REFRESH_SECONDS}})
 if(response.status<200||response.status>=300||typeof response.data?.access_token!=='string')throw new ZendeskError('zendesk_token_exchange_refused',response.status)
 return response.data
}
/** A live access token for the workspace's connection, refreshed shortly before
 * expiry. The rotated pair replaces the old one in one compare-and-set write. A
 * refused or expired refresh asks the owner to reconnect and is never retried. */
export async function accessToken(env:Env,projectId:string):Promise<{token:string;connection:ConnectionRow}>{
 const row=await getConnection(env,projectId),now=Date.now()
 if(!row||row.state!=='connected'||!row.access_ciphertext)throw new ZendeskError('zendesk_reconnect_required')
 if(row.access_expires_at!==null&&row.access_expires_at-now>REFRESH_MARGIN)return {token:await openAccess(env,row),connection:row}
 if(!row.refresh_ciphertext||row.refresh_expires_at===null||row.refresh_expires_at<=now){await markReconnect(env,row);throw new ZendeskError('zendesk_reconnect_required')}
 const response=await zendeskFetch(row.subdomain,'/oauth/tokens',{method:'POST',body:{grant_type:'refresh_token',refresh_token:await openRefresh(env,row),client_id:row.client_id,scope:row.scopes,expires_in:ACCESS_SECONDS,refresh_token_expires_in:REFRESH_SECONDS}})
 if([400,401,403].includes(response.status)){await markReconnect(env,row);throw new ZendeskError('zendesk_reconnect_required',response.status)}
 if(response.status<200||response.status>=300||typeof response.data?.access_token!=='string')throw new ZendeskError('zendesk_refresh_failed',response.status)
 const sealed=await sealedGrant(env,projectId,response.data,now)
 const saved=await env.DB.prepare("UPDATE move_in_zendesk_connections SET access_ciphertext=?,refresh_ciphertext=coalesce(?,refresh_ciphertext),access_expires_at=?,refresh_expires_at=coalesce(?,refresh_expires_at),scopes=coalesce(?,scopes),generation=generation+1,updated_at=? WHERE project_id=? AND generation=? AND state='connected'").bind(sealed.access,sealed.refresh,sealed.accessExpiresAt,sealed.refreshExpiresAt,typeof response.data.scope==='string'&&response.data.scope?response.data.scope:null,now,projectId,row.generation).run()
 if(!saved.meta.changes)throw new ZendeskError('zendesk_connection_changed')
 return {token:response.data.access_token,connection:(await getConnection(env,projectId))!}
}
/** Disconnect asks Zendesk to revoke the token it holds and reports what Zendesk answered. */
export async function revokeRemote(env:Env,row:ConnectionRow):Promise<{outcome:'revoked'|'refused'|'unreachable'|'not_held';status?:number}>{
 if(row.state==='disconnected'||!row.access_ciphertext)return {outcome:'not_held'}
 try{const response=await zendeskFetch(row.subdomain,'/api/v2/oauth/tokens/current.json',{method:'DELETE',token:await openAccess(env,row)});return response.status>=200&&response.status<300?{outcome:'revoked',status:response.status}:{outcome:'refused',status:response.status}}
 catch(error){if(error instanceof ZendeskError&&error.code==='zendesk_unreachable')return {outcome:'unreachable'};throw error}
}
