import type {Env} from '../../platform/env'
import type {Run,Vendor} from './types'
import {encryptToken,decryptToken} from '../integrations/secrets'
import type {VendorCredential} from './api-http'
import {guarded} from './context'
import {sha256} from '../import-kit/src/d1/index'
import {putPrivate} from './private-custody'
import {cutoverChannels} from './api-cutover'
export interface Connection {id:string;project_id:string;vendor:Vendor;base_url:string;created_by:string;watermark:number|null;cutover_at:number|null;retry_at:number|null}
export interface ApiRun {run_id:string;connection_id:string;mode:'initial'|'delta';since:number|null;watermark:number;cursor_json:string|null;counts_json:string;cutover_at:number|null}
export const apiRun=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_api_runs WHERE run_id=?').bind(id).first<ApiRun>()
export const connection=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_connections WHERE id=?').bind(id).first<Connection>()
export async function saveCredential(env:Env,row:Connection,value:VendorCredential){return env.DB.prepare('INSERT OR REPLACE INTO move_in_credentials VALUES(?,?)').bind(row.id,await encryptToken(env,`${row.project_id}:move-in:${row.id}`,JSON.stringify(value)))}
export async function readCredential(env:Env,row:Connection){const secret=await env.DB.prepare('SELECT cipher FROM move_in_credentials WHERE connection_id=?').bind(row.id).first<{cipher:string}>();if(!secret)throw new Error('This connection has no saved token. Reconnect after restoring an export.');return JSON.parse(await decryptToken(env,`${row.project_id}:move-in:${row.id}`,secret.cipher)) as VendorCredential}
export async function startApiRun(env:Env,row:Connection,actor:Pick<Run,'actor_id'|'project_id'|'session_hash'>,mode:'initial'|'delta'){
 const active=await env.DB.prepare("SELECT r.id FROM move_in_api_runs a JOIN move_in_runs r ON r.id=a.run_id WHERE a.connection_id=? AND r.state NOT IN ('completed','undone','erased') LIMIT 1").bind(row.id).first()
 if(active)throw new Error('Finish, resume or undo the existing import before starting another sync.')
 const id=crypto.randomUUID(),now=Date.now(),watermark=now-(row.vendor==='zendesk'?120000:0),name=`${row.vendor}-${mode}-${new Date(now).toISOString().slice(0,10)}.json`,key=`move-in/${row.project_id}/${id}/original`,body=JSON.stringify({vendor:row.vendor,mode,since:mode==='delta'?row.watermark:null,startedAt:now}),bytes=new TextEncoder().encode(body)
 const run={...actor,id,vendor:row.vendor,state:'fetching',cursor:0} as Run
 await guarded(env,run,[env.DB.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,created_at,updated_at,identity_complete,identity_audited) VALUES(?,?,?,?,?,?,?,?,?,'fetching',?,?,0,1)").bind(id,actor.project_id,actor.actor_id,actor.session_hash,row.vendor,name,sha256(bytes),key,bytes.length,now,now),env.DB.prepare('INSERT INTO move_in_api_runs(run_id,connection_id,mode,since,watermark) VALUES(?,?,?,?,?)').bind(id,row.id,mode,mode==='delta'?row.watermark:null,watermark)])
 if(mode==='delta')await guarded(env,run,[env.DB.prepare("INSERT INTO move_in_api_agents(run_id,source_id,name,email,deleted,member_id) SELECT ?1,a.source_id,a.name,a.email,a.deleted,a.member_id FROM move_in_api_agents a WHERE a.run_id=(SELECT r.id FROM move_in_api_runs ar JOIN move_in_runs r ON r.id=ar.run_id WHERE ar.connection_id=?2 AND r.state='completed' ORDER BY ar.watermark DESC LIMIT 1)").bind(id,row.id)])
 await putPrivate(env,run,key,bytes,{httpMetadata:{contentType:'application/json'}})
 return id
}
export async function apiDetails(env:Env,run:Run){
 const api=await apiRun(env,run.id);if(!api)return undefined
 const conn=await connection(env,api.connection_id),agents=(await env.DB.prepare('SELECT source_id id,name,email,deleted,member_id memberId FROM move_in_api_agents WHERE run_id=? ORDER BY deleted,name,source_id').bind(run.id).all<any>()).results,members=(await env.DB.prepare('SELECT u.id,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name').bind(run.project_id).all<any>()).results,failures=(await env.DB.prepare('SELECT ticket_id ticketId,filename,error FROM move_in_api_files WHERE run_id=? AND error IS NOT NULL ORDER BY ticket_id,filename').bind(run.id).all<any>()).results
 const needsReconnect=!await env.DB.prepare('SELECT 1 FROM move_in_credentials WHERE connection_id=?').bind(api.connection_id).first()
 return {connectionId:api.connection_id,mode:api.mode,checkpoint:JSON.parse(run.files_json).length,needsReconnect,counts:JSON.parse(api.counts_json),agents,members,attachmentFailures:failures,cutover:!!(api.cutover_at||conn?.cutover_at),channels:await cutoverChannels(env,run)}
}
