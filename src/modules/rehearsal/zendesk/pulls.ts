import type {Env} from '../../../platform/env'
import {canonicalJson,sha256} from '../../import-kit/src/d1/index'
import {assertRehearsal,rehearsalPredicate} from '../authority'
import {rehearsalAudit} from '../audit'
import {beginCopy,copyDay} from '../copies'
import {grantRef,reject,type RehearsalGrant} from '../types'
import {getPull,type PullRow} from '../../move-in/zendesk-source/pull-store'
import {enqueuePull} from '../../move-in/zendesk-source/notify'
import {pullBatches} from '../../move-in/zendesk-source/approval'
import {scopedWork} from './work'
import {enqueue,getRun} from '../../move-in/service'

const normalized=(value:unknown)=>{try{const cursor=typeof value==='string'?JSON.parse(value):value;if(!cursor||typeof cursor!=='object'||Array.isArray(cursor))reject('zendesk_cursor_required',400);return canonicalJson(cursor)}catch{reject('zendesk_cursor_required',400)}}
export const dailyPullId=(g:RehearsalGrant,day:string)=>'rehearsal-'+sha256(`${g.id}:${g.generation}:${day}:zendesk`)
export async function scopedPull(env:Env,g:RehearsalGrant,id:string){
 const pull=await getPull(env,id)
 if(!pull||pull.authority_mode!=='rehearsal'||pull.rehearsal_id!==g.id||pull.rehearsal_generation!==g.generation||pull.project_id!==g.zendesk_project_id||pull.subdomain!==g.zendesk_subdomain)reject('copy_not_found',404)
 return pull
}
export async function startPull(env:Env,g:RehearsalGrant,body:{day?:unknown;cursor?:unknown}){
 const day=copyDay(body.day),cursor=normalized(body.cursor),id=dailyPullId(g,day),prior=await getPull(env,id)
 if(prior){const pull=await scopedPull(env,g,id);if(normalized(pull.start_json)!==cursor)reject('zendesk_cursor_changed');return pull}
 if(cursor!==normalized(g.zendesk_cursor_json))reject('zendesk_cursor_changed')
 const base=await getPull(env,g.zendesk_base_pull_id)
 if(!base||base.project_id!==g.zendesk_project_id||base.subdomain!==g.zendesk_subdomain||base.state!=='applied'||base.error||normalized(base.resume_json)!==cursor)reject('zendesk_base_changed')
 const invalid=await env.DB.prepare("SELECT 1 FROM move_in_zendesk_pull_runs p JOIN move_in_runs r ON r.id=p.run_id WHERE p.pull_id=? AND NOT (r.state='completed' OR r.state='ready' AND r.total=0) LIMIT 1").bind(base.id).first()
 if(invalid)reject('zendesk_base_changed')
 await beginCopy(env,g,day,'zendesk',id)
 const a=rehearsalPredicate(grantRef(g),g.zendesk_project_id,'zendesk'),now=Date.now(),counts=JSON.stringify({rehearsalWorkBefore:await scopedWork(env,g.zendesk_project_id)})
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql}) AND EXISTS(SELECT 1 FROM rehearsal_grants WHERE id=? AND generation=? AND active_day=? AND zendesk_cursor_json=?)`).bind(...a.params,g.id,g.generation,day,g.zendesk_cursor_json),
  env.DB.prepare("INSERT INTO move_in_zendesk_pulls(id,project_id,actor_id,session_hash,subdomain,state,phase,start_json,counts_json,created_at,updated_at,authority_mode,rehearsal_id,rehearsal_generation) VALUES(?,?,?,'',?,'pulling','fields',?,?,?,?,'rehearsal',?,?) ON CONFLICT(id) DO NOTHING").bind(id,g.zendesk_project_id,g.owner_id,g.zendesk_subdomain,g.zendesk_cursor_json,counts,now,now,g.id,g.generation),
  rehearsalAudit(env.DB,g,'zendesk_copy_started',{day,pull:id}),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 await enqueuePull(env,{id,project_id:g.zendesk_project_id})
 return (await getPull(env,id))!
}
/** A live grant may continue an interrupted delivery, but cannot reconnect or replan an approved review. */
export async function resumePull(env:Env,g:RehearsalGrant,pull:PullRow){
 await assertRehearsal(env,grantRef(g),g.zendesk_project_id,'zendesk')
 if(['applied','abandoned'].includes(pull.state))reject('copy_finished')
 if(pull.error&&/reconnect|connection_changed|authority_revoked/.test(pull.error))reject('zendesk_dependency_stopped')
 if(pull.lease_until&&pull.lease_until>Date.now())reject('copy_busy')
 const a=rehearsalPredicate(grantRef(g),g.zendesk_project_id,'zendesk')
 for(const batch of await pullBatches(env,pull.id)){
  if(!['uploaded','parsing','planning','applying'].includes(batch.state))continue
  const run=(await getRun(env,batch.run_id))!
  if(run.authority_mode!=='rehearsal'||run.rehearsal_id!==g.id||run.rehearsal_generation!==g.generation)reject('zendesk_child_authority_changed')
  // A live child delivery retains its checkpoint; only lost/stopped work is handed on.
  if(!run.error&&Date.now()-run.updated_at<6*60*1000)continue
  await env.DB.batch([env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql})`).bind(...a.params),env.DB.prepare('UPDATE move_in_runs SET error=NULL,updated_at=MAX(?,updated_at+1) WHERE id=? AND updated_at=?').bind(Date.now(),run.id,run.updated_at),env.DB.prepare('DELETE FROM ik_d1_assertions')])
  await enqueue(env,run)
 }
 await env.DB.batch([env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql})`).bind(...a.params),env.DB.prepare('UPDATE move_in_zendesk_pulls SET error=NULL,next_at=0,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=?').bind(Date.now(),pull.id,pull.version),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 await enqueuePull(env,pull)
}
