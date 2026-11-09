import type {Clause} from './inbox-entries'
import {tagSet,talliedCondition,type Condition} from './inbox-conditions'
import {compareValues} from './inbox-order'

/** The condition families migration 319 keeps derived rows for (src/modules/management/README.md, "Inbox reads at
 * scale"): tag sets, one custom field, one time bound and subject terms, besides the conditions the tallies'
 * dimensions answer. Anything else keeps the reads of migration 313. */
export interface TagCondition {values:string[];negative:boolean}
export interface FieldCondition {condition:Condition;field:string;mode:'eq'|'real'|'in'|'ne'|'ne-real'|'not_in'|'null'|'nonnull'|'empty'|'nonempty';value?:unknown}
export interface TimeCondition {condition:Condition;column:'created_at'|'updated_at';operator:'lt'|'lte'|'gt'|'gte';at:number}
export interface Families {tallied:Condition[];tags:TagCondition[];fields:FieldCondition[];times:TimeCondition[];subjects:Condition[];other:Condition[]}

function field(condition:Condition):FieldCondition|undefined{
 const {operator,kind,params}=condition
 if(!condition.field?.startsWith('custom:')||kind==='array'||!kind)return undefined
 const id=String(params[0]),value=params[1],number=kind==='number'
 if(operator==='eq')return params.length===1?{condition,field:id,mode:'null'}:{condition,field:id,mode:number?'real':'eq',value}
 if(operator==='ne')return params.length===1?{condition,field:id,mode:'nonnull'}:{condition,field:id,mode:number?'ne-real':'ne',value}
 if(operator==='in'||operator==='not_in')return {condition,field:id,mode:operator,value}
 if(operator==='is_empty')return {condition,field:id,mode:'empty'}
 if(operator==='is_not_empty')return {condition,field:id,mode:'nonempty'}
 return undefined
}
function time(condition:Condition):TimeCondition|undefined{
 const {field:column,operator,params}=condition
 if((column!=='created_at'&&column!=='updated_at')||!['lt','lte','gt','gte'].includes(operator!)||typeof params[0]!=='number')return undefined
 return {condition,column,operator:operator as TimeCondition['operator'],at:params[0]}
}
// A subject term of three or more characters is a phrase of the trigram index; shorter terms and a NUL keep 313's reads.
const subject=(condition:Condition)=>condition.field==='subject'&&condition.operator==='contains'&&typeof condition.params[0]==='string'&&[...condition.params[0]].length>=3&&!condition.params[0].includes('\0')

export function families(conditions:Condition[],tag?:string):Families{
 const result:Families={tallied:[],tags:tag?[{values:[tag],negative:false}]:[],fields:[],times:[],subjects:[],other:[]}
 for(const condition of conditions){
  const set=tagSet(condition),custom=field(condition),bound=time(condition)
  if(set)result.tags.push(set)
  else if(talliedCondition(condition))result.tallied.push(condition)
  else if(custom)result.fields.push(custom)
  else if(bound)result.times.push(bound)
  else if(subject(condition))result.subjects.push(condition)
  else result.other.push(condition)
 }
 return result
}

/** A tags condition over a row's tags_key (alias `x`), exactly as tickets/filters.ts tests the ticket's tags: the
 * row holds one of the values (or none of them). Each value is found as its own JSON-quoted element between
 * commas, so it reads no json_each rows. */
export function tagClause(x:string,set:TagCondition):Clause{
 const key=`coalesce(${x}.tags_key,'[]')`,listed=`','||substr(${key},2,length(${key})-2)||','`
 const any=set.values.map(()=>`instr(${listed},','||json_quote(?)||',')>0`).join(' OR ')
 return {sql:set.negative?`NOT (${any})`:`(${any})`,params:[...set.values]}
}

/** The distinct tags a request names, in tag-set order (the order migration 319 keys tag sets by), and for each
 * subset of them the coefficient its count of entries holding that subset contributes to the matches: entries
 * whose tags among these are exactly X match when X satisfies every condition, and the count of entries whose
 * tags among these are exactly X is the alternating sum over the subsets containing X. Subset 0 is every entry. */
export function tagFormula(sets:TagCondition[]){
 const tags=[...new Set(sets.flatMap(set=>set.values))].sort(compareValues)
 if(tags.length>4)return undefined
 const masks=sets.map(set=>({mask:set.values.reduce((mask,value)=>mask|1<<tags.indexOf(value),0),negative:set.negative}))
 const matches=(x:number)=>masks.every(({mask,negative})=>negative?(x&mask)===0:(x&mask)!==0)
 const bits=(x:number)=>x.toString(2).replaceAll('0','').length
 const coefficients=new Map<number,number>()
 for(let s=0;s<1<<tags.length;s++){
  let c=0
  for(let x=s;;x=(x-1)&s){if(matches(x))c+=(bits(s)-bits(x))%2?-1:1;if(x===0)break}
  if(c)coefficients.set(s,c)
 }
 return {tags,coefficients,subset:(s:number)=>tags.filter((_,i)=>s&1<<i)}
}

/** The UTC day, month and year buckets that hold exactly the days strictly on the side of a time bound it admits
 * (integer times within 2^42 ms of 1970 are bucketed by migration 319), each as [level, first, last, sign], and the
 * bound's own day. Months of the bound's year and days of its month are summed from whichever side has fewer
 * buckets: the bound's own year (or month) less the buckets past it. */
const DAY=86400000,LIMIT=4398046511104
export function timeBuckets(bound:TimeCondition){
 if(Math.abs(bound.at)>LIMIT)return undefined
 let day=Math.floor(bound.at/DAY)
 while(day*DAY>bound.at)day--
 while((day+1)*DAY<=bound.at)day++
 const date=new Date(day*DAY),year=date.getUTCFullYear(),month=year*12+date.getUTCMonth()
 const monthStart=Date.UTC(year,date.getUTCMonth(),1)/DAY,monthEnd=Date.UTC(year,date.getUTCMonth()+1,1)/DAY
 const below=bound.operator==='lt'||bound.operator==='lte'
 type Range=[string,number,number,number]
 // The days strictly before (after) the bound's day: whole years, then the months and the days of the bound's year
 // and month on its side, each either directly or as the whole year (month) less the other side.
 const months=below?{near:[year*12,month-1],far:[month,year*12+11]}:{near:[month+1,year*12+11],far:[year*12,month]}
 const days=below?{near:[monthStart,day-1],far:[day,monthEnd-1]}:{near:[day+1,monthEnd-1],far:[monthStart,day]}
 const width=([from,to]:number[])=>Math.max(0,to-from+1)
 const monthsDirect=width(months.near)<=width(months.far)+1,daysDirect=width(days.near)<=width(days.far)+1
 const ranges:Range[]=[
  below?['y',-1e9,monthsDirect?year-1:year,1]:['y',monthsDirect?year+1:year,1e9,1],
  ...(monthsDirect?[['m',months.near[0],months.near[1],1] as Range]:[['m',months.far[0],months.far[1],-1] as Range]),
  // The bound's month's days on its side: directly, or the whole month less the other side's days.
  ...(daysDirect?[['d',days.near[0],days.near[1],1] as Range]:[['m',month,month,1] as Range,['d',days.far[0],days.far[1],-1] as Range]),
 ]
 return {ranges:ranges.filter(([,from,to])=>from<=to),day:[day*DAY,(day+1)*DAY] as [number,number]}
}
/** An entry time the buckets hold (as migration 319 decides it), over a row (alias `x`). */
export const bucketed=(x:string,column:string)=>`(typeof(${x}.${column})='integer' AND ${x}.${column} BETWEEN -${LIMIT} AND ${LIMIT})`
