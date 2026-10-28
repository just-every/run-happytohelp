import type {Env} from '../../platform/env'
import {identityDigest} from '../move-in/identities'
import {ApiError} from './errors'
export interface RequesterKey {kind:string;value:string;digest:string}
export const requesterKeys=(project:string,values:{kind:string;value:string}[]):RequesterKey[]=>values.filter(k=>k.value).map(k=>({...k,digest:identityDigest(project,k.kind,k.value)}))
export async function contactKeys(env:Env,project:string,contact:string){
 const rows=await env.DB.prepare('SELECT kind,value FROM api_contact_keys WHERE project_id=? AND contact_id=? ORDER BY kind,value').bind(project,contact).all<{kind:string;value:string}>()
 return requesterKeys(project,rows.results)
}
/** All doors use the same indexed key relation, block rule and digest fence.
 * The supplied JSON contains canonical keys, never SQL text. Contact keys are
 * pinned too: changing a spelling during I/O refuses the pending admission. */
export function requesterAdmission(project:string,keys:RequesterKey[],contact:string|null=null){
 const params=[project,JSON.stringify(keys),contact,...keys.flatMap(key=>[key.kind,key.value])]
 const shared=keys.length?keys.map((_,i)=>`SELECT contact_id FROM api_contact_keys WHERE project_id=?1 AND kind=?${4+i*2} AND value=?${5+i*2}`).join(' UNION '):'SELECT NULL AS contact_id WHERE 0'
 const flag=(name:string)=>`EXISTS(SELECT 1 FROM (${shared} UNION SELECT ?3 WHERE ?3 IS NOT NULL) ids CROSS JOIN contacts sibling ON sibling.id=ids.contact_id WHERE sibling.project_id=?1 AND coalesce(json_extract(sibling.metadata_json,'$.${name}'),0)=1)`
 const erased=`(${flag('is_erasing')} OR ${flag('is_erased')} OR EXISTS(SELECT 1 FROM json_each(?2) k CROSS JOIN api_erased_keys f ON f.project_id=?1 AND f.digest=json_extract(k.value,'$.digest')) OR EXISTS(SELECT 1 FROM json_each(?2) k CROSS JOIN move_in_erased_identities f ON f.project_id=?1 AND f.digest=json_extract(k.value,'$.digest')))`
 const blocked=`(${flag('is_blocked')} OR EXISTS(SELECT 1 FROM json_each(?2) k CROSS JOIN email_sender_rules rule ON rule.project_id=?1 AND rule.address IN (json_extract(k.value,'$.value'),substr(json_extract(k.value,'$.value'),instr(json_extract(k.value,'$.value'),'@'))) WHERE json_extract(k.value,'$.kind')='email' AND rule.action='block'))`
 const unchanged=`(?3 IS NULL OR NOT EXISTS(SELECT kind,value FROM api_contact_keys WHERE project_id=?1 AND contact_id=?3 EXCEPT SELECT json_extract(value,'$.kind'),json_extract(value,'$.value') FROM json_each(?2)))`
 // Replace numbered parameters for safe embedding in any larger statement.
 const compile=(sql:string)=>{const args:(string|null)[]=[];return {sql:sql.replace(/\?(\d+)/g,(_,i)=>{args.push(params[Number(i)-1]);return '?'}),params:args}}
 return {state:compile(`SELECT ${erased} erased,${blocked} blocked,${unchanged} unchanged`),guard:(allowBlocked=false)=>compile(`NOT ${erased} AND ${unchanged}${allowBlocked?'':` AND NOT ${blocked}`}`)}
}
export async function admissionState(env:Env,admission:ReturnType<typeof requesterAdmission>){return (await env.DB.prepare(admission.state.sql).bind(...admission.state.params).first<{erased:number;blocked:number;unchanged:number}>())!}
export async function assertAdmission(env:Env,admission:ReturnType<typeof requesterAdmission>,allowBlocked=false){
 const state=await admissionState(env,admission)
 if(state.erased)throw new ApiError(409,'identity_erased')
 if(!state.unchanged)throw new ApiError(409,'identity_changed')
 if(state.blocked&&!allowBlocked)throw new ApiError(403,'blocked_sender','Requester is blocked')
 return state
}
