import {tagsSql,type FilterPart} from '../tickets/filters'
import type {TicketSort} from '../tickets/sort'

/** A condition on conversation columns (alias `c`), with the field and operator it was compiled from. */
export type Condition=Pick<FilterPart,'sql'|'params'>&Partial<Pick<FilterPart,'field'|'operator'|'kind'|'values'>>

// The conversation columns an entry carries (the same values), by the entry's own name for them, and its tags.
// Every filter, view field and sort names only these (tickets/filters.ts), so a request reads entries alone.
const carried:Record<string,string>=Object.fromEntries(['project_id','contact_id','assigned_to','group_id','status_category','priority','channel','status_id','subject','brand_id','requester_id','submitter_id','submitter_type','created_at','updated_at','ticket_version'].map(column=>[column,column]))
carried.id='conversation_id'
const columnsOf=(sql:string)=>[...new Set([...sql.replaceAll(tagsSql,'').matchAll(/\bc\.([a-z_]+)\b/g)].map(match=>match[1]))]
/** A condition or sort over conversations, over an inbox entry or a tally row (alias `x`). */
export const onEntry=(sql:string,x:string)=>sql.replaceAll(tagsSql,`${x}.tags_key`).replace(/\bc\.([a-z_]+)\b/g,(_,column:string)=>{if(!Object.hasOwn(carried,column))throw new Error(`An inbox entry does not carry conversations.${column}`);return `${x}.${carried[column]}`})

// A condition naming only these is evaluated on the tallies' rows as well as on entries.
const tallied=new Set(['priority','status_category','channel','status_id','assigned_to','group_id'])
export const talliedCondition=(condition:Condition)=>!condition.sql.includes(tagsSql)&&columnsOf(condition.sql).every(column=>tallied.has(column))

/** A tags condition that names tags (any of them, or none of them), as the tag tallies and links answer it. */
export function tagSet(condition:Condition){
 if(condition.field!=='tags'||!condition.values||!['eq','contains','in','ne','not_in'].includes(condition.operator!))return undefined
 return {values:condition.values,negative:['ne','not_in'].includes(condition.operator!)}
}

// The index holding exactly the entries a condition on one ticket column admits, most selective first.
const drivers:Record<string,string>={id:'inbox_entries_by_id_asc',requester_id:'inbox_entries_by_requester_id_asc',submitter_id:'inbox_entries_by_submitter_id_asc',subject:'inbox_entries_by_subject_asc',brand_id:'inbox_entries_by_brand_id_asc',created_at:'inbox_entries_by_created_at_asc',updated_at:'inbox_entries_by_updated_at_asc',ticket_version:'inbox_entries_by_ticket_version_asc',status_id:'inbox_entries_by_status_id_asc',group_id:'inbox_entries_by_group_id_asc',assigned_to:'inbox_entries_assignee',priority:'inbox_entries_priority',status_category:'inbox_entries_status',channel:'inbox_entries_channel',submitter_type:'inbox_entries_by_submitter_type_asc'}
const ranked=Object.keys(drivers),numeric=new Set(['created_at','updated_at','ticket_version'])
/** The most selective index whose rows are a superset of the conditions' matches, and its condition. */
export function driver(conditions:Condition[]){
 const usable=conditions.filter(condition=>{
  const [column,...more]=columnsOf(condition.sql)
  if(more.length||column!==(condition.field==='id'?'id':condition.field)||!Object.hasOwn(drivers,column)||condition.sql.includes(' IS '))return false
  return ['eq','gt','gte','lt','lte'].includes(condition.operator!)&&(!numeric.has(column)||condition.sql.startsWith('CAST('))||condition.operator==='in'&&!numeric.has(column)
 })
 const best=usable.sort((x,y)=>ranked.indexOf(x.field!)-ranked.indexOf(y.field!))[0]
 return best&&{index:drivers[best.field!],condition:best}
}

// A custom sort led by a ticket column or tags walks that column's own index (migration 313) in the sort's
// order, sorting only within its equal values by the sort's later columns.
const sortable=new Set(['id','status_id','status_category','priority','assigned_to','subject','channel','brand_id','group_id','requester_id','submitter_id','submitter_type','created_at','updated_at','ticket_version','tags'])
export const walkedSort=(items:TicketSort[])=>items.length&&sortable.has(items[0].field)?`inbox_entries_by_${items[0].field}_${items[0].direction}`:undefined
