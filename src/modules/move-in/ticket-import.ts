import type {Env} from '../../platform/env'
import type {SourceRecord} from '../import-kit/src/types'

/** A historical assignee gains no access. Only one exact email match among current
 * workspace members can receive an imported assignment; names are never identity. */
export async function matchedAgents(env:Pick<Env,'DB'>,projectId:string,records:SourceRecord[]){
 const staff=records.filter(r=>r.kind==='user'&&['agent','admin'].includes((r.payload as any)?.role))
 const emails=[...new Set(staff.map(r=>(r.payload as any)?.email).filter((v):v is string=>typeof v==='string'&&v.trim()!=='').map(v=>v.trim().toLowerCase()))]
 if(!emails.length)return new Map<string,string>()
 const rows=(await env.DB.prepare('SELECT u.id,lower(trim(u.email)) email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND lower(trim(u.email)) IN (SELECT value FROM json_each(?))').bind(projectId,JSON.stringify(emails)).all<{id:string;email:string}>()).results
 const byEmail=new Map<string,string[]>();for(const row of rows)byEmail.set(row.email,[...(byEmail.get(row.email)??[]),row.id])
 return new Map(staff.flatMap(record=>{const email=(record.payload as any)?.email,ids=typeof email==='string'?byEmail.get(email.trim().toLowerCase()):undefined;return ids?.length===1?[[record.sourceId,ids[0]] as [string,string]]:[]}))
}
export function importedPriority(value:unknown,omissions:string[]){
 if(typeof value==='string'&&['low','normal','high','urgent'].includes(value))return value
 omissions.push(value===undefined||value===null?'priority_unrecorded_default_normal':'priority_not_mapped_default_normal')
 return 'normal'
}
export function importedAssignee(value:unknown,matches:Map<string,string>|undefined,omissions:string[],refusal?:{sourceId?:unknown;reason?:unknown}){
 if(value===undefined||value===null)return null
 const target=matches?.get(String(value))
 if(!target)omissions.push(refusal?.sourceId===String(value)&&typeof refusal.reason==='string'?'historical_assignment_profile_refused:'+String(value)+':'+refusal.reason:'historical_assignment_not_matched')
 return target??null
}
