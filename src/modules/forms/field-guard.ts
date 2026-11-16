import {publicFieldReadSql} from './field-access'
import type {StoredField} from './types'
import {fieldSourceState,fieldSourceSnapshot} from './source-eligibility'
/** One JSON parameter keeps a 50-field form below D1's per-statement bind limit. */
export function formFieldGuard(projectId:string,fields:StoredField[]){
 return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN ticket_fields f ON f.project_id=? AND f.id=json_extract(expected.value,'$.id') WHERE f.id IS NULL OR f.updated_at<>json_extract(expected.value,'$.updatedAt') OR NOT ${publicFieldReadSql('f')} OR (${fieldSourceState}) IS NOT json_extract(expected.value,'$.source'))`,args:[JSON.stringify(fields.map(f=>({id:f.id,updatedAt:f.updated_at,source:fieldSourceSnapshot(f)}))),projectId]}
}
