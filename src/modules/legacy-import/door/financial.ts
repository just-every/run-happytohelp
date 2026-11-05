import {Buffer} from 'node:buffer'
import type {D1Sql} from '../../import-kit/src/d1/types'
import type {TargetEffect} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {keys,quote,type LegacyTable} from './schema'
import type {LegacyValue} from './targets'

/** Historical values and unresolved external outcomes never become catch-up
 * replacements. Contact erasure and journaled whole-import Undo stay separate. */
export const immutableFinancial=(table:LegacyTable)=>['billing_ledger','billing_usage_history','billing_operations','legacy_door_holds'].includes(table)

/** Apply-only predicates also fence approvals saved by the previous reader.
 * The ordinary kit Undo keeps its exact, guarded prior-image restoration. */
export function immutableFinancialGuards(effects:TargetEffect[]):D1Sql[]{
 const groups=new Map<LegacyTable,LegacyValue[]>()
 for(const effect of effects){const value=effect.value as unknown as LegacyValue;if(!immutableFinancial(value.table))continue;const group=groups.get(value.table)??[];group.push(value);groups.set(value.table,group)}
 const guards:D1Sql[]=[]
 for(const [table,values] of groups){
  let page:LegacyValue['row'][]=[],bytes=2
  const flush=()=>{if(!page.length)return;const names=values[0].columns;guards.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) proposed JOIN ${quote(table)} native ON ${keys[table].map(key=>`native.${quote(key)} IS json_extract(proposed.value,'$."${key}"')`).join(' AND ')} WHERE NOT (${names.map(name=>`native.${quote(name)} IS json_extract(proposed.value,'$."${name}"')`).join(' AND ')}))`,params:[canonicalJson(page)]});page=[];bytes=2}
  for(const value of values){const size=Buffer.byteLength(canonicalJson(value.row))+1;if(page.length&&bytes+size>512*1024)flush();page.push(value.row);bytes+=size}flush()
 }
 return guards
}
