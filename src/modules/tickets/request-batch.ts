import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {deferRequestAssignments,requestRoom,assignmentRequestBudget} from '../integrations/notification-budget'

const preparation=Symbol('ticket batch preparation')
const metadataReads=Symbol('ticket request metadata')
type BatchEnv=Env&{[preparation]?:{reads:Map<string,Promise<any>>;tickets:Map<string,any>};[metadataReads]?:Map<string,Promise<any>>}
/** Memoize preparation metadata within one request without snapshotting tickets
 * or enabling batch mutation behavior. Commit guards still pin the observed role
 * and schema against live SQL; every ticket/contact read remains current. */
export function ticketMetadataEnvironment(env:Env):Env{
 const {[preparation]:_snapshot,...live}=env as BatchEnv
 return {...live,[metadataReads]:new Map<string,Promise<any>>()}
}
/** Preparation is a snapshot, never commit authority. Every native receipt still
 * checks the live session, role, schema, privacy and ticket frontier in SQL. */
export async function ticketBatchEnvironment(env:Env,actor:Actor,ids:string[]):Promise<Env>{
 const rows=await env.DB.prepare(`SELECT c.*,(SELECT ai_id FROM conversation_ai WHERE conversation_id=c.id) current_ai_id,
 (SELECT json_object('name',name,'email',email,'metadata_json',metadata_json) FROM contacts WHERE id=c.contact_id AND project_id=c.project_id) batch_contact,
 (SELECT json_group_object(field_id,json(value_json)) FROM ticket_field_values WHERE project_id=c.project_id AND conversation_id=c.id) batch_fields,
 (SELECT json_group_array(json_object('id',t.id,'name',t.name)) FROM conversation_tags ct JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id WHERE ct.project_id=c.project_id AND ct.conversation_id=c.id) batch_tags
 FROM conversations c WHERE c.project_id=? AND c.id IN (SELECT value FROM json_each(?)) AND ${contactAvailableSql()}
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(actor.projectId,JSON.stringify(ids)).all<any>()
 const result={...env,[preparation]:{reads:new Map(),tickets:new Map(rows.results.map(row=>[row.id,row]))}}
 deferRequestAssignments(result)
 return result
}
export const inTicketBatch=(env:Env)=>Boolean((env as BatchEnv)[preparation])
export function batchTicket(env:Env,id:string){
 const state=(env as BatchEnv)[preparation]
 if(!state)return undefined
 const row=state.tickets.get(id)
 if(!row)throw new HTTPException(404)
 const {batch_fields,batch_tags,batch_contact,...ticket}=row
 return {...ticket,fields:JSON.parse(batch_fields),tags:JSON.parse(batch_tags)}
}
export const batchContact=(env:Env,id:string)=>{const value=(env as BatchEnv)[preparation]?.tickets.get(id)?.batch_contact;return value?JSON.parse(value):undefined}
export const batchTicketIds=(env:Env)=>[...((env as BatchEnv)[preparation]?.tickets.keys()??[])]
export function batchRead<T>(env:Env,key:string,read:()=>Promise<T>):Promise<T>{
 const reads=(env as BatchEnv)[preparation]?.reads??(env as BatchEnv)[metadataReads]
 if(!reads)return read()
 if(!reads.has(key))reads.set(key,read())
 return reads.get(key)!
}
export class TicketCapacityError extends HTTPException {
 constructor(){super(503,{message:'This ticket was not changed because the request has no room for its complete mutation and receipt.'})}
}
export function admitTicketWork(env:Env,statements:number){
 if(assignmentRequestBudget(env)&&requestRoom(env)<statements)throw new TicketCapacityError()
}
