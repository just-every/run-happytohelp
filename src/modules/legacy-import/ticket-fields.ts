import type {LegacyBundle,Row} from './types'
import type {MappingProfile} from './adoption/profile'
import {historical} from './adoption/profile'

/** Legacy source IDs are not native principals. Match current workspace members
 * by one exact recorded email, preserving staff attribution separately. Only the
 * custodian joins a newly adopted workspace; other custody members gain no assignment. */
export async function legacyAssignees(db:D1Database,bundle:LegacyBundle,profile?:MappingProfile){
 if(!historical(profile))return new Map<string,string>()
 const users=bundle.tables.users??[],emails=[...new Set(users.map(u=>u.email).filter((v):v is string=>typeof v==='string'&&v.trim()!=='').map(v=>v.trim().toLowerCase()))]
 if(!emails.length)return new Map<string,string>()
 const rows=(await db.prepare('SELECT DISTINCT u.id,lower(trim(u.email)) email FROM users u JOIN memberships m ON m.user_id=u.id WHERE (m.project_id=? OR (m.project_id=? AND m.user_id=?)) AND lower(trim(u.email)) IN (SELECT value FROM json_each(?))').bind(profile.sourceProjectId,profile.custodyProjectId,profile.custodianId,JSON.stringify(emails)).all<{id:string;email:string}>()).results
 const matches=new Map<string,string[]>();for(const row of rows)matches.set(row.email,[...(matches.get(row.email)??[]),row.id])
 return new Map(users.flatMap(u=>{const ids=typeof u.email==='string'?matches.get(u.email.trim().toLowerCase()):undefined;return ids?.length===1?[[String(u.id),ids[0]] as [string,string]]:[]}))
}
export function legacyPriority(row:Row):{value?:string;reason?:string}{
 if(row.priority===undefined||row.priority===null)return {reason:'Legacy ticket priority was not recorded; native priority defaults to Normal'}
 if(typeof row.priority==='string'&&['low','normal','high','urgent'].includes(row.priority))return {value:row.priority}
 return {reason:'Legacy ticket priority has no native mapping; original value retained for review, native priority defaults to Normal'}
}
