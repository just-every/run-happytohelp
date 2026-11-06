import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {auditStatement} from '../../audit/record'
import {serviceUrl} from '../../support-channels/teams'
import {liveConnection,type Connection} from '../../support-channels/model'
import {connectionAvailable,installationSql} from './authority'

type Member={id:string;projectId:string;sessionHash:string}
const hashToken=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
const sessionSql=`EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.project_id=l.project_id AND m.user_id=l.user_id
 WHERE s.token_hash=l.session_hash AND s.actor_id=l.user_id AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>?
 AND (s.project_id IS NULL OR EXISTS(SELECT 1 FROM memberships sm WHERE sm.project_id=s.project_id AND sm.user_id=s.actor_id AND sm.role=s.role)))`
export async function startLink(env:Env,member:Member){
 const consent=await connectionAvailable(env,member.projectId)
 if(!consent)throw new HTTPException(409,{message:'Teams notices are unavailable. An administrator must enable or reconnect the connection.'})
 const code=crypto.randomUUID(),now=Date.now(),hash=await hashToken(code)
 const done=await env.DB.batch([
  env.DB.prepare('DELETE FROM teammate_teams_codes WHERE project_id=? AND user_id=?').bind(member.projectId,member.id),
  env.DB.prepare(`INSERT INTO teammate_teams_codes(token_hash,project_id,user_id,session_hash,connection_id,expires_at)
   SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.project_id=? AND m.user_id=s.actor_id WHERE s.token_hash=? AND s.actor_id=? AND s.revoked_at IS NULL AND s.expires_at>?)
   AND EXISTS(SELECT 1 FROM teammate_teams_consent k WHERE k.project_id=? AND k.connection_id=? AND ${installationSql()})`)
   .bind(hash,member.projectId,member.id,member.sessionHash,consent.connection_id,now+600000,member.projectId,member.sessionHash,member.id,now,member.projectId,consent.connection_id)
 ])
 if(!done[1].meta.changes)throw new HTTPException(409,{message:'Authority changed; sign in and try again.'})
 return {code,expires_in:600,instruction:`Send “notify link ${code}” in a personal chat with the installed Teams bot. Then refresh your link status.`}
}
export async function unlink(env:Env,member:Member){
 await env.DB.batch([env.DB.prepare('DELETE FROM teammate_teams_codes WHERE project_id=? AND user_id=?').bind(member.projectId,member.id),env.DB.prepare('DELETE FROM teammate_teams_links WHERE project_id=? AND user_id=?').bind(member.projectId,member.id),auditStatement(env.DB,{projectId:member.projectId,category:'integration',action:'teammate_teams.unlinked',actor:{type:'user',id:member.id},source:'dashboard',target:{type:'user',id:member.id}})])
 return {unlinked:true}
}
/** H-SC1 is called only AFTER Bot Framework verification. On predicate/parse
 * mismatch this function has no effect. No provider request or channel authority. */
export async function capturePersonalTeamsLink(env:Env,row:Connection,raw:string){
 let b:any,code:string,url:string
 try{
  b=JSON.parse(raw)
  const channel=b.channelData?.channel?.id||''
  const text=typeof b.text==='string'?b.text.replace(/<at>[^<]*<\/at>/g,'').trim():''
  const match=/^notify link ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(text)
  if(row.provider!=='teams'||b.type!=='message'||b.conversation?.conversationType!=='personal'||!match||JSON.parse(row.channels_json).includes(channel)
   ||![b.id,b.from?.aadObjectId,b.from?.id,b.conversation?.id,b.serviceUrl].every(x=>typeof x==='string'&&x.length>0))return null
  url=serviceUrl(b.serviceUrl);code=match[1]
 }catch{return null}
 const hash=await hashToken(code),now=Date.now()
 const guard=`l.token_hash=? AND l.connection_id=? AND l.project_id=? AND l.expires_at>? AND ${sessionSql}
  AND EXISTS(SELECT 1 FROM teammate_teams_consent k WHERE k.project_id=l.project_id AND k.connection_id=l.connection_id AND ${installationSql()})
  AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=l.connection_id AND account=? AND sender=? AND ${liveConnection})`
 const args=[hash,row.id,row.project_id,now,now,row.account,row.sender]
 try{
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT INTO teammate_teams_links(project_id,user_id,connection_id,tenant_id,app_id,aad_object_id,provider_user,personal_conversation,service_url,activity_id,verified_at)
    SELECT l.project_id,l.user_id,l.connection_id,?,?,?,?,?,?,?,? FROM teammate_teams_codes l WHERE ${guard}
    ON CONFLICT(project_id,user_id) DO UPDATE SET connection_id=excluded.connection_id,tenant_id=excluded.tenant_id,app_id=excluded.app_id,aad_object_id=excluded.aad_object_id,provider_user=excluded.provider_user,personal_conversation=excluded.personal_conversation,service_url=excluded.service_url,activity_id=excluded.activity_id,verified_at=excluded.verified_at`)
    .bind(row.account,row.sender,b.from.aadObjectId,b.from.id,b.conversation.id,url,b.id,now,...args),
   auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'teammate_teams.link_verified',actor:{type:'system'},source:'system',target:{type:'support_channel',id:row.id}},now,{sql:`EXISTS(SELECT 1 FROM teammate_teams_codes l WHERE ${guard})`,params:args}),
   env.DB.prepare('DELETE FROM teammate_teams_codes WHERE token_hash=? AND connection_id=?').bind(hash,row.id)
  ])
  if(!results[0].meta.changes)throw new HTTPException(403,{message:'Personal link expired, used or unavailable; create a new code in Settings.'})
 }catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(409,{message:'This Teams member is already linked to a teammate.'})}
 return {linked:true}
}
