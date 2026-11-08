import type {Env} from '../../platform/env'
import type {Diagnostic,SourceRecord} from '../import-kit/src/types'
import {LIMITS,recordKey,type Run} from './types'

/** Only one page of raw D1 strings overlaps the parsed records. Duplicate
 * comparison finishes here, so neither its strings nor the result pages stay
 * live while mapping effects and writing the reviewed children. */
export async function reviewRecords(env:Env,run:Run){
 const records:SourceRecord[]=[],diagnostics:Diagnostic[]=JSON.parse(run.diagnostics_json),seen=new Map<string,string>(),conflicts=new Set<string>()
 let ordinal=-1,total=0
 while(true){
  const rows=(await env.DB.prepare('SELECT ordinal,record_json,serialized FROM move_in_records WHERE run_id=? AND ordinal>? ORDER BY ordinal LIMIT ?').bind(run.id,ordinal,LIMITS.parseBatch).all<{ordinal:number;record_json:string;serialized:string}>()).results
  for(const row of rows){
   const record:SourceRecord=JSON.parse(row.record_json),key=recordKey(record)
   if(seen.has(key)&&(run.vendor==='intercom'||seen.get(key)!==row.serialized)){
    conflicts.add(key)
    diagnostics.push({severity:'error',code:'conflicting_duplicate_id',message:`Conflicting ${record.kind} ID ${record.sourceId}`,kind:record.kind,sourceId:record.sourceId,location:record.location})
   }else if(!seen.has(key)){seen.set(key,row.serialized);records.push(record)}
  }
  total+=rows.length
  if(rows.length<LIMITS.parseBatch)break
  ordinal=rows[rows.length-1].ordinal
 }
 return {records,diagnostics,conflicts,duplicates:total-records.length}
}
