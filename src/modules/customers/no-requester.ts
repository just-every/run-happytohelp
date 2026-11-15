import type {Env} from '../../platform/env'

export const noRequesterId=(projectId:string)=>`no-requester:${projectId}`
const marker='no_requester'
const metadata={system_contact:marker}
/** Accept native rows and hydrated contacts; malformed metadata never asserts a system identity. */
export function isNoRequester(contact:unknown):boolean{
 if(!contact||typeof contact!=='object')return false
 const row=contact as Record<string,unknown>
 if(typeof row.project_id!=='string'||row.id!==noRequesterId(row.project_id))return false
 if(row.system_contact===marker)return true
 try{const value=typeof row.metadata_json==='string'?JSON.parse(row.metadata_json):row.metadata;return !!value&&typeof value==='object'&&!Array.isArray(value)&&value.system_contact===marker}catch{return false}
}
/** System resources are visible on their tickets, but never act as customers. */
export const realContactSql=(alias='')=>{const prefix=alias?alias+'.':'';return `(${prefix}id<>('no-requester:'||${prefix}project_id) OR json_extract(${prefix}metadata_json,'$.system_contact') IS NOT '${marker}')`}

export type NoRequesterGuard={sql:string;params?:readonly unknown[]}
/** Called only by an explicit import admission, in its guarded atomic batch. A colliding identity aborts it. */
export function noRequesterStatements(env:Pick<Env,'DB'>,projectId:string,guard?:NoRequesterGuard):D1PreparedStatement[]{
 const db=env.DB,id=noRequesterId(projectId),held=guard?`(${guard.sql})`:'1',params=guard?.params??[]
 return [
  db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT ${held}`).bind(...params),
  db.prepare('INSERT OR IGNORE INTO contacts(id,project_id,name,email,external_id,is_verified,metadata_json,created_at) VALUES(?,?,?,NULL,NULL,0,?,?)').bind(id,projectId,'No requester',JSON.stringify(metadata),0),
  db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=? AND name='No requester' AND email IS NULL AND external_id IS NULL AND is_verified=0 AND metadata_json=?)`).bind(id,projectId,JSON.stringify(metadata)),
  db.prepare('INSERT INTO context_subjects(project_id,subject_id,consent,bot_enabled) VALUES(?,?,0,0) ON CONFLICT(project_id,subject_id) DO UPDATE SET consent=0,bot_enabled=0 WHERE context_subjects.consent<>0 OR context_subjects.bot_enabled<>0').bind(projectId,id),
  db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM context_subjects WHERE project_id=? AND subject_id=? AND consent=0 AND bot_enabled=0)').bind(projectId,id),
  db.prepare('DELETE FROM ik_d1_assertions'),
 ]
}

/** The storage marker stays internal to requester identity reads. */
export async function requesterReadFields(env:Pick<Env,'DB'>,ticket:{project_id:string;requester_id?:string|null}){
 if(ticket.requester_id!==noRequesterId(ticket.project_id))return {}
 const contact=await env.DB.prepare('SELECT id,project_id,metadata_json FROM contacts WHERE id=? AND +project_id=?').bind(ticket.requester_id,ticket.project_id).first()
 return isNoRequester(contact)?{contact_id:null,requester_id:null,requester_status:'none'}:{}
}
