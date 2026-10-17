import {invalid,object} from '../tickets/model'
export interface Condition {field:string;op:'eq'|'neq'|'in'|'not_in'|'exists'|'gte'|'lte'|'contains';value?:unknown}
export interface Conditions {all:Condition[];any:Condition[]}
const fields=['subject','status_id','status_category','priority','channel','brand_id','group_id','assigned_to','requester_id','tags','language','account','plan','form_id']
export function checkedConditions(value:unknown):Conditions{
 const input=object(value??{}),result:Conditions={all:[],any:[]}
 if(Object.keys(input).some(k=>!['all','any'].includes(k)))invalid('Unknown condition group')
 for(const key of ['all','any'] as const){const list=input[key]??[];if(!Array.isArray(list)||list.length>30)invalid('Use at most 30 conditions per group')
  result[key]=list.map(raw=>{const c=object(raw);if(typeof c.field!=='string'||(!fields.includes(c.field)&&!/^field:[a-zA-Z0-9_-]{1,200}$/.test(c.field)))invalid('Unknown condition field');if(!['eq','neq','in','not_in','exists','gte','lte','contains'].includes(c.op))invalid('Unknown condition operator');if(['in','not_in'].includes(c.op)&&(!Array.isArray(c.value)||c.value.length>100))invalid('Membership conditions need a list');if(['gte','lte'].includes(c.op)&&typeof c.value!=='number')invalid('Comparison needs a number');if(c.op==='contains'&&(typeof c.value!=='string'||!c.value||c.value.length>1000))invalid('Text matching needs text up to 1000 characters');if(c.op!=='exists'&&c.value===undefined)invalid('Condition needs a value');return {field:c.field,op:c.op,...(c.value===undefined?{}:{value:c.value})} as Condition})
 }
 return result
}
function equal(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b)}
export function matchesCondition(ticket:any,c:Condition){
 const value=c.field.startsWith('field:')?ticket.fields?.[c.field.slice(6)]:ticket[c.field]
 const includes=(want:unknown)=>equal(value,want)||Array.isArray(value)&&value.some(v=>equal(v,want))
 switch(c.op){case 'contains':return typeof value==='string'&&typeof c.value==='string'&&value.toLocaleLowerCase('en-US').includes(c.value.toLocaleLowerCase('en-US'));case 'eq':return includes(c.value);case 'neq':return !includes(c.value);case 'in':return (c.value as unknown[]).some(includes);case 'not_in':return !(c.value as unknown[]).some(includes);case 'exists':return value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length>0);case 'gte':return typeof value==='number'&&value>=(c.value as number);case 'lte':return typeof value==='number'&&value<=(c.value as number)}
}
export function evaluateConditions(ticket:any,conditions:Conditions){
 const all=conditions.all.map(c=>({field:c.field,op:c.op,matched:matchesCondition(ticket,c)})),any=conditions.any.map(c=>({field:c.field,op:c.op,matched:matchesCondition(ticket,c)}))
 return {matched:all.every(c=>c.matched)&&(!any.length||any.some(c=>c.matched)),explanation:{all,any}}
}
/** SQL for the `all` conditions on plain ticket columns, so a scan reads only the
 * tickets they can match. The full evaluation still runs on every ticket read. */
const columns=['status_id','status_category','priority','channel','brand_id','group_id','assigned_to']
export function columnPrefilter(conditions:Conditions,alias='c'){
 const sql:string[]=[],params:unknown[]=[]
 for(const c of conditions.all){
  if(!columns.includes(c.field))continue
  if(c.op==='eq'&&typeof c.value==='string'){sql.push(`${alias}.${c.field}=?`);params.push(c.value)}
  if(c.op==='in'&&Array.isArray(c.value)&&c.value.length&&c.value.every(v=>typeof v==='string')){sql.push(`${alias}.${c.field} IN (${c.value.map(()=>'?').join(',')})`);params.push(...c.value)}
 }
 return {sql:sql.map(s=>' AND '+s).join(''),params}
}
