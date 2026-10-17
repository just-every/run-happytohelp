import {apiContactIdentityGuard} from './contact-identity'
import type {SqlGuard} from '../../platform/integration-authority'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {text} from './common'
import {contactWritable} from '../../platform/contact-state'
export async function updateContactResource(env:Env,projectId:string,id:string,body:Record<string,unknown>,existing:any,guard?:SqlGuard){
 const metadata=JSON.parse(existing.metadata_json||'{}')
 if(metadata.is_erased||metadata.is_erasing)throw new HTTPException(409,{message:'This contact is being erased or was erased'})
 const fields:string[]=[],values:(string|null)[]=[]
 for(const key of ['provided_name','provided_email','phone'])if(key in body)metadata[key]=body[key]===null?null:text(body[key],320)
 if('provided_email' in body)metadata.provided_email_source='operator'
 if('is_blocked' in body){
  const wasBlocked=metadata.is_blocked===undefined?Boolean(metadata.blocked_at):Boolean(metadata.is_blocked)
  metadata.is_blocked=Boolean(body.is_blocked)
  metadata.blocked_at=metadata.is_blocked?(wasBlocked&&metadata.blocked_at||Date.now()):null
 }
 if(['provided_name','provided_email','phone','is_blocked'].some(key=>key in body)){fields.push('metadata_json');values.push(JSON.stringify(metadata))}
 for(const key of ['name','email','external_id'])if(key in body){fields.push(key);values.push(body[key]===null?null:text(body[key],320))}
 if(guard)guard=apiContactIdentityGuard(projectId,{...existing,...body,metadata_json:JSON.stringify(metadata)},guard)
 if(fields.length){const result=await env.DB.prepare(`UPDATE contacts SET ${fields.map(key=>`${key}=?`).join(',')} WHERE id=? AND project_id=? AND metadata_json IS ? AND ${contactWritable} ${guard?`AND EXISTS(${guard.sql})`:""}`).bind(...values,id,projectId,existing.metadata_json,...(guard?.params||[])).run();if(!result.meta.changes)throw new HTTPException(409,{message:'Contact changed; reload before editing'})}
 const current=await env.DB.prepare(`SELECT * FROM contacts WHERE id=? AND project_id=? AND ${contactWritable}`).bind(id,projectId).first()
 if(!current)throw new HTTPException(409,{message:'Contact changed; reload before editing'})
 return current
}
