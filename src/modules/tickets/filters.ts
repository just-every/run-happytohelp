import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {fieldAllowed} from './model'

export interface TicketFilter {field:string;operator:string;value?:unknown}
export interface FilterColumn {sql:string;params:unknown[];kind:'text'|'number'|'boolean'|'array';options?:unknown[]}
const columns:Record<string,FilterColumn['kind']>={id:'text',status_id:'text',status_category:'text',subject:'text',priority:'text',channel:'text',brand_id:'text',group_id:'text',requester_id:'text',submitter_id:'text',submitter_type:'text',assigned_to:'text',created_at:'number',updated_at:'number',ticket_version:'number'}
const fail=(message:string):never=>{throw new HTTPException(400,{message})}
export function parseFilters(value:unknown):TicketFilter[]{
 if(!Array.isArray(value)||value.length>30)fail('Filters must be a list of at most 30 conditions')
 return (value as unknown[]).map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Invalid filter')
  const f=raw as TicketFilter
  if(typeof f.field!=='string'||f.field.length>160||!['eq','ne','in','not_in','contains','gt','gte','lt','lte','is_empty','is_not_empty'].includes(f.operator))fail('Invalid filter field or operator')
  return {field:f.field,operator:f.operator,...('value' in f?{value:f.value}:{})}
 })
}
export function queryJSON(value:string|undefined,label:string):unknown{
 if(!value)return undefined
 if(value.length>20000)fail(`${label} is too long`)
 try{return JSON.parse(value)}catch{return fail(`Invalid ${label} JSON`)}
}
/** A ticket's tag ids: its own links through their primary key (in tag order, as before), never the workspace's.
 * The inbox keeps the same value on each inbox entry (migration 312, `inbox_entries.tags_key`). */
export const tagsSql='(SELECT json_group_array(ct.tag_id) FROM conversation_tags ct WHERE +ct.project_id=c.project_id AND ct.conversation_id=c.id)'
export async function filterColumn(env:Env,actor:Actor,projectId:string|undefined,field:string):Promise<FilterColumn>{
 if(Object.hasOwn(columns,field))return {sql:`c.${field}`,params:[],kind:columns[field]}
 if(field==='tags')return {sql:tagsSql,params:[],kind:'array'}
 if(!field.startsWith('custom:')||!projectId)fail('Unknown field, or a workspace is required for this field')
 const id=field.slice(7),row=await env.DB.prepare('SELECT type,read_roles_json,options_json FROM ticket_fields WHERE project_id=? AND id=?').bind(projectId,id).first<{type:string;read_roles_json:string;options_json:string}>()
 if(!row)fail('Custom field is unavailable')
 const access=await memberAccess(env.DB,projectId!,actor.id)
 if(!access||!fieldAllowed(row,access))throw new HTTPException(403,{message:'Your role cannot read this field'})
 const kind=['number','decimal'].includes(row!.type)?'number':row!.type==='checkbox'?'boolean':row!.type==='multiselect'?'array':'text'
 return {sql:`(SELECT json_extract(v.value_json,'$') FROM ticket_field_values v WHERE v.project_id=c.project_id AND v.conversation_id=c.id AND v.field_id=?)`,params:[id],kind}
}
function scalar(value:unknown,kind:FilterColumn['kind']):string|number|boolean{
 if(kind==='number'){if(typeof value!=='number'||!Number.isFinite(value))fail('A numeric field needs a finite number');return value as number}
 if(kind==='boolean'){if(typeof value!=='boolean')fail('A checkbox filter needs true or false');return value as boolean}
 if(typeof value!=='string'||value.length>2000)fail('A field filter needs text of at most 2000 characters')
 return value as string
}
/** One compiled condition: its field, operator, the values a list field is tested against, and its bound SQL. */
export interface FilterPart {field:string;operator:string;values?:string[];sql:string;params:unknown[]}
/** Bound SQL only: field names and operators never enter SQL without classification. */
export async function compileFilters(env:Env,actor:Actor,projectId:string|undefined,filters:TicketFilter[]){
 const conditions:string[]=[],params:unknown[]=[],parts:FilterPart[]=[]
 for(const f of filters){
  const before=params.length,values=await compileFilter(env,actor,projectId,f,conditions,params)
  parts.push({field:f.field,operator:f.operator,...(values?{values}:{}),sql:conditions[conditions.length-1],params:params.slice(before)})
 }
 return {conditions,params,parts}
}
async function compileFilter(env:Env,actor:Actor,projectId:string|undefined,f:TicketFilter,conditions:string[],params:unknown[]):Promise<string[]|undefined>{
 const col=await filterColumn(env,actor,projectId,f.field),{sql,kind}=col,op=f.operator
 if(op==='is_empty'||op==='is_not_empty'){
  const empty=`(${sql} IS NULL OR ${sql}=''${kind==='array'?` OR ${sql}='[]'`:''})`
  conditions.push(op==='is_empty'?empty:`NOT ${empty}`);params.push(...col.params,...col.params,...(kind==='array'?col.params:[]));return
 }
 if(kind==='array'){
  if(!['contains','eq','ne','in','not_in'].includes(op))fail('Unsupported operator for a list field')
  const values=['in','not_in'].includes(op)?f.value:[f.value]
  if(!Array.isArray(values)||!values.length||values.length>100)fail('A list filter needs 1–100 values')
  const selected=(values as unknown[]).map(v=>scalar(v,'text')),negative=['ne','not_in'].includes(op)
  conditions.push(`${negative?'NOT ':''}EXISTS(SELECT 1 FROM json_each(coalesce(${sql},'[]')) f WHERE f.value IN (SELECT value FROM json_each(?)))`)
  params.push(...col.params,JSON.stringify(selected));return selected as string[]
 }
 if(op==='in'||op==='not_in'){
  if(!Array.isArray(f.value)||!f.value.length||f.value.length>100)fail('A list filter needs 1–100 values')
  const values=(f.value as unknown[]).map(v=>scalar(v,kind))
  conditions.push(`${sql} ${op==='not_in'?'NOT IN':'IN'} (SELECT value FROM json_each(?))`);params.push(...col.params,JSON.stringify(values));return
 }
 if(f.value===null&&['eq','ne'].includes(op)){conditions.push(`${sql} IS ${op==='ne'?'NOT ':''}NULL`);params.push(...col.params);return}
 const value=scalar(f.value,kind)
 if(op==='contains'){
  if(kind!=='text')fail('Contains is only available for text or list fields')
  conditions.push(`instr(lower(coalesce(${sql},'')),lower(?))>0`)
 }else{
  const operation:Record<string,string>={eq:'=',ne:'!=',gt:'>',gte:'>=',lt:'<',lte:'<='}
  if(!operation[op]||kind==='boolean'&&!['eq','ne'].includes(op))fail('Unsupported filter operator')
  conditions.push(`${kind==='number'?`CAST(${sql} AS REAL)`:sql}${operation[op]}?`)
 }
 params.push(...col.params,typeof value==='boolean'?Number(value):value)
}
