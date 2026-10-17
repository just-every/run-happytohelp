import type {StoredField} from './types'
/** One JSON parameter keeps a 50-field form below D1's per-statement bind limit. */
export function formFieldGuard(projectId:string,fields:StoredField[]){
 return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN ticket_fields f ON f.project_id=? AND f.id=json_extract(expected.value,'$.id') WHERE f.id IS NULL OR f.updated_at<>json_extract(expected.value,'$.updatedAt') OR f.read_roles_json<>'[]' OR f.write_roles_json<>'[]')`,args:[JSON.stringify(fields.map(f=>({id:f.id,updatedAt:f.updated_at}))),projectId]}
}
