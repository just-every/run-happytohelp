import type { D1ImportContext, D1Sql } from '../import-kit/src/d1/index'
import type { Env } from '../../platform/env'
import { MAPPING_VERSION, LIMITS, type Run } from './types'
import { nativeTargets } from './targets'
import {rehearsalPredicate,assertRehearsal} from '../rehearsal/authority'
import type {DurableAuthority} from './types'
import {undoReferencesClear} from './undo-references'
// The route/run chooses the destination. The session must still be valid in its
// own selected workspace, independently of current authority in the destination.
export function authority(run:Pick<Run,'project_id'|'actor_id'|'session_hash'> & DurableAuthority & {id?:string}):D1Sql {
 if(run.authority_mode==='rehearsal'){
  if(!run.rehearsal_id||!Number.isSafeInteger(run.rehearsal_generation))return {sql:'0',params:[]}
  const a=rehearsalPredicate({rehearsal_id:run.rehearsal_id,rehearsal_generation:run.rehearsal_generation!},run.project_id,'zendesk')
  return {sql:`EXISTS(${a.sql}) AND NOT EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND (state IN ('erased','undoing','undone')))`,params:[...a.params!,run.id??'']}
 }
 return {
 sql:`NOT EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state='erased') AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.actor_id JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=? JOIN projects p ON p.id=m.project_id WHERE s.token_hash=? AND s.actor_id=? AND s.revoked_at IS NULL AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER) AND m.role IN ('owner','admin') AND ((s.project_id IS NULL AND s.role='operator') OR (s.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM memberships sm JOIN projects sp ON sp.id=sm.project_id WHERE sm.project_id=s.project_id AND sm.user_id=s.actor_id AND sm.role=s.role) AND NOT EXISTS(SELECT 1 FROM project_settings ss WHERE ss.project_id=s.project_id AND json_extract(ss.settings_json,'$.deleted_at') IS NOT NULL))) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))`,params:[run.id??'',run.project_id,run.session_hash,run.actor_id]}}
export function importContext(env:Env,run:Run,fence?:D1Sql):D1ImportContext{return {destination:run.project_id,namespace:run.vendor,mappingVersion:MAPPING_VERSION,storage:{database:env.DB,targets:nativeTargets},authorization:{principalId:run.actor_id,predicate:(_action,destination)=>{if(destination!==run.project_id)throw new Error('IMPORT_DESTINATION_MISMATCH');let a=authority(run);if(fence)a={sql:`(${a.sql}) AND (${fence.sql})`,params:[...a.params!,...fence.params!]};if(_action==='undo'||_action==='rollback'){if(run.authority_mode==='rehearsal')return {sql:'0',params:[]};const refs=undoReferencesClear(run,run.kit_job_id??undefined);return {sql:`(${a.sql}) AND (${refs.sql})`,params:[...a.params!,...refs.params!]}}return a}},batchSize:LIMITS.applyBatch,maxBatches:1,operationKey:run.id}}
export async function assertAuthority(env:Env,run:Run){if(run.authority_mode==='rehearsal')await assertRehearsal(env,{rehearsal_id:run.rehearsal_id!,rehearsal_generation:run.rehearsal_generation!},run.project_id,'zendesk');const a=authority(run),row:any=await env.DB.prepare(`SELECT (${a.sql}) AS allowed`).bind(...a.params!).first();if(!row?.allowed)throw new Error('import_authority_revoked')}
export async function guarded(env:Env,run:Run,statements:D1PreparedStatement[]){const a=authority(run),guard=()=>env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${a.sql}) THEN 1 ELSE 0 END`).bind(...a.params!);return env.DB.batch([guard(),...statements,guard(),env.DB.prepare('DELETE FROM ik_d1_assertions')])}
