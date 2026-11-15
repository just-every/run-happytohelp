import type {LegacyBundle,MappedRow} from './types'
import {noRequesterId} from '../customers/no-requester'

export const missingLegacyRequester=(value:unknown)=>value===undefined||value===null||value===''
export function legacyNeedsRequester(bundle:LegacyBundle,projectId:string){return (bundle.tables.conversations??[]).some(row=>String(row.project_id)===projectId&&missingLegacyRequester(row.contact_id))}
/** A workspace resource, never a substitute human or an invented mailbox. */
export function legacySystemRequester(projectId:string):MappedRow[]{
 const id=noRequesterId(projectId)
 return [
  {table:'contacts',key:['id'],row:{id,project_id:projectId,name:'No requester',email:null,external_id:null,is_verified:0,metadata_json:JSON.stringify({system_contact:'no_requester'}),created_at:0}},
 ]
}
