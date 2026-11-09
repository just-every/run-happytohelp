import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {filterColumn} from './filters'
export interface TicketSort {field:string;direction:'asc'|'desc'}
export function parseSort(value:unknown):TicketSort[]{
 if(!Array.isArray(value)||value.length>5)throw new HTTPException(400,{message:'Sort must contain at most five fields'})
 return value.map(item=>{
  if(!item||typeof item!=='object'||typeof item.field!=='string'||!['asc','desc'].includes(item.direction))throw new HTTPException(400,{message:'Invalid sort'})
  return {field:item.field,direction:item.direction}
 })
}
/** The ORDER BY of a sort, and each of its expressions with its direction and bound values (the inbox orders
 * candidates by the same expressions). */
export async function compileSort(env:Env,actor:Actor,project:string|undefined,sort:TicketSort[]){
 const clauses:string[]=[],params:unknown[]=[],parts:{sql:string;direction:'asc'|'desc';params:unknown[]}[]=[]
 for(const item of sort){
  const col=await filterColumn(env,actor,project,item.field)
  let sql=col.sql
  if(item.field==='priority')sql="CASE c.priority WHEN 'low' THEN 0 WHEN 'normal' THEN 1 WHEN 'high' THEN 2 WHEN 'urgent' THEN 3 END"
  if(item.field==='status_category')sql="CASE c.status_category WHEN 'new' THEN 0 WHEN 'open' THEN 1 WHEN 'pending' THEN 2 WHEN 'on_hold' THEN 3 WHEN 'solved' THEN 4 WHEN 'closed' THEN 5 END"
  if(col.kind==='number')sql=`CAST(${sql} AS REAL)`
  clauses.push(`${sql} ${item.direction.toUpperCase()}`);params.push(...col.params);parts.push({sql,direction:item.direction,params:col.params})
 }
 clauses.push(sort.length?'c.id DESC':'coalesce((SELECT created_at FROM messages WHERE id=c.last_message_id),c.updated_at) DESC,c.id DESC')
 return {sql:clauses.join(','),params,parts}
}
