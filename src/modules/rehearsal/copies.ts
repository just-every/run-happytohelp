import type {Env} from '../../platform/env'
import {dbNow} from '../legacy-import/lease'
import {assertRehearsal,rehearsalPredicate} from './authority'
import {rehearsalAudit} from './audit'
import {grantRef,reject,type RehearsalGrant} from './types'
export function copyDay(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))reject('invalid_copy_day',400)
 const at=Date.parse(value+'T00:00:00Z')
 if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==value||value>new Date().toISOString().slice(0,10))reject('invalid_copy_day',400)
 return value
}
export async function beginCopy(env:Env,g:RehearsalGrant,day:string,kind:'legacy'|'zendesk',identity:string){
 copyDay(day);if(g.active_day&&g.active_day!==day)reject('previous_copy_unverified');await assertRehearsal(env,grantRef(g),kind==='legacy'?g.legacy_project_id:g.zendesk_project_id,kind)
 const column=kind==='legacy'?'legacy_sha':'zendesk_pull_id',a=rehearsalPredicate(grantRef(g),kind==='legacy'?g.legacy_project_id:g.zendesk_project_id,kind)
 const prior=await env.DB.prepare(`SELECT ${column} identity FROM rehearsal_copies WHERE grant_id=? AND generation=? AND day=?`).bind(g.id,g.generation,day).first<{identity:string|null}>()
 if(prior?.identity){if(prior.identity!==identity)reject('copy_identity_conflict');return}
 const last=await env.DB.prepare('SELECT max(day) day FROM rehearsal_copies WHERE grant_id=? AND generation=?').bind(g.id,g.generation).first<{day:string|null}>()
 if(last?.day&&day<last.day)reject('copy_day_regressed')
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql}) AND EXISTS(SELECT 1 FROM rehearsal_grants WHERE id=? AND (active_day IS NULL OR active_day=?))`).bind(...a.params,g.id,day),
  env.DB.prepare(`INSERT INTO rehearsal_copies(grant_id,generation,day,${column},created_at) VALUES(?,?,?,?,${dbNow}) ON CONFLICT(grant_id,generation,day) DO UPDATE SET ${column}=excluded.${column} WHERE rehearsal_copies.${column} IS NULL OR rehearsal_copies.${column}=excluded.${column}`).bind(g.id,g.generation,day,identity),
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM rehearsal_copies WHERE grant_id=? AND generation=? AND day=? AND ${column}=?)`).bind(g.id,g.generation,day,identity),
  env.DB.prepare('UPDATE rehearsal_grants SET active_day=? WHERE id=? AND generation=? AND state=\'active\'').bind(day,g.id,g.generation),env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
export async function verifyCopy(env:Env,g:RehearsalGrant,day:string,kind:'legacy'|'zendesk',identity:string,facts:{watermark?:number;cutoff?:number;watermarkIso?:string;cutoffIso?:string;cursor?:string|Record<string,unknown>}={}){
 await assertRehearsal(env,grantRef(g),kind==='legacy'?g.legacy_project_id:g.zendesk_project_id,kind)
 const column=kind==='legacy'?'legacy_sha':'zendesk_pull_id',a=rehearsalPredicate(grantRef(g),kind==='legacy'?g.legacy_project_id:g.zendesk_project_id,kind)
 const prior=await env.DB.prepare(`SELECT ${kind}_verified verified FROM rehearsal_copies WHERE grant_id=? AND generation=? AND day=? AND ${column}=?`).bind(g.id,g.generation,day,identity).first<{verified:number}>()
 if(!prior)reject('copy_not_found',404)
 if(prior.verified)return
 const proof=kind==='legacy'?"EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE manifest_sha256=? AND rehearsal_id=? AND rehearsal_generation=? AND authority_mode='rehearsal' AND state='complete' AND verified_at IS NOT NULL)":"EXISTS(SELECT 1 FROM move_in_zendesk_pulls WHERE id=? AND rehearsal_id=? AND rehearsal_generation=? AND authority_mode='rehearsal' AND state='applied' AND error IS NULL AND json_extract(counts_json,'$.rehearsalVerification.complete')=1) AND EXISTS(SELECT 1 FROM move_in_zendesk_attachment_pulls WHERE id=?||':attachments' AND state='done' AND error IS NULL)"
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql}) AND ${proof}`).bind(...a.params,identity,g.id,g.generation,...(kind==='zendesk'?[identity]:[])),
  env.DB.prepare(`UPDATE rehearsal_copies SET ${kind}_verified=1 WHERE grant_id=? AND generation=? AND day=? AND ${column}=?`).bind(g.id,g.generation,day,identity),
  ...(kind==='legacy'?[env.DB.prepare("UPDATE rehearsal_copies SET legacy_conflicts=(SELECT count(*) FROM legacy_import_conflicts f JOIN legacy_import_worker_parts p ON p.journal_run_id=f.run_id WHERE p.run_id='legacy-package:'||legacy_sha),legacy_rows=(SELECT coalesce(sum(package_rows-excluded_rows),0) FROM legacy_import_worker_counts WHERE run_id='legacy-package:'||legacy_sha) WHERE grant_id=? AND generation=? AND day=?").bind(g.id,g.generation,day)]:[env.DB.prepare('UPDATE rehearsal_copies SET zendesk_refusals=(SELECT count(*) FROM move_in_zendesk_refusals WHERE pull_id=zendesk_pull_id) WHERE grant_id=? AND generation=? AND day=?').bind(g.id,g.generation,day)]),
  ...(kind==='legacy'&&facts.watermark!==undefined&&facts.cutoff!==undefined?[env.DB.prepare('UPDATE rehearsal_grants SET legacy_watermark=?,legacy_cutoff=?,legacy_watermark_iso=?,legacy_cutoff_iso=? WHERE id=? AND generation=? AND legacy_watermark<=?').bind(facts.watermark,facts.cutoff,facts.watermarkIso??new Date(facts.watermark).toISOString(),facts.cutoffIso??new Date(facts.cutoff).toISOString(),g.id,g.generation,facts.watermark)]:[]),
  ...(kind==='zendesk'&&facts.cursor!==undefined?[env.DB.prepare('UPDATE rehearsal_grants SET zendesk_cursor_json=?,zendesk_base_pull_id=? WHERE id=? AND generation=?').bind(typeof facts.cursor==='string'?facts.cursor:JSON.stringify(facts.cursor),identity,g.id,g.generation)]:[]),
  env.DB.prepare(`UPDATE rehearsal_copies SET verified_at=${dbNow} WHERE grant_id=? AND generation=? AND day=? AND (legacy_verified=1 OR (SELECT legacy_enabled FROM rehearsal_grants WHERE id=grant_id)=0) AND (zendesk_verified=1 OR (SELECT zendesk_enabled FROM rehearsal_grants WHERE id=grant_id)=0)`).bind(g.id,g.generation,day),
  env.DB.prepare('UPDATE rehearsal_grants SET active_day=NULL WHERE id=? AND generation=? AND active_day=? AND EXISTS(SELECT 1 FROM rehearsal_copies WHERE grant_id=? AND generation=? AND day=? AND verified_at IS NOT NULL)').bind(g.id,g.generation,day,g.id,g.generation,day),
  rehearsalAudit(env.DB,g,'copy_verified',{component:kind,day}),env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
