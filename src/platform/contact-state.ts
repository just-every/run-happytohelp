import {realContactSql} from '../modules/customers/no-requester'
/** Rechecked by native writes: a request admitted before erasure cannot put
 * identity or stale metadata back after the erasure fence. */
export const contactWritableSql=(alias='')=>`${realContactSql(alias)} AND coalesce(json_extract(${alias?alias+'.':''}metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(${alias?alias+'.':''}metadata_json,'$.is_erased'),0)!=1`

export const contactWritable=contactWritableSql()
