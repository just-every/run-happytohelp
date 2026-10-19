import {batchRead} from '../tickets/request-batch'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {fieldAllowed,ticketReadAccess} from '../tickets/model'
/** Definitions and persisted drafts must not expose values from fields whose
 * read permission has since been removed. Apply separately validates writes. */
export async function assertMacroFieldsReadable(env:Env,actor:Actor,row:any){
 const access=await ticketReadAccess(env,actor),actions=JSON.parse(row.actions_json),fields=await batchRead(env,`fields:${actor.projectId}`,async()=>(await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=?').bind(actor.projectId).all<any>()).results)
 const references=new Set([...Object.keys(actions.fields??{}),...[...row.content.matchAll(/{{\s*ticket\.custom\.([^{}|\s]+)[^{}]*}}/g)].map((m:any)=>m[1])])
 for(const id of references){const field=fields.find(f=>f.id===id||f.key===id);if(field&&!fieldAllowed(field,access))throw new HTTPException(403,{message:'This macro refers to a field your role cannot read'})}
}
