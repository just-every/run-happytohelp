import {identityDigest} from '../../move-in/identities'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {invalid,type DecodedLegacy} from './format'

/** Object ownership survives deleted/archived parents and image variants. File
 * equality is never treated as equality of people or shared-object authority. */
export function legacyBlobContext(decoded:DecodedLegacy,project:string){
 const tables=decoded.bundle.tables,media=new Map((tables.media??[]).map(row=>[String(row.id),row])),messages=new Map((tables.messages??[]).map(row=>[String(row.id),row])),conversations=new Map((tables.conversations??[]).map(row=>[String(row.id),row])),joins=new Map<string,string>()
 for(const row of tables.mediables??[])if(String(row.mediable_type).endsWith('Message')){const id=String(row.media_id),message=String(row.mediable_id);if(joins.has(id)&&joins.get(id)!==message)invalid('Legacy media has ambiguous message ownership.');joins.set(id,message)}
 return decoded.objects.map(({metadata})=>{
  const raw=media.get(String(metadata.mediaId)),seen=new Set<string>();let row=raw,contact:unknown
  while(row){const id=String(row.id);if(seen.has(id))invalid('Legacy media ancestry cycles.');seen.add(id);const joined=joins.get(id);if(row.message_id!=null&&joined&&String(row.message_id)!==joined)invalid('Legacy media and pivot ownership disagree.');const message=messages.get(String(row.message_id??joined)),conversation=conversations.get(String(row.conversation_id??message?.conversation_id));contact=conversation?.contact_id??message?.contact_id;if(contact!==undefined||row.original_media_id==null)break;row=media.get(String(row.original_media_id))}
  const objectId=identityDigest(project,'legacy-object-id',String(metadata.mediaId)),object=identityDigest(project,'legacy-object',canonicalJson([metadata.mediaId,metadata.key,metadata.sha256])),aliases=new Set([objectId,object]),stack:unknown[]=[raw,metadata,contact]
  while(stack.length){const value=stack.pop();if(typeof value==='string'||typeof value==='number'){const text=String(value);for(const [kind,input] of [['legacy-value',text],['external',text],['email',text.trim().toLowerCase()]])if(input)aliases.add(identityDigest(project,kind,input));if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{const decoded=JSON.parse(value);if(decoded&&typeof decoded==='object')stack.push(decoded)}catch{}}}else if(Array.isArray(value))stack.push(...value);else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))stack.push(key,child);if(aliases.size>1024)invalid('Legacy object metadata exceeds the identity inspection allowance.')}
  return {objectId,object,aliases:[...aliases].sort()}
 })
}
