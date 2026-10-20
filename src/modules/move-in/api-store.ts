import type {Env} from '../../platform/env'
import type {Run,Vendor} from './types'
import {encryptToken,decryptToken} from '../integrations/secrets'
import type {VendorCredential} from './api-http'
import {guarded} from './context'
import {sha256} from '../import-kit/src/d1/index'
import {putPrivate} from './private-custody'
export interface Connection {id:string;project_id:string;vendor:Vendor;base_url:string;created_by:string;watermark:number|null;cutover_at:number|null;retry_at:number|null}
export interface ApiRun {run_id:string;connection_id:string;mode:'initial'|'delta';since:number|null;watermark:number;cursor_json:string|null;counts_json:string;cutover_at:number|null}
export const apiRun=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_api_runs WHERE run_id=?').bind(id).first<ApiRun>()
export const connection=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_connections WHERE id=?').bind(id).first<Connection>()
export async function saveCredential(env:Env,row:Connection,value:VendorCredential){return env.DB.prepare('INSERT OR REPLACE INTO move_in_credentials VALUES(?,?)').bind(row.id,await encryptToken(env,`${row.project_id}:move-in:${row.id}`,JSON.stringify(value)))}
export async function readCredential(env:Env,row:Connection){const secret=await env.DB.prepare('SELECT cipher FROM move_in_credentials WHERE connection_id=?').bind(row.id).first<{cipher:string}>();if(!secret)throw new Error('This connection has no saved token. Reconnect after restoring an export.');return JSON.parse(await decryptToken(env,`${row.project_id}:move-in:${row.id}`,secret.cipher)) as VendorCredential}
export async function startApiRun(env:Env,row:Connection,actor:Pick<Run,'actor_id'|'project_id'|'session_hash'>,mode:'initial'|'delta'){
 const active=await env.DB.prepare("SELECT r.id FROM move_in_api_runs a JOIN move_in_runs r ON r.id=a.run_id WHERE a.connection_id=? AND r.state NOT IN ('completed','undone','erased') LIMIT 1").bind(row.id).first()
 if(active)throw new Error('Finish, resume or undo the existing import before starting another sync.')
 const id=crypto.randomUUID(),now=Date.now(),name=`${row.vendor}-${mode}-${new Date(now).toISOString().slice(0,10)}.json`,key=`move-in/${row.project_id}/${id}/original`,body=JSON.stringify({vendor:row.vendor,mode,since:mode==='delta'?row.watermark:null,startedAt:now}),bytes=new TextEncoder().encode(body)
 const run={...actor,id,vendor:row.vendor,state:'fetching',cursor:0} as Run
 await guarded(env,run,[env.DB.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,created_at,updated_at,identity_complete,identity_audited) VALUES(?,?,?,?,?,?,?,?,?,'fetching',?,?,0,1)").bind(id,actor.project_id,actor.actor_id,actor.session_hash,row.vendor,name,sha256(bytes),key,bytes.length,now,now),env.DB.prepare('INSERT INTO move_in_api_runs(run_id,connection_id,mode,since,watermark) VALUES(?,?,?,?,?)').bind(id,row.id,mode,mode==='delta'?row.watermark:null,now)])
 await putPrivate(env,run,key,bytes,{httpMetadata:{contentType:'application/json'}})
 return id
}
export async function apiDetails(env:Env,run:Run){
 const api=await apiRun(env,run.id);if(!api)return undefined
 const conn=await connection(env,api.connection_id),agents=(await env.DB.prepare('SELECT source_id id,name,email,deleted,member_id memberId FROM move_in_api_agents WHERE run_id=? ORDER BY deleted,name,source_id').bind(run.id).all<any>()).results,members=(await env.DB.prepare('SELECT u.id,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name').bind(run.project_id).all<any>()).results,failures=(await env.DB.prepare('SELECT ticket_id ticketId,filename,error FROM move_in_api_files WHERE run_id=? AND error IS NOT NULL ORDER BY ticket_id,filename').bind(run.id).all<any>()).results
 const mailbox=await env.DB.prepare("SELECT a.address FROM mailbox_addresses a JOIN mailbox_connections c ON c.id=a.mailbox_id WHERE c.project_id=? AND c.status<>'disconnected' ORDER BY c.created_at LIMIT 1").bind(run.project_id).first<{address:string}>(),origin=typeof env.APP_ORIGIN==='string'?env.APP_ORIGIN:'',project=await env.DB.prepare('SELECT widget_key FROM projects WHERE id=?').bind(run.project_id).first<{widget_key:string}>()
 const destination=mailbox?.address||`the receiving address shown in Settings → Email for this workspace`
 const channels=[{channel:'Help Center domain',instructions:[`If you use a custom Help Center domain, add it in Settings → Help center → Domains, verify its DNS challenge, then replace the existing ${run.vendor} CNAME with the exact CNAME target shown there. Keep the old Help Center available until the new domain is verified. If you have no custom Help Center domain, no DNS change is needed.`]},{channel:'Email',instructions:[`In ${run.vendor}, keep the old support address receiving mail and forward every message, including replies to old notification addresses, to ${destination}.`,`Keep Message-ID, In-Reply-To and References headers and the original subject token intact. Send a reply to an old notification and check its imported ticket before disabling the old inbox.`,`For a custom support domain, keep its MX records receiving at your mail provider; add the forwarding rule there. If moving MX to a different provider, copy that provider’s exact MX records from Settings → Email after verifying the domain. Do not change MX to the website’s address.`]},{channel:'Chat widget',instructions:[`Remove the ${run.vendor} widget loader from your website or tag manager.`,`Install the HappyToHelp widget script from Settings → Widget, using workspace key ${project?.widget_key||'shown there'} and installation ${origin}. Publish once, then start a new visitor conversation and check this inbox.`]}]
 return {connectionId:api.connection_id,mode:api.mode,counts:JSON.parse(api.counts_json),agents,members,attachmentFailures:failures,cutover:!!(api.cutover_at||conn?.cutover_at),channels}
}
