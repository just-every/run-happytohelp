import type {SourceRecord} from '../../import-kit/src/types'
import {LIMITS} from '../types'
import {object,sourceId,sourceRecord,text,time} from './common'
/** A Zendesk ticket a staff member raised for themselves names that agent or admin as
 * its requester. The conversation still needs a contact, so the requester comes across
 * as an inert contact of their own: no email, not verified, no access or assignment.
 *
 * It is a record derived from the staff user record in the same batch, kind
 * `staff-requester` keyed by the Zendesk user id, never the user record itself. An
 * earlier import may already hold that user record with no effects (historical
 * staff); giving it a contact now would contradict that held claim. The derived record
 * has its own source identity, so it imports alongside, and later batches and pulls
 * that carry the same requester find it already held and link to it. The hyphen keeps
 * the kind out of reach of an uploaded wrapper (`{"staff_requester":…}`). */
export const STAFF_REQUESTER='staff-requester'
export const staffRole=(role:unknown)=>role==='agent'||role==='admin'
/** The derived requester records for tickets whose requester is staff. */
export function staffRequesters(records:SourceRecord[],count:number):SourceRecord[]{
 const users=new Map(records.filter(r=>r.kind==='user').map(r=>[r.sourceId,r])),added=new Map<string,SourceRecord>()
 for(const ticket of records){
  if(ticket.kind!=='ticket')continue
  let id:string;try{id=sourceId((ticket.payload as any)?.requester_id,'zendesk')}catch{continue}
  const user=users.get(id),p=user?.payload as any
  if(!user||added.has(id)||!object(p)||!staffRole(p.role))continue
  if(count+added.size>=LIMITS.records)throw new Error('export_record_limit')
  added.set(id,sourceRecord('zendesk',STAFF_REQUESTER,id,{id:p.id,name:p.name??null,created_at:p.created_at??null},user.location.artifact,user.artifactHash,user.location.row??1,`${user.location.pointer??''}/requester`))
 }
 return [...added.values()]
}
/** The inert contact for one staff requester. */
export function staffRequesterContact(projectId:string,record:SourceRecord,target:string){
 const p=record.payload as any
 return {
  contacts:[{id:target,project_id:projectId,name:text(p.name,'contact_name_required',500),email:null,external_id:`import:zendesk:${record.sourceId}`,created_at:time(p.created_at,'iso'),is_verified:0,metadata_json:JSON.stringify({imported_tags:[]})}],
  context_subjects:[{project_id:projectId,subject_id:target,consent:0,revision:0,help_types:'[]',bot_enabled:0}],
 }
}
