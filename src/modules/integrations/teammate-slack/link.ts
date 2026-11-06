import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {auditStatement} from '../../audit/record'
import {destination} from '../../api-integrations/destinations'
import {installerAuthorized} from './authority'
import {prepareDirectMessage,sendPrepared,slackLookup} from './slack-api'

const codeLifetime=10*60*1000,throttle=60*1000,maxCodeAttempts=5
type Member={id:string;projectId:string}
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
const codeHash=(member:Member,slackUser:string,code:string)=>digest(`teammate-slack-link\n${member.projectId}\n${member.id}\n${slackUser}\n${code}`)
const audit=(env:Env,member:Member,action:string,detail:Record<string,unknown>={})=>auditStatement(env.DB,{projectId:member.projectId,category:'integration',action,actor:{type:'user',id:member.id},source:'dashboard',target:{type:'user',id:member.id},detail})

/** A typed Slack ID proves nothing. The installation's own bot must show that member
 * is in the installation's Slack team, and only a code delivered to that member's
 * own Slack DM, typed back here, proves they control it. */
export async function startLink(env:Env,member:Member,slackUserId:unknown){
 if(typeof slackUserId!=='string'||!/^[UW][A-Z0-9]{2,40}$/.test(slackUserId))throw new HTTPException(400,{message:'Enter your Slack member ID, for example U0123ABCD.'})
 const now=Date.now()
 const consent=await env.DB.prepare('SELECT destination_id FROM teammate_slack_consent WHERE project_id=?').bind(member.projectId).first<{destination_id:string}>()
 if(!consent)throw new HTTPException(409,{message:'An owner or admin has not enabled personal Slack notices.'})
 if(!await installerAuthorized(env,member.projectId,consent.destination_id))throw new HTTPException(409,{message:'The Slack connection needs an administrator to reconnect it.'})
 const recent=await env.DB.prepare("SELECT 1 FROM teammate_slack_links WHERE project_id=? AND user_id=? AND state='pending' AND created_at>?").bind(member.projectId,member.id,now-throttle).first()
 if(recent)throw new HTTPException(429,{message:'A code was just sent. Wait a minute before asking for another.'})
 const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0')
 let team:string,dm:string,token:string
 try{
  token=(await destination(env,member.projectId,consent.destination_id)).secret.token
  if(typeof env.APP_ORIGIN!=='string')throw new Error('unavailable')
  team=(await slackLookup(token,'auth.test')).team_id
  const user=(await slackLookup(token,'users.info',{user:slackUserId})).user
  if(!team||!user||user.team_id!==team||user.is_bot||user.deleted)throw new HTTPException(403,{message:'That Slack member is not part of this Slack workspace.'})
  dm=(await slackLookup(token,'conversations.open',{users:slackUserId})).channel?.id
 }catch(error){
  if(error instanceof HTTPException)throw error
  throw new HTTPException(502,{message:'Slack could not confirm that member. Check the Slack connection and try again.'})
 }
 const saved=await env.DB.batch([
  env.DB.prepare(`INSERT INTO teammate_slack_links(project_id,user_id,destination_id,slack_team_id,slack_user_id,dm_channel,state,code_hash,code_expires_at,code_attempts,created_at,verified_at)
   SELECT ?,?,?,?,?,?,'pending',?,?,0,?,NULL WHERE EXISTS(SELECT 1 FROM teammate_slack_consent WHERE project_id=? AND destination_id=?)
   ON CONFLICT(project_id,user_id) DO UPDATE SET destination_id=excluded.destination_id,slack_team_id=excluded.slack_team_id,slack_user_id=excluded.slack_user_id,dm_channel=excluded.dm_channel,state='pending',code_hash=excluded.code_hash,code_expires_at=excluded.code_expires_at,code_attempts=0,created_at=excluded.created_at,verified_at=NULL`)
   .bind(member.projectId,member.id,consent.destination_id,team,slackUserId,dm,await codeHash(member,slackUserId,code),now+codeLifetime,now,member.projectId,consent.destination_id),
  audit(env,member,'teammate_slack.link_started')
 ])
 if(!saved[0].meta.changes)throw new HTTPException(409,{message:'An owner or admin has not enabled personal Slack notices.'})
 try{
  const sections=[`Your HappyToHelp verification code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`]
  const prepared=await prepareDirectMessage({id:`link:${member.projectId}:${member.id}:${now}`,projectId:member.projectId,destinationId:consent.destination_id,token,channel:dm,summary:'HappyToHelp verification code',sections},now)
  if(prepared.classify(await sendPrepared(prepared),now).kind!=='accepted')throw new Error('not accepted')
 }catch{throw new HTTPException(502,{message:'Slack did not deliver the code. Check the Slack connection and try again.'})}
 return {state:'pending',expires_in_seconds:codeLifetime/1000}
}

export async function verifyLink(env:Env,member:Member,code:unknown){
 if(typeof code!=='string'||!/^\d{8}$/.test(code.trim()))throw new HTTPException(400,{message:'Enter the 8-digit code Slack sent you.'})
 const now=Date.now()
 const link=await env.DB.prepare("SELECT slack_user_id FROM teammate_slack_links WHERE project_id=? AND user_id=? AND state='pending'").bind(member.projectId,member.id).first<{slack_user_id:string}>()
 if(!link)throw new HTTPException(409,{message:'Ask for a new code first.'})
 const attempt=await env.DB.prepare("UPDATE teammate_slack_links SET code_attempts=code_attempts+1 WHERE project_id=? AND user_id=? AND state='pending' AND code_attempts<? AND code_expires_at>?").bind(member.projectId,member.id,maxCodeAttempts,now).run()
 if(!attempt.meta.changes)throw new HTTPException(409,{message:'That code expired or was tried too often. Ask for a new code.'})
 try{
  const done=await env.DB.batch([
   env.DB.prepare("UPDATE teammate_slack_links SET state='verified',verified_at=?,code_hash=NULL,code_expires_at=NULL WHERE project_id=? AND user_id=? AND state='pending' AND code_hash=? AND EXISTS(SELECT 1 FROM teammate_slack_consent k WHERE k.project_id=teammate_slack_links.project_id AND k.destination_id=teammate_slack_links.destination_id)").bind(now,member.projectId,member.id,await codeHash(member,link.slack_user_id,code.trim())),
   auditStatement(env.DB,{projectId:member.projectId,category:'integration',action:'teammate_slack.link_verified',actor:{type:'user',id:member.id},source:'dashboard',target:{type:'user',id:member.id}},now,{sql:"EXISTS(SELECT 1 FROM teammate_slack_links WHERE project_id=? AND user_id=? AND state='verified' AND verified_at=?)",params:[member.projectId,member.id,now]})
  ])
  if(!done[0].meta.changes)throw new HTTPException(400,{message:'That code is not correct.'})
 }catch(error){
  if(error instanceof HTTPException)throw error
  throw new HTTPException(409,{message:'That Slack member is already linked to another teammate.'})
 }
 return {state:'verified'}
}

export async function unlink(env:Env,member:Member){
 await env.DB.batch([env.DB.prepare('DELETE FROM teammate_slack_links WHERE project_id=? AND user_id=?').bind(member.projectId,member.id),audit(env,member,'teammate_slack.unlinked')])
 return {state:'none'}
}
