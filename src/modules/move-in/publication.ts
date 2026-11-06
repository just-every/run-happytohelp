import {planFingerprint} from '../import-kit/src/plan/index'
import type {D1Sql,ImportPlan} from '../import-kit/src/d1/index'
import type {Env} from '../../platform/env'
import type {ReviewManifest} from './plans'
import {LIMITS} from './types'
import {emailKey} from './contact-keys'
/** email: the digest of the contact's address, or null for a contact with none (it then
 * has no contact-key row and is matched by external id alone). */
export interface PublicationContact {id:string;email:string|null;external:string|null}
export function publicationContact(project:string,id:string,value:any):PublicationContact{
 const contact=value.tables.contacts[0]
 return {id,email:typeof contact.email==='string'?emailKey(project,contact.email):null,external:contact.external_id}
}
/** Version-one reviews predate the identity summary. Recover it from their exact
 * approved child plans, validating every plan before using its effects. */
export async function reviewedContacts(env:Env,review:ReviewManifest){
 if(review.contacts!==undefined){if(!Array.isArray(review.contacts)||review.contacts.length>LIMITS.records||review.contacts.some(c=>typeof c.id!=='string'||c.email!==null&&(typeof c.email!=='string'||!/^([a-f0-9]{64})$/.test(c.email))||typeof c.external!=='string'&&c.external!==null))throw new Error('reviewed_plan_changed');return review.contacts}
 const contacts:PublicationContact[]=[]
 for(const child of review.batches){const object=await env.FILES.get(child.key);if(!object||object.size!==child.bytes||object.size>LIMITS.planBytes)throw new Error('reviewed_plan_changed');const plan=await object.json<ImportPlan>();if(planFingerprint(plan)!==child.fingerprint||plan.fingerprint!==child.fingerprint||plan.entries.length!==child.total||plan.destination!==review.projectId||plan.namespace!==review.vendor)throw new Error('reviewed_plan_changed');for(const entry of plan.entries)for(const effect of entry.effects)if(effect.targetKind==='contact')contacts.push(publicationContact(review.projectId,effect.targetId,effect.value))}
 return contacts
}
/** Every predicate fits a separate statement even at the largest accepted input.
 * A native identity write invalidates the Unicode-normalized index; unknown
 * digests refuse publication until bounded reconciliation runs. */
export function publicationPredicates(project:string,contacts:PublicationContact[]):D1Sql[]{
 if(!contacts.length)return []
 const predicates:D1Sql[]=[{sql:'NOT EXISTS(SELECT 1 FROM move_in_contact_keys WHERE project_id=? AND email_digest IS NULL)',params:[project]}]
 for(let start=0;start<contacts.length;start+=500)predicates.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) candidate WHERE
   EXISTS(SELECT 1 FROM move_in_contact_keys native WHERE native.project_id=? AND native.email_digest=json_extract(candidate.value,'$.email') AND native.contact_id<>json_extract(candidate.value,'$.id'))
   OR EXISTS(SELECT 1 FROM contacts native WHERE native.project_id=? AND native.external_id=json_extract(candidate.value,'$.external') AND native.id<>json_extract(candidate.value,'$.id')))`,params:[JSON.stringify(contacts.slice(start,start+500)),project,project]})
 return predicates
}
/** Keep the same per-predicate diagnostics, in one D1 read round trip. The
 * publication wrapper still repeats every predicate around each atomic write. */
export async function checkPublication(db:D1Database,groups:{predicates:D1Sql[];error:string}[]){
 const checks=groups.flatMap(group=>group.predicates.map(predicate=>({predicate,error:group.error})));if(!checks.length)return
 const results=await db.batch<{allowed:number}>(checks.map(({predicate})=>db.prepare(`SELECT (${predicate.sql}) allowed`).bind(...predicate.params!)))
 for(let index=0;index<checks.length;index++)if(!results[index].results[0]?.allowed)throw new Error(checks[index].error)
}
/** The outer bounded D1 port counts these additional statements too. They share
 * Base's native transaction; a failed postcondition rolls back all its effects. */
export function publicationDatabase(db:D1Database,predicates:D1Sql[]):D1Database{
 if(!predicates.length)return db
 const guards=()=>predicates.map(p=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${p.sql}) THEN 1 ELSE 0 END`).bind(...p.params!))
 return new Proxy(db,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{const result=await target.batch([...guards(),...statements,...guards(),target.prepare('DELETE FROM ik_d1_assertions')]);return result.slice(predicates.length,-predicates.length-1)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
}
