import type {Vendor} from './types'
import {sourceId} from './readers/common'

export function sourceOwnership(vendor:Vendor,p:any){
 const id=(value:unknown)=>value===undefined||value===null||vendor==='intercom'&&String(value)==='0'?null:sourceId(value,vendor)
 if(vendor==='zendesk')return {ownerId:id(p.assignee_id),groupId:id(p.group_id)}
 if(vendor==='freshdesk')return {ownerId:id(p.responder_id),groupId:id(p.group_id)}
 if(vendor==='intercom')return {ownerId:id(p.admin_assignee_id),groupId:id(p.team_assignee_id)}
 if(!p.assignee)return {ownerId:null,groupId:null}
 if(!['user','team'].includes(p.assignee.type))throw Error('source_assignment_type_unsupported')
 return {ownerId:p.assignee.type==='user'?id(p.assignee.id):null,groupId:p.assignee.type==='team'?id(p.assignee.id):null}
}
