import {csv} from './csv'
import type {TeamReport} from './team-read'

/** Long-form CSV keeps every screen metric, grouping, denominator and rule,
 * including nulls, without fixed group limits or spreadsheet formula execution. */
export function teamReportCSV(report:TeamReport){
 const rows:unknown[][]=[['Metric path','Value']]
 const visit=(path:string,value:unknown)=>{
  if(value!==null&&typeof value==='object'){
   const entries=Object.entries(value)
   if(!entries.length)rows.push([path,Array.isArray(value)?'[]':'{}'])
   for(const [key,child] of entries)visit(path?`${path}.${key}`:key,child)
  }else rows.push([path,value===null?'null':value])
 }
 visit('',report)
 return csv(rows)
}
