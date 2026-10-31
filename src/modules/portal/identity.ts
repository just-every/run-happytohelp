import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {activeSourceProjectSql} from '../knowledge/public-sources'

export interface PortalIdentity {actor:Actor;sessionHash:string}
export const livePortalContact=(alias='ct')=>`coalesce(json_extract(${alias}.metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.is_deleted'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.is_erased'),0)!=1 AND NOT EXISTS(SELECT 1 FROM contact_erasures erased WHERE erased.project_id=${alias}.project_id AND erased.contact_id=${alias}.id)`
/** This same guard belongs in every transaction admitting a customer mutation. */
export function portalSessionGuard(identity:PortalIdentity){
 const {actor,sessionHash}=identity
 return {sql:`EXISTS(SELECT 1 FROM portal_session_proofs proof JOIN sessions session ON session.token_hash=proof.token_hash JOIN portal_identities identity ON identity.project_id=proof.project_id AND identity.contact_id=proof.contact_id AND identity.email=proof.email JOIN contacts ct ON ct.id=proof.contact_id AND ct.project_id=proof.project_id WHERE proof.token_hash=? AND proof.project_id=? AND proof.contact_id=? AND session.actor_id=proof.contact_id AND session.contact_id=proof.contact_id AND session.project_id=proof.project_id AND session.role='contact' AND session.revoked_at IS NULL AND session.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND proof.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ${livePortalContact()} AND ${activeSourceProjectSql('proof.project_id')})`,args:[sessionHash,actor.projectId,actor.contactId||actor.id]}
}
export async function resolvePortalActor(env:Env,projectId:string,request:Request):Promise<PortalIdentity|undefined>{
 const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)h2h_portal=([^;]+)/)?.[1]
 if(!token||!/^[a-f0-9]{64}$/.test(token))return
 const sessionHash=await hashToken(token)
 const row=await env.DB.prepare('SELECT contact_id FROM portal_session_proofs WHERE token_hash=? AND project_id=?').bind(sessionHash,projectId).first<{contact_id:string}>()
 if(!row)return
 const identity:PortalIdentity={actor:{id:row.contact_id,contactId:row.contact_id,projectId,role:'contact'},sessionHash}
 const guard=portalSessionGuard(identity)
 if(await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())return identity
}
export function portalCookie(token:string,url:string,maxAge=86400){return `h2h_portal=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(url).protocol==='https:'?'; Secure':''}`}
