import {visibleCategorySql,literal} from './door'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {resolvePortalActor,portalSessionGuard,type PortalIdentity,livePortalContact} from '../portal/identity'
import {activeSourceProjectSql} from './public-sources'
export interface HelpAccess {contactId?:string;email?:string;verified:true;helpSessionHash?:string;nativeEmail?:true;portalIdentity?:PortalIdentity}
export const publicAccess:HelpAccess|undefined=undefined
export async function hasRestrictedCollections(env:Env,projectId:string){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM knowledge_categories k WHERE k.project_id=? AND (k.audience<>'public' OR k.requires_entitlement=1) AND ${visibleCategorySql('k',{sql:`SELECT 'member' kind,user_id id FROM memberships WHERE project_id=${literal(projectId)} AND role='owner'`})} LIMIT 1`).bind(projectId).first())
}
import {nativeEmailProofSql} from './native-proof'
export {nativeEmailProofSql} from './native-proof'
/** Imported customer data or a typed widget email is never proof of identity. */
export async function accessForContact(env:Env,projectId:string,contactId:string):Promise<HelpAccess|undefined>{
 const row=await env.DB.prepare(`SELECT id,email,external_id,is_verified,metadata_json FROM contacts WHERE id=? AND project_id=? AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=contacts.project_id AND e.contact_id=contacts.id)`).bind(contactId,projectId).first<any>()
 if(!row)return undefined
 if(!row.is_verified){
  const proven=await env.DB.prepare(`SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND c.email IS NOT NULL AND ${nativeEmailProofSql}`).bind(contactId,projectId).first()
  return proven?{verified:true,contactId:row.id,email:row.email.trim().toLowerCase(),nativeEmail:true}:undefined
 }
 const email=row.email?.trim().toLowerCase(),provenEmail=email&&row.external_id?.trim().toLowerCase()===email&&!JSON.parse(row.metadata_json||'{}').email_unproven
 return {verified:true,contactId:row.id,...(provenEmail?{email}:{})}
}
export async function resolveHelpAccess(env:Env,projectId:string,request:Request):Promise<HelpAccess|undefined>{
 const portalIdentity=await resolvePortalActor(env,projectId,request)
 if(portalIdentity){const contactId=portalIdentity.actor.contactId||portalIdentity.actor.id;const row=await env.DB.prepare('SELECT email FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first<{email:string}>();return {verified:true,contactId,email:row?.email,portalIdentity}}
 const cookie=request.headers.get('Cookie')||'',help=cookie.match(/(?:^|;\s*)h2h_help=([^;]+)/)?.[1]
 if(help){const helpSessionHash=await hashToken(help);const row=await env.DB.prepare(`SELECT email,contact_id FROM knowledge_help_sessions h WHERE token_hash=? AND project_id=? AND expires_at>? AND ${activeSourceProjectSql('h.project_id')} AND (contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts c WHERE c.id=h.contact_id AND c.project_id=h.project_id AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id)))`).bind(helpSessionHash,projectId,Date.now()).first<{email:string;contact_id:string|null}>();if(row)return {verified:true,helpSessionHash,email:row.email,...(row.contact_id?{contactId:row.contact_id}:{})}}
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||cookie.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
 if(!token||token.startsWith('dev_'))return undefined
 const row=await env.DB.prepare("SELECT contact_id FROM sessions WHERE token_hash=? AND project_id=? AND role='contact' AND revoked_at IS NULL AND expires_at>?").bind(await hashToken(token),projectId,Date.now()).first<{contact_id:string}>()
 return row?accessForContact(env,projectId,row.contact_id):undefined
}

/** The same proof must still exist at write admission, after an erasure fence. */
export function helpAccessWriteGuard(projectId:string,access?:HelpAccess):{sql:string;args:(string|number|null)[]}{
 if(access?.portalIdentity)return portalSessionGuard(access.portalIdentity)
 if(access?.nativeEmail)return {sql:`EXISTS(SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND lower(trim(c.email))=? AND ${nativeEmailProofSql})`,args:[access.contactId!,projectId,access.email!]}
 if(access?.helpSessionHash)return {sql:`EXISTS(SELECT 1 FROM knowledge_help_sessions h WHERE h.token_hash=? AND h.project_id=? AND h.email=? AND h.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND (h.contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts c WHERE c.id=h.contact_id AND c.project_id=h.project_id AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1)))`,args:[access.helpSessionHash,projectId,access.email||'',Date.now()]}
 if(access?.contactId)return {sql:`EXISTS(SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND c.is_verified=1 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id) AND (?='' OR (lower(trim(c.email))=? AND lower(trim(c.external_id))=? AND coalesce(json_extract(c.metadata_json,'$.email_unproven'),0)<>1)))`,args:[access.contactId,projectId,access.email||'',access.email||'',access.email||'']}
 return {sql:access?'0=1':'1=1',args:[]}
}
