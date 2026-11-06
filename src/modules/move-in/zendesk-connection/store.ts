import type {Env} from '../../../platform/env'
import {decryptToken,encryptToken} from '../../integrations/secrets'
export interface ConnectionRow {project_id:string;subdomain:string;client_id:string;scopes:string;state:'connected'|'reconnect'|'disconnected';access_ciphertext:string|null;refresh_ciphertext:string|null;access_expires_at:number|null;refresh_expires_at:number|null;generation:number;connected_by:string;connected_at:number;updated_at:number}
export interface TokenGrant {access_token:string;refresh_token?:string;expires_in?:number;refresh_token_expires_in?:number;scope?:string}
export const getConnection=(env:Env,projectId:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_connections WHERE project_id=?').bind(projectId).first<ConnectionRow>()
/** Native ids share the workspace's zendesk namespace, so a workspace holding
 * Zendesk history never takes a second account. */
export async function holdsZendeskImports(env:Env,projectId:string){return !!await env.DB.prepare("SELECT 1 FROM move_in_runs WHERE project_id=? AND vendor='zendesk' AND state IN ('applying','completed','undoing') UNION ALL SELECT 1 FROM move_in_zendesk_pulls WHERE project_id=? AND state NOT IN ('abandoned') LIMIT 1").bind(projectId,projectId).first()}
export async function subdomainConflict(env:Env,projectId:string,subdomain:string){const row=await getConnection(env,projectId);return !!row&&row.subdomain!==subdomain&&await holdsZendeskImports(env,projectId)?row.subdomain:null}
const expiry=(now:number,seconds:unknown,fallback:number)=>now+1000*(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>0?seconds:fallback)
export async function sealedGrant(env:Env,projectId:string,grant:TokenGrant,now=Date.now()){
 if(typeof grant.access_token!=='string'||!grant.access_token)throw new Error('zendesk_token_missing')
 return {access:await encryptToken(env,projectId,grant.access_token),refresh:typeof grant.refresh_token==='string'&&grant.refresh_token?await encryptToken(env,projectId,grant.refresh_token):null,accessExpiresAt:expiry(now,grant.expires_in,1800),refreshExpiresAt:typeof grant.refresh_token==='string'&&grant.refresh_token?expiry(now,grant.refresh_token_expires_in,2592000):null}
}
export const openAccess=(env:Env,row:ConnectionRow)=>decryptToken(env,row.project_id,row.access_ciphertext!)
export const openRefresh=(env:Env,row:ConnectionRow)=>decryptToken(env,row.project_id,row.refresh_ciphertext!)
export async function markReconnect(env:Env,row:ConnectionRow){await env.DB.prepare("UPDATE move_in_zendesk_connections SET state='reconnect',updated_at=? WHERE project_id=? AND generation=? AND state='connected'").bind(Date.now(),row.project_id,row.generation).run()}
export function publicConnection(row:ConnectionRow|null){
 if(!row)return {connected:false,state:'none',subdomain:null,clientKind:'public',scopes:[],accessExpiresAt:null,refreshExpiresAt:null}
 const live=row.state!=='disconnected'
 return {connected:row.state==='connected',state:row.state,subdomain:row.subdomain,clientKind:'public',scopes:live?row.scopes.split(' ').filter(Boolean):[],accessExpiresAt:live?row.access_expires_at:null,refreshExpiresAt:live?row.refresh_expires_at:null}
}
