import type {Env} from '../../../platform/env'
import {rehearsalPredicate} from '../authority'
import {grantRef,reject,type RehearsalGrant} from '../types'
import type {PullRow} from '../../move-in/zendesk-source/pull-store'
import {enqueueRun,getRun,settleLost,type AttachmentRun} from '../../move-in/zendesk-attachments/store'

export const attachmentId=(pull:PullRow)=>pull.id+':attachments'
export async function startAttachments(env:Env,g:RehearsalGrant,pull:PullRow){
 if(pull.state!=='applied'||pull.error)reject('zendesk_pull_not_applied')
 const id=attachmentId(pull),prior=await getRun(env,id)
 if(prior)return prior
 const a=rehearsalPredicate(grantRef(g),g.zendesk_project_id,'zendesk'),now=Date.now()
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql})`).bind(...a.params),
  env.DB.prepare("INSERT INTO move_in_zendesk_attachment_pulls(id,project_id,actor_id,session_hash,subdomain,state,created_at,updated_at,authority_mode,rehearsal_id,rehearsal_generation) VALUES(?,?,?,'',?,'running',?,?,'rehearsal',?,?) ON CONFLICT(id) DO NOTHING").bind(id,g.zendesk_project_id,g.owner_id,g.zendesk_subdomain,now,now,g.id,g.generation),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 await enqueueRun(env,{id,project_id:g.zendesk_project_id})
 return (await getRun(env,id))!
}
export async function resumeAttachments(env:Env,g:RehearsalGrant,pull:PullRow){
 const found=await getRun(env,attachmentId(pull));if(!found)reject('attachments_not_started')
 const run=await settleLost(env,found)
 if(run.state!=='running')return run
 if(!run.error)reject('copy_busy')
 if(/reconnect|connection_changed|authority_revoked/.test(run.error))reject('zendesk_dependency_stopped')
 const a=rehearsalPredicate(grantRef(g),g.zendesk_project_id,'zendesk')
 await env.DB.batch([env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql})`).bind(...a.params),env.DB.prepare('UPDATE move_in_zendesk_attachment_pulls SET error=NULL,next_at=0,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=?').bind(Date.now(),run.id,run.version),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 await enqueueRun(env,run)
 return (await getRun(env,run.id)) as AttachmentRun
}
