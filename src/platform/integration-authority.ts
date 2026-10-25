import {conversationReach} from '../modules/api-integrations/reach'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from './env'
import {D1SqlDatabase,IntegrationsRepository,TokenService} from '../vendor/base/modules/integrations/index.ts'
export const SCOPES=['conversations:create','messages:append','conversations:read','conversations:write','messages:write','contacts:read','contacts:write','articles:read','articles:write'] as const
export type ApiScope=typeof SCOPES[number]
export interface SqlGuard {sql:string;params:(string|number|null)[]}
const trusted=Symbol('native workspace token authority')
export interface TokenAuthority {readonly kind:'workspace-token';readonly projectId:string;readonly tokenId:string;readonly scope:ApiScope;readonly credentialId:string;readonly revision:number;readonly conversationId?:string;readonly [trusted]:true}
export const repository=(env:Env,projectId:string)=>new IntegrationsRepository(new D1SqlDatabase(env.DB),projectId)
export interface Issuer {actor:Actor;sessionHash:string}
const activeProject=(alias:string)=>`EXISTS(SELECT 1 FROM projects p WHERE p.id=${alias}) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=${alias} AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))`
export async function issuerGuard(env:Env,issuer:Issuer):Promise<SqlGuard>{
 const {actor,sessionHash}=issuer
 const sql=`SELECT e.revision FROM integration_authority_epoch e JOIN sessions s ON s.token_hash=? JOIN users u ON u.id=s.actor_id JOIN memberships m ON m.project_id=? AND m.user_id=s.actor_id WHERE e.id=1 AND s.actor_id=? AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND m.role IN ('owner','admin') AND (s.project_id IS NULL AND s.role='operator' OR EXISTS(SELECT 1 FROM memberships sm WHERE sm.project_id=s.project_id AND sm.user_id=s.actor_id AND sm.role=s.role)) AND ${activeProject('m.project_id')} AND (s.project_id IS NULL OR ${activeProject('s.project_id')})`
 const params=[sessionHash,actor.projectId,actor.id,Date.now()]
 const row=await env.DB.prepare(sql).bind(...params).first<{revision:number}>()
 if(!row)throw new HTTPException(403,{message:'Current workspace owner or admin required'})
 return {sql:`${sql} AND e.revision=?`,params:[...params,row.revision]}
}
export interface CredentialPolicy {source:string|null;reach:string;values:string;minute:number;day:number;rotate?:{id:string;overlap:number;revision:number}}
export function tokens(env:Env,projectId:string,extension?:CredentialPolicy){
 const sql=new D1SqlDatabase(env.DB)
 let administration:{issuer:Issuer;guard:SqlGuard;action:string;resource:string}|null=null
 const repo=new IntegrationsRepository({async batch(statements){
  if(!administration)return sql.batch(statements)
  const {issuer,guard,action,resource}=administration,now=Date.now(),before:any[]=[],after:any[]=[]
  let id=resource,auditAction=action
  if(action==='token.issued'){
   const params=statements[0]!.params!,secretId=String(params[1]);id=extension?.rotate?.id??secretId
   if(extension?.rotate){
    auditAction='token.rotated'
    const live=credentialGuard(projectId,id,extension.rotate.revision)
    before.push({sql:`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${live.sql}) THEN 1 ELSE 0 END`,params:live.params})
    after.push({sql:'UPDATE integration_tokens SET expires_at=min(coalesce(expires_at,?),?) WHERE namespace=? AND credential_id=? AND id<>? AND revoked_at IS NULL',params:[now+extension.rotate.overlap,now+extension.rotate.overlap,projectId,id,secretId]})
   }else before.push({sql:'INSERT INTO api_credentials(namespace,id,name,scopes,created_at,expires_at,source_product,reach_json,values_json,create_minute,create_day,issuer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',params:[projectId,id,params[3],params[4],params[5],params[6],extension?.source??null,extension?.reach??'{}',extension?.values??'{}',extension?.minute??20,extension?.day??1000,issuer.actor.id]})
   // Extend Base's secret INSERT in its transaction, keeping Base hash generation
   // and bearer verification intact. Policy is stored only on the parent.
   statements=statements.map((statement,index)=>index?statement:{...statement,sql:statement.sql.replace('expires_at) SELECT','expires_at,credential_id,display_prefix) SELECT').replace('?,?,?,?,?,?,? WHERE','?,?,?,?,?,?,?,?,? WHERE'),params:[...params.slice(0,7),id,secretId.slice(0,8),...params.slice(7)]})
  }
  if(action==='token.revoke')after.push({sql:'UPDATE api_credentials SET revoked_at=coalesce(revoked_at,?) WHERE namespace=? AND id=(SELECT credential_id FROM integration_tokens WHERE namespace=? AND id=?)',params:[now,projectId,projectId,resource]},{sql:'UPDATE integration_tokens SET revoked_at=coalesce(revoked_at,?) WHERE namespace=? AND credential_id=(SELECT credential_id FROM integration_tokens WHERE namespace=? AND id=?)',params:[now,projectId,projectId,resource]})
  const detail=auditAction==='token.issued'?JSON.stringify({credential_id:id,credential_name:String(statements[0]!.params![3]),source_product:extension?.source??null}):id
  const audit={sql:`INSERT INTO native_integration_audit(id,project_id,actor_id,action,resource_id,created_at) VALUES(?,?,CASE WHEN EXISTS(${guard.sql}) THEN ? ELSE NULL END,?,?,?)`,params:[crypto.randomUUID(),projectId,...guard.params,issuer.actor.id,auditAction,detail,now]}
  const prefix=[audit,...before]
  try{return (await sql.batch([...prefix,...statements,...after,{sql:'DELETE FROM ik_d1_assertions',params:[]}])).slice(prefix.length,prefix.length+statements.length)}catch(error){
   if(!await env.DB.prepare(guard.sql).bind(...guard.params).first())throw new HTTPException(409,{message:'Authority changed'})
   throw error
  }
 }},projectId)
 return new TokenService<Issuer>(repo,{
  grant:async issuer=>{if(issuer.actor.projectId!==projectId)throw new HTTPException(403);const guard=await issuerGuard(env,issuer);administration={issuer,guard,action:'token.issued',resource:'tokens'};return {scopes:extension?.source?MACHINE_SCOPES:SCOPES,commitGuard:guard}},
  administer:async(issuer,action,id)=>{if(issuer.actor.projectId!==projectId)throw new HTTPException(403);administration={issuer,guard:await issuerGuard(env,issuer),action:'token.'+action,resource:id||'tokens'}}
 })
}
export const MACHINE_SCOPES=['conversations:create','conversations:read','messages:append'] as const
export function verifiedToken(projectId:string,tokenId:string,scope:ApiScope,credentialId:string,revision:number,conversationId?:string):TokenAuthority{return Object.freeze({kind:'workspace-token',projectId,tokenId,scope,credentialId,revision,conversationId,[trusted]:true as const})}
export function credentialGuard(projectId:string,id:string,revision:number):SqlGuard{
 return {sql:`SELECT 1 FROM api_credentials credential WHERE credential.namespace=? AND credential.id=? AND credential.policy_revision=? AND credential.revoked_at IS NULL AND (credential.expires_at IS NULL OR credential.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) AND ${activeProject('credential.namespace')}`,params:[projectId,id,revision,Date.now()]}
}
export function tokenGuard(authority:TokenAuthority,projectId:string,scope:ApiScope):SqlGuard{
 if(authority?.[trusted]!==true||authority.projectId!==projectId||authority.scope!==scope)throw new HTTPException(403)
 const parent=credentialGuard(projectId,authority.credentialId,authority.revision)
 return {sql:`SELECT 1 FROM integration_tokens t JOIN api_credentials credential ON credential.namespace=t.namespace AND credential.id=t.credential_id WHERE t.namespace=? AND t.id=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) AND EXISTS(SELECT 1 FROM json_each(credential.scopes) WHERE value=?) AND EXISTS(${parent.sql}) ${authority.conversationId?`AND EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=t.namespace AND c.id=? AND ${conversationReach('t.credential_id')})`:''}`,params:[projectId,authority.tokenId,Date.now(),scope,...parent.params,...(authority.conversationId?[authority.conversationId]:[])]}
}
