import {type LegacyBundle,type Row,timestamp} from './types'
/** The lookups native mapping makes across tables. An in-memory bundle builds
 * them once; a chunked package supplies an equivalent on-disk index instead. */
export interface Relationships {
 find(table:string,id:unknown):Row|undefined
 messages:{get(conversationId:string):Row[]|undefined}
 revisions:{get(messageId:string):number|undefined}
 mediaMessages:{get(mediaId:string):Row|undefined}
 /** Every link (`mediables` row) of a file, whatever its parent. */
 mediaLinks:{get(mediaId:string):Row[]|undefined}
 identityOwner(project:unknown,identity:string):Row|undefined
 localIdOwner(conversationId:string,localId:string):string|undefined
}
// Transcript order: time, then original ID.
export const transcriptOrder=(a:Row,b:Row)=>timestamp(a.created_at)-timestamp(b.created_at)||String(a.id).localeCompare(String(b.id))
export const isMessageMedia=(join:Row)=>String(join.mediable_type).endsWith('Message')
// Build once per mapping context, rather than scanning every conversation's
// full transcript for each imported row in a production-sized project.
const cache=new WeakMap<LegacyBundle,Relationships>()
function build(bundle:LegacyBundle):Relationships{
 const ids=new Map<string,Map<string,Row>>()
 for(const [table,rows]of Object.entries(bundle.tables))ids.set(table,new Map(rows.filter(r=>r.id!==undefined).map(r=>[String(r.id),r])))
 const messages=new Map<string,Row[]>()
 for(const row of bundle.tables.messages||[])if(!row.deleted_at){const id=String(row.conversation_id);if(!messages.has(id))messages.set(id,[]);messages.get(id)!.push(row)}
 const revisions=new Map<string,number>(),localIds=new Map<string,string>()
 for(const [conversation,rows] of messages){rows.sort(transcriptOrder);rows.forEach((r,i)=>{revisions.set(String(r.id),i+1);if(r.local_id&&!localIds.has(`${conversation}\u0000${r.local_id}`))localIds.set(`${conversation}\u0000${r.local_id}`,String(r.id))})}
 const mediaMessages=new Map((bundle.tables.mediables||[]).filter(isMessageMedia).map(r=>[String(r.media_id),r]))
 const mediaLinks=new Map<string,Row[]>()
 for(const row of bundle.tables.mediables||[]){const id=String(row.media_id);if(!mediaLinks.has(id))mediaLinks.set(id,[]);mediaLinks.get(id)!.push(row)}
 // Legacy allowed several contacts per identifier; native keeps it on the earliest one.
 const identityOwners=new Map<string,Row>()
 const earlier=(a:Row,b:Row)=>timestamp(a.created_at)-timestamp(b.created_at)||(String(a.id)<String(b.id)?-1:1)
 for(const row of bundle.tables.contacts||[]){const identity=contactIdentity(row);if(identity===null)continue;const key=`${row.project_id}\u0000${identity}`,owner=identityOwners.get(key);if(!owner||earlier(row,owner)<0)identityOwners.set(key,row)}
 return {find:(table:string,id:unknown)=>ids.get(table)?.get(String(id)),messages,revisions,mediaMessages,mediaLinks,identityOwner:(project:unknown,identity:string)=>identityOwners.get(`${project}\u0000${identity}`),localIdOwner:(conversationId:string,localId:string)=>localIds.get(`${conversationId}\u0000${localId}`)}
}
// Legacy stores "no identifier" as an empty string.
export function contactIdentity(row:Row):string|null{const value=row.identifier??row.external_id;return value===undefined||value===null||String(value)===''?null:String(value)}
export function relationships(bundle:LegacyBundle){let result=cache.get(bundle);if(!result){result=build(bundle);cache.set(bundle,result)}return result}
/** Use a prepared index as this context's relationships, so the context's
 * large tables never need to be held in memory. */
export function useRelationships(bundle:LegacyBundle,index:Relationships){cache.set(bundle,index);return bundle}
