import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {encryptToken,decryptToken} from '../secrets'
import type {MailboxRow,MailboxAddress,MailboxProvider} from './types'

export function address(value:unknown):string {
 if(typeof value!=='string'||value.length>320||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(value.trim()))throw new HTTPException(400,{message:'Valid mailbox address required'})
 return value.trim().toLowerCase()
}
export async function mailboxForDelivery(env:Env,projectId:string,mailboxId?:string):Promise<MailboxRow|null>{
 if(!mailboxId)return null // Caller must deliberately select a support mailbox.
 return env.DB.prepare(`SELECT m.* FROM mailbox_connections m WHERE m.id=? AND m.project_id=? AND m.status='connected'
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
 .bind(mailboxId,projectId).first<MailboxRow>()
}
export async function getMailbox(env:Env,projectId:string,id:string){
 const row=await env.DB.prepare('SELECT * FROM mailbox_connections WHERE id=? AND project_id=?').bind(id,projectId).first<MailboxRow>()
 if(!row)throw new HTTPException(404,{message:'Mailbox not found'})
 return row
}
export async function lookupReceivingMailbox(env:Env,value:string){
 let normalized:string;try{normalized=address(value)}catch{return null}
 const row=await env.DB.prepare(`SELECT a.project_id,a.mailbox_id,a.address FROM mailbox_addresses a JOIN mailbox_connections m ON m.id=a.mailbox_id AND m.project_id=a.project_id
 WHERE a.address=? AND m.status IN ('connected','needs_backfill')
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=a.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
 .bind(normalized).first<{project_id:string;mailbox_id:string;address:string}>()
 return row?{projectId:row.project_id,mailboxId:row.mailbox_id,address:row.address}:null
}
export const credentialScope=(row:Pick<MailboxRow,'project_id'|'id'>)=>`${row.project_id}:mailbox:${row.id}`
export async function readCredential<T>(env:Env,row:MailboxRow):Promise<T>{
 if(!row.credential_cipher)throw new HTTPException(409,{message:'Mailbox needs reconnecting'})
 return JSON.parse(await decryptToken(env,credentialScope(row),row.credential_cipher)) as T
}
export async function sealCredential(env:Env,row:Pick<MailboxRow,'project_id'|'id'>,value:unknown){return encryptToken(env,credentialScope(row),JSON.stringify(value))}
export async function assertAddressAvailable(env:Env,projectId:string,value:string,mailboxId:string){
 const other=await env.DB.prepare('SELECT mailbox_id FROM mailbox_addresses WHERE address=? AND mailbox_id<>?').bind(value,mailboxId).first()
 const legacy=await env.DB.prepare(`SELECT e.project_id FROM email_settings e WHERE lower(e.inbound_address)=? AND e.project_id<>? AND e.is_enabled=1
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=e.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(value,projectId).first()
 if(other||legacy)throw new HTTPException(409,{message:'Address already belongs to an active mailbox'})
}
export async function saveConnection(env:Env,input:{id:string;projectId:string;provider:MailboxProvider;address:string;displayName:string;actorId:string;credential?:unknown;addresses:MailboxAddress[];expectedVersion?:number;authorityRevision?:number}){
 const primary=address(input.address),addresses=[...new Map(input.addresses.map(a=>[address(a.address),a])).values()]
 if(!addresses.some(a=>address(a.address)===primary))throw new HTTPException(400)
 if(addresses.length>100)throw new HTTPException(400,{message:'Too many mailbox aliases'})
 for(const a of addresses)await assertAddressAvailable(env,input.projectId,address(a.address),input.id)
 const cipher=input.credential===undefined?null:await sealCredential(env,{id:input.id,project_id:input.projectId},input.credential),now=Date.now(),mutation=crypto.randomUUID()
 try{const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO mailbox_connections(id,project_id,provider,address,display_name,status,credential_cipher,connected_by,created_at,updated_at,mutation_token)
   SELECT ?,?,?,?,?,'connected',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=? AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)
   AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role IN ('owner','admin'))
   AND (? IS NULL OR ?=(SELECT revision FROM integration_authority_epoch WHERE id=1))
   ON CONFLICT(id) DO UPDATE SET credential_cipher=excluded.credential_cipher,credential_version=mailbox_connections.credential_version+1,status='connected',error_code=NULL,updated_at=excluded.updated_at,mutation_token=excluded.mutation_token,connected_by=excluded.connected_by
   WHERE mailbox_connections.project_id=excluded.project_id AND mailbox_connections.provider=excluded.provider AND mailbox_connections.address=excluded.address AND (? IS NULL OR mailbox_connections.credential_version=?)`)
   .bind(input.id,input.projectId,input.provider,primary,input.displayName,cipher,input.actorId,now,now,mutation,input.projectId,input.projectId,input.actorId,input.authorityRevision??null,input.authorityRevision??null,input.expectedVersion??null,input.expectedVersion??null),
  env.DB.prepare('DELETE FROM mailbox_addresses WHERE mailbox_id=? AND project_id=? AND EXISTS(SELECT 1 FROM mailbox_connections WHERE id=? AND mutation_token=?)').bind(input.id,input.projectId,input.id,mutation),
  ...addresses.map(a=>env.DB.prepare(`INSERT INTO mailbox_addresses(address,mailbox_id,project_id,can_send,is_primary)
   SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mailbox_connections WHERE id=? AND project_id=? AND status='connected' AND mutation_token=?)`)
   .bind(address(a.address),input.id,input.projectId,a.canSend?1:0,address(a.address)===primary?1:0,input.id,input.projectId,mutation)),
  env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
   SELECT ?,?,?,'integration',?,'succeeded','user',?,'dashboard','mailbox',?,'{}' WHERE EXISTS(SELECT 1 FROM mailbox_connections WHERE id=? AND mutation_token=?)`)
   .bind(crypto.randomUUID(),input.projectId,now,input.expectedVersion===undefined?'mailbox.connected':'mailbox.reconnected',input.actorId,input.id,input.id,mutation),
 ]);if(!results[0].meta.changes)throw new HTTPException(409,{message:'Mailbox connection or authority changed'})}catch(error){if(/constraint|unique/i.test(String(error)))throw new HTTPException(409,{message:'Mailbox address already connected'});throw error}
}
export async function publicMailbox(env:Env,row:MailboxRow){
 const [aliases,signatures]=await Promise.all([
  env.DB.prepare('SELECT address,can_send,is_primary FROM mailbox_addresses WHERE mailbox_id=? ORDER BY is_primary DESC,address').bind(row.id).all(),
  env.DB.prepare('SELECT agent_id,text,html FROM mailbox_signatures WHERE mailbox_id=? ORDER BY agent_id').bind(row.id).all(),
 ])
 return {id:row.id,provider:row.provider,address:row.address,display_name:row.display_name,sender_address:row.sender_address||row.address,status:row.status,last_sync_at:row.last_sync_at,error_code:row.error_code,cursor:row.cursor_json?JSON.parse(row.cursor_json):null,addresses:aliases.results.map((a:any)=>({...a,can_send:Boolean(a.can_send),is_primary:Boolean(a.is_primary)})),signatures:signatures.results}
}
