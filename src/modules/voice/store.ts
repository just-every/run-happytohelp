import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {encryptToken} from '../integrations/secrets'
import {callId,usableContact,type VoiceNumber,type VoiceSettings} from './model'
/** Provider IDs and phone identity are hashed before indexing. Erasure retains only
 * the identity fence, so late signed events cannot recreate the customer. */
export async function admitCall(env:Env,n:VoiceNumber,remote:string,caller:string){
 const id=await callId(n,remote),digest=await hashToken(JSON.stringify([n.project_id,caller])),contactId='voice-contact-'+digest,conversationId='voice-ticket-'+digest,now=Date.now(),s:VoiceSettings=JSON.parse(n.settings_json)
 const previous=await env.DB.prepare('SELECT v.erased,v.remote_cipher,vi.phone_hash FROM voice_calls v LEFT JOIN voice_identities vi ON vi.project_id=v.project_id AND vi.contact_id=v.contact_id WHERE v.id=?').bind(id).first<{erased:number;remote_cipher:string|null;phone_hash:string|null}>()
 if(previous&&(previous.erased||previous.phone_hash!==digest))throw new HTTPException(409,{message:'Provider call identity conflicts with its original caller or erasure fence'})
 if(previous&&!previous.remote_cipher)throw new HTTPException(409,{message:'An archived call cannot resume after reconnect. Start a new call.'})
 const valid=`EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND project_id=? AND enabled=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM voice_calls WHERE id=? AND contact_id<>?)`,args=[n.id,n.project_id,n.version,id,contactId]
 const identity=`EXISTS(SELECT 1 FROM voice_identities vi JOIN contacts ct ON ct.id=vi.contact_id AND ct.project_id=vi.project_id WHERE vi.project_id=? AND vi.phone_hash=? AND vi.erased=0 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=ct.project_id AND e.contact_id=ct.id) AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)=0)`,identityArgs=[n.project_id,digest]
 const phoneCipher=await encryptToken(env,n.project_id,caller),remoteCipher=await encryptToken(env,n.project_id,remote)
 await env.DB.batch([
 env.DB.prepare(`INSERT OR IGNORE INTO contacts(id,project_id,name,created_at) SELECT ?,?,'Telephone customer',? WHERE ${valid} AND NOT EXISTS(SELECT 1 FROM voice_identities WHERE project_id=? AND phone_hash=?)`).bind(contactId,n.project_id,now,...args,n.project_id,digest),
 env.DB.prepare(`INSERT OR IGNORE INTO voice_identities(project_id,phone_hash,contact_id,phone_cipher) SELECT ?,?,?,? WHERE ${valid} AND EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=?)`).bind(n.project_id,digest,contactId,phoneCipher,...args,contactId,n.project_id),
 env.DB.prepare(`UPDATE voice_identities SET phone_cipher=coalesce(phone_cipher,?) WHERE project_id=? AND phone_hash=? AND erased=0 AND ${valid} AND ${identity}`).bind(phoneCipher,n.project_id,digest,...args,...identityArgs),
 env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,created_at,updated_at,channel,subject,group_id,status_id,status_category) SELECT ?,?,?,?,?,'phone','Telephone support',?,'open','open' WHERE ${valid} AND ${identity}`).bind(conversationId,n.project_id,contactId,now,now,s.group_id,...args,...identityArgs),
 env.DB.prepare(`INSERT OR IGNORE INTO voice_calls(id,project_id,number_id,conversation_id,contact_id,remote_cipher,direction,media_expires_at,created_at,updated_at) SELECT ?,?,?,c.id,c.contact_id,?,'inbound',?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${usableContact} AND ${valid} AND ${identity}`).bind(id,n.project_id,n.id,remoteCipher,now+(s.retention_days??1)*86400000,now,now,conversationId,n.project_id,...args,...identityArgs),
 // Private inbox receipts neither send a message nor enter customer transcripts.
 env.DB.prepare(`INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,v.conversation_id,(SELECT user_id FROM memberships WHERE project_id=v.project_id AND role='owner' LIMIT 1),'Incoming telephone call. Voice details: /api/voice/projects/'||v.project_id||'/conversations/'||v.conversation_id||'/calls',? FROM voice_calls v WHERE v.id=? AND v.erased=0`).bind(id,now,id),
 env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source,target_type,target_id,detail_json) SELECT ?,project_id,?,'integration','voice.call_received','succeeded','system','integration','conversation',conversation_id,'{}' FROM voice_calls WHERE id=? AND erased=0`).bind('received:'+id,now,id),
 ])
 const call=await env.DB.prepare(`SELECT v.* FROM voice_calls v JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.id=? AND v.erased=0 AND ${usableContact}`).bind(id).first<any>()
 if(!call)throw new HTTPException(409,{message:'Caller is unavailable; late calls cannot restore an erased identity'})
 return call
}
export async function privateReceipt(env:Env,id:string,text:string){
 await env.DB.prepare(`UPDATE conversation_notes SET content=? WHERE id=? AND EXISTS(SELECT 1 FROM voice_calls v JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.id=? AND v.erased=0 AND ${usableContact})`).bind(text,id,id).run()
}
