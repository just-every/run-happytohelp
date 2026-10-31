import type {MobileScope} from './authority'
import type {Authoring} from '../outcomes/provenance'

export interface MobileCredential {deviceId:string;projectId:string;token:string;scopes:MobileScope[];expiresAt:number}
export interface MobileSession extends Omit<MobileCredential,'token'> {}
export interface MobileApproval {
 jobId:string;summary:string
 replies:{id:string;title:string;body:string;attachment_ids?:string[]}[]
 followUpActions:{id:string;title:string;mode:'investigate'|'resolve';instructions:string;attachment_ids?:string[]}[]
}
export interface MobileApprovalReceipt {child_delegation_id:string;status:string}
export interface TicketSnapshot {
 ticket:{id:string;revision:number;ticket_version:number;last_message_id:string|null;[key:string]:unknown}
 frontier:string;frontierExpiresAt:number;schedules:unknown[];messages:unknown[];notes:unknown[];media:unknown[]
}
export interface DraftFile {filename:string;contentType:string;bytes:Uint8Array;mediaId?:string}
export interface MobileDraft {
 localId:string;content:string;resolve:boolean;mediaIds:string[];files:DraftFile[];frontier:string
 reviewRequired:boolean;outcome:'unsent'|'sending'|'uncertain'|'refused'
 authoring?:Authoring
}
export type ConnectionState='reconnect-required'|'reconnecting'|'online'|'offline'|'signed-out'
export type PurgeReason='signout'|'revocation'|'authority-change'|'workspace-change'|'process-exit'

// Clear the owned objects in place too: a view holding a nested object or byte
// buffer must not keep displaying it after its cache owner is purged.
export function clearMemory(value:unknown):void {
 if(value instanceof Uint8Array){value.fill(0);return}
 if(value instanceof ArrayBuffer){new Uint8Array(value).fill(0);return}
 if(value&&typeof value==='object'){
  for(const key of Object.keys(value)){clearMemory((value as Record<string,unknown>)[key]);delete (value as Record<string,unknown>)[key]}
  if(Array.isArray(value))value.length=0
 }
}

export class MobileMemory {
 readonly tickets=new Map<string,TicketSnapshot>()
 readonly drafts=new Map<string,MobileDraft>()
 readonly resources=new Map<string,unknown>()
 invalidate(){for(const draft of this.drafts.values())draft.reviewRequired=true}
 forgetTicket(id:string){
  clearMemory(this.tickets.get(id));this.tickets.delete(id)
  clearMemory(this.drafts.get(id));this.drafts.delete(id)
  for(const [key,value] of this.resources)if(key.startsWith(id+'/')){clearMemory(value);this.resources.delete(key)}
 }
 purge(){
  for(const map of [this.tickets,this.drafts,this.resources]){for(const value of map.values())clearMemory(value);map.clear()}
 }
}
