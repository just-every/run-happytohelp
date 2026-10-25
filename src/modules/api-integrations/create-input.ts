import {mailboxProofSql} from '../identity/mailbox'
import type {Env} from '../../platform/env'
import {ApiError} from './errors'
import {identityDigest,contactDigests} from '../move-in/identities'
import {canonicalJson} from '../import-kit/src/provenance/identity'
export {canonicalJson}
export function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new ApiError(400,'invalid_request');return value.trim()}
export async function createInput(env:Env,p:string,credential:any,b:any){
 for(const key of Object.keys(b))if(!['requester','subject','body','attachments','source_ref','channel','priority','tags','brand_id','mailbox_id','group_id','form_id'].includes(key))throw new ApiError(403,'outside_credential_bounds')
 const subject=text(b.subject,500),content=text(b.body,100000),bindings=JSON.parse(credential.bindings_json),priority=b.priority??'normal',channel='api:'+credential.source_product
 if(b.channel!==undefined&&b.channel!==channel)throw new ApiError(403,'outside_credential_bounds')
 if(!['low','normal','high','urgent'].includes(priority))throw new ApiError(400,'invalid_request')
 const values={brands:b.brand_id??p,mailboxes:b.mailbox_id,groups:b.group_id,forms:b.form_id,priorities:priority}
 for(const [key,value] of Object.entries(values))if(bindings[key]&&(value===undefined||!bindings[key].includes(value)))throw new ApiError(403,'outside_credential_bounds')
 if(b.brand_id&&b.brand_id!==p)throw new ApiError(403,'outside_credential_bounds')
 for(const [field,table] of [['mailbox_id','mailbox_connections'],['group_id','ticket_groups'],['form_id','request_forms']])if(b[field]&&!await env.DB.prepare(`SELECT 1 FROM ${table} WHERE project_id=? AND id=?`).bind(p,b[field]).first())throw new ApiError(404,'not_found')
 const tags=b.tags??[]
 if(!Array.isArray(tags)||tags.length>100||tags.some(t=>typeof t!=='string'))throw new ApiError(400,'invalid_request')
 for(const tag of tags){if(bindings.tags&&!bindings.tags.includes(tag))throw new ApiError(403,'outside_credential_bounds');if(!await env.DB.prepare('SELECT 1 FROM workspace_tags WHERE project_id=? AND id=?').bind(p,tag).first())throw new ApiError(403,'outside_credential_bounds')}
 let ref:string|null=null,url:string|null=null
 if(b.source_ref){if(b.source_ref.product!==credential.source_product)throw new ApiError(403,'outside_credential_bounds');ref=text(b.source_ref.ref,200);if(b.source_ref.url){try{const parsed=new URL(b.source_ref.url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error();url=parsed.href}catch{throw new ApiError(400,'invalid_source_url')}}}
 const requester=b.requester
 if(!requester||typeof requester!=='object'||Array.isArray(requester)||Object.keys(requester).some(k=>!['email','phone','external_id','name'].includes(k)))throw new ApiError(400,'invalid_requester')
 const email=requester.email===undefined?null:text(requester.email,254).toLowerCase(),phone=requester.phone===undefined?null:text(requester.phone,16),external=requester.external_id===undefined?null:credential.source_product+':'+text(requester.external_id,200),name=requester.name===undefined?null:text(requester.name,200)
 if(!email&&!phone&&!external||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone&&!/^\+[1-9][0-9]{6,14}$/.test(phone))throw new ApiError(400,'invalid_requester')
 const digests=[...contactDigests(p,{email,external_id:external}),...(phone?[identityDigest(p,'phone',phone)]:[])]
 if(await env.DB.prepare('SELECT 1 FROM api_erased_keys WHERE project_id=? AND digest IN (SELECT value FROM json_each(?)) UNION SELECT 1 FROM move_in_erased_identities WHERE project_id=? AND digest IN (SELECT value FROM json_each(?)) LIMIT 1').bind(p,JSON.stringify(digests),p,JSON.stringify(digests)).first())throw new ApiError(409,'identity_erased')
 const matches=await env.DB.prepare(`SELECT * FROM contacts WHERE project_id=? AND ((? IS NOT NULL AND lower(email)=? AND ${mailboxProofSql('contacts')}) OR (? IS NOT NULL AND external_id=? AND is_verified=1) OR (? IS NOT NULL AND json_extract(metadata_json,'$.phone')=? AND json_extract(metadata_json,'$.phone_verified')=1))`).bind(p,email,email,external,external,phone,phone).all<any>()
 if(matches.results.length>1)throw new ApiError(409,'identity_conflict')
 const contact=matches.results[0],flags=JSON.parse(contact?.metadata_json??'{}')
 const blocked=await env.DB.prepare("SELECT 1 FROM contacts WHERE project_id=? AND json_extract(metadata_json,'$.is_blocked')=1 AND ((? IS NOT NULL AND lower(email)=?) OR (? IS NOT NULL AND external_id=?) OR (? IS NOT NULL AND json_extract(metadata_json,'$.phone')=?))").bind(p,email,email,external,external,phone,phone).first()
 if(blocked)flags.is_blocked=1
 if(flags.is_erased||flags.is_erasing)throw new ApiError(409,'identity_erased')
 return {subject,content,priority,channel,tags,ref,url,email,phone,external,name,digests,contact,flags}
}
