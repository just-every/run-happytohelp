import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from './env'
import {D1SqlDatabase,IntegrationsRepository,TokenService} from '../vendor/base/modules/integrations/index.ts'
export const SCOPES=['conversations:create','messages:append','conversations:read','conversations:write','messages:write','contacts:read','contacts:write','articles:read','articles:write'] as const
export type ApiScope=typeof SCOPES[number]
export interface SqlGuard {sql:string;params:(string|number|null)[]}
const trusted=Symbol('native workspace token authority')
export interface TokenAuthority {readonly kind:'workspace-token';readonly projectId:string;readonly tokenId:string;readonly scope:ApiScope;readonly policy?:string;readonly [trusted]:true}
export const repository=(env:Env,projectId:string)=>new IntegrationsRepository(new D1SqlDatabase(env.DB),projectId)
export interface Issuer {actor:Actor;sessionHash:string}
const activeProject=(alias:string)=>`EXISTS(SELECT 1 FROM projects p WHERE p.id=${alias}) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=${alias} AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export async function issuerGuard(env:Env,issuer:Issuer):Promise<SqlGuard>{
 const {actor,sessionHash}=issuer
 const sql=`SELECT e.revision FROM integration_authority_epoch e JOIN sessions s ON s.token_hash=? JOIN users u ON u.id=s.actor_id JOIN memberships m ON m.project_id=? AND m.user_id=s.actor_id WHERE e.id=1 AND s.actor_id=? AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND m.role IN ('owner','admin') AND (s.project_id IS NULL AND s.role='operator' OR EXISTS(SELECT 1 FROM memberships sm WHERE sm.project_id=s.project_id AND sm.user_id=s.actor_id AND sm.role=s.role)) AND ${activeProject('m.project_id')} AND (s.project_id IS NULL OR ${activeProject('s.project_id')})`
 const params=[sessionHash,actor.projectId,actor.id,Date.now()]
 const row=await env.DB.prepare(sql).bind(...params).first<{revision:number}>()
 if(!row)throw new HTTPException(403,{message:'Current workspace owner or admin required'})
 return {sql:`${sql} AND e.revision=?`,params:[...params,row.revision]}
}
export function tokens(env:Env,projectId:string,extension?:{source:string;bindings:string;minute:number;day:number;family?:string;rotate?:{id:string;overlap:number;expires:number|null;policy:string}}){
 const sql=new D1SqlDatabase(env.DB)
 let administration:{issuer:Issuer;guard:SqlGuard;action:string;resource:string}|null=null
 const repo=new IntegrationsRepository({async batch(statements){
  if(!administration)return sql.batch(statements)
  const {issuer,guard,action,resource}=administration
  // Native actor audit and current authority assertion join Base's transaction.
  // A failed assertion violates actor_id NOT NULL and rolls back every effect.
  const audit={sql:`INSERT INTO native_integration_audit(id,project_id,actor_id,action,resource_id,created_at) VALUES(?,?,CASE WHEN EXISTS(${guard.sql}) THEN ? ELSE NULL END,?,?,?)`,params:[crypto.randomUUID(),projectId,...guard.params,issuer.actor.id,action,resource,Date.now()]}
  const extra=[]
  if(action==='token.revoke')extra.push({sql:'UPDATE integration_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE namespace=? AND family_id IS NOT NULL AND family_id=(SELECT family_id FROM integration_tokens WHERE namespace=? AND id=?)',params:[Date.now(),projectId,projectId,resource]})
  if(extension&&action==='token.issued'){
   const id=String(statements[0]!.params![1])
   extra.push({sql:'UPDATE integration_tokens SET source_product=?,bindings_json=?,issuer_id=?,family_id=?,create_minute=?,create_day=?,display_prefix=? WHERE namespace=? AND id=?',params:[extension.source,extension.bindings,issuer.actor.id,extension.family??id,extension.minute,extension.day,id.slice(0,8),projectId,id]})
   if(extension.rotate){extra.push({sql:"INSERT INTO native_integration_audit VALUES(?,?,?,'token.rotated',?,?)",params:[crypto.randomUUID(),projectId,issuer.actor.id,extension.rotate.id,Date.now()]},{sql:'UPDATE integration_tokens SET expires_at=min(COALESCE(expires_at,?),?) WHERE namespace=? AND id=?',params:[Date.now()+extension.rotate.overlap,Date.now()+extension.rotate.overlap,projectId,extension.rotate.id]})}
  }
  const rotationGuard=extension?.rotate?[{sql:'INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM integration_tokens WHERE namespace=? AND id=? AND revoked_at IS NULL AND expires_at IS ? AND (expires_at IS NULL OR expires_at>?) AND json_array(scopes,bindings_json,create_minute,create_day)=?) THEN 1 ELSE 0 END',params:[projectId,extension.rotate.id,extension.rotate.expires,Date.now(),extension.rotate.policy]}]:[]
  try{return (await sql.batch([...rotationGuard,audit,...statements,...extra,...(rotationGuard.length?[{sql:'DELETE FROM ik_d1_assertions',params:[]}]:[])])).slice(rotationGuard.length+1,rotationGuard.length+1+statements.length)}catch(error){
   if(!await env.DB.prepare(guard.sql).bind(...guard.params).first())throw new HTTPException(409,{message:'Authority changed'})
   throw error
  }
 }},projectId)
 return new TokenService<Issuer>(repo,{
  grant:async issuer=>{if(issuer.actor.projectId!==projectId)throw new HTTPException(403);const guard=await issuerGuard(env,issuer);administration={issuer,guard,action:'token.issued',resource:'tokens'};return {scopes:SCOPES,commitGuard:guard}},
  administer:async(issuer,action,id)=>{if(issuer.actor.projectId!==projectId)throw new HTTPException(403);administration={issuer,guard:await issuerGuard(env,issuer),action:'token.'+action,resource:id||'tokens'}}
 })
}
/** Only the bearer verifier can mint this context; no synthetic native session. */
export function verifiedToken(projectId:string,tokenId:string,scope:ApiScope,policy?:string):TokenAuthority{return Object.freeze({kind:'workspace-token',projectId,tokenId,scope,policy,[trusted]:true as const})}
export function tokenGuard(authority:TokenAuthority,projectId:string,scope:ApiScope):SqlGuard{
 if(authority?.[trusted]!==true||authority.projectId!==projectId||authority.scope!==scope)throw new HTTPException(403)
 return {sql:`SELECT 1 FROM integration_tokens t WHERE t.namespace=? AND t.id=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))) AND EXISTS(SELECT 1 FROM json_each(t.scopes) WHERE value=?) AND ${activeProject('t.namespace')} ${authority.policy===undefined?'':'AND json_array(t.source_product,t.bindings_json,t.family_id,t.create_minute,t.create_day)=?'}`,params:[projectId,authority.tokenId,Date.now(),scope,...(authority.policy===undefined?[]:[authority.policy])]}
}
