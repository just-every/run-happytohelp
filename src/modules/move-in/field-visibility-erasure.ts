import type {Env} from '../../platform/env'
import {fieldVisibility,fieldSourceState,fieldSourceSnapshot} from '../forms/source-eligibility'

/** Erasure severs ownership and every source identifier, retaining one boolean
 * about the surviving definition. No person, source label or timestamp remains. */
export async function fieldVisibilityErasure(env:Pick<Env,'DB'>,projectId:string,jobs:string[]){
 if(!jobs.length)return []
 const fields=(await fieldVisibility(env,projectId)).filter(field=>JSON.parse(fieldSourceSnapshot(field)!)?.[0]==='zendesk')
 if(!fields.length)return []
 const expected=JSON.stringify(fields.map(field=>({id:field.id,source:fieldSourceSnapshot(field),visible:field.form_eligible===1})))
 return [env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT NOT EXISTS(SELECT 1 FROM json_each(?1) expected JOIN ticket_fields f ON f.project_id=?2 AND f.id=json_extract(expected.value,'$.id') WHERE (${fieldSourceState}) IS NOT json_extract(expected.value,'$.source'))`).bind(expected,projectId),
  env.DB.prepare(`UPDATE move_in_origins SET source_id='',revision='erased-visibility',source_json=json_object('visible_in_portal',json(CASE WHEN json_extract(expected.value,'$.visible') THEN 'true' ELSE 'false' END))
   FROM json_each(?1) expected WHERE project_id=?2 AND target_kind='field' AND target_id=json_extract(expected.value,'$.id')
   AND EXISTS(SELECT 1 FROM ik_provenance p WHERE p.destination=?2 AND p.target_kind='field' AND p.target_id=move_in_origins.target_id AND p.reversed=0 AND p.job_id IN (SELECT value FROM json_each(?3)))`).bind(expected,projectId,JSON.stringify(jobs))]
}
