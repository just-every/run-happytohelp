import type {SourceRecord} from '../../import-kit/src/types'
import type {Vendor} from '../types'
import {nativeId,text,time} from './common'

export function sourceGroup(record:SourceRecord,projectId:string,importedAt:number,omissions:string[]){
 const vendor=record.namespace as Vendor,p=record.payload as any
 if(!(vendor==='freshdesk'&&record.kind==='group'||['helpscout','intercom'].includes(vendor)&&record.kind==='team'))return null
 const id=nativeId(projectId,vendor,'group',record.sourceId),unknown=vendor==='intercom'
 const updated=unknown?importedAt:time(vendor==='helpscout'?p.updatedAt:p.updated_at,'iso')
 omissions.push('group_memberships_and_routing_require_native_review')
 if(unknown)omissions.push('group_source_timestamps_unavailable_native_import_time_recorded')
 return {kind:'group',target:id,tables:{ticket_groups:[{project_id:projectId,id,name:text(p.name,'group_name_required',200),updated_at:updated}],ticket_group_members:[]},...(unknown?{nativeCreatedAt:importedAt}:{})}
}
