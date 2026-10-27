import {policyDefinition} from '../../workflows/sla-policy'
import {auditShape} from './shapes'
import {calendarDefinition} from '../../workflows/calendars'
import {checkedRule,type RuleDefinition} from '../../workflows/rule-model'
import type {Condition} from '../../workflows/conditions'
import type {WorkflowAction} from '../../workflows/actions-validation'
import {parseFilters} from '../../tickets/filters'
import {parseSort} from '../../tickets/sort'
import type {SourceRecord} from '../../import-kit/src/types'
import type {NativeValue} from './normalise'
import {nativeId,object,sourceId,tagKey,text,time} from './common'

const kinds=new Set(['group','view','schedule','trigger','automation','sla_policy'])
const timezoneAliases:Record<string,string>={'Eastern Time (US & Canada)':'America/New_York','Central Time (US & Canada)':'America/Chicago','Mountain Time (US & Canada)':'America/Denver','Pacific Time (US & Canada)':'America/Los_Angeles','UTC':'UTC'}
const tagNames=(value:unknown)=>text(value,'configuration_tags_required',8000).split(/\s+/).filter(Boolean)
export function configurationTags(record:SourceRecord){
 if(!['macro','trigger','automation'].includes(record.kind))return []
 const p=record.payload as any,actions=Array.isArray(p.actions)?p.actions:[],conditions=[...(Array.isArray(p.conditions?.all)?p.conditions.all:[]),...(Array.isArray(p.conditions?.any)?p.conditions.any:[])]
 return [...actions.filter((a:any)=>['current_tags','remove_tags'].includes(a?.field)&&typeof a.value==='string').flatMap((a:any)=>a.value.split(/\s+/).filter(Boolean)),...conditions.filter((c:any)=>c?.field==='tags'&&typeof c.value==='string').flatMap((c:any)=>c.value.split(/\s+/).filter(Boolean))]
}
export function zendeskConfiguration(record:SourceRecord,projectId:string,actorId:string,records:Map<string,SourceRecord>,tagIds:Map<string,string>,omissions:string[]):{kind:string;target:string;tables:NativeValue['tables']}|null{
 if(!kinds.has(record.kind))return null
 const p=record.payload as any,id=(kind:string,source:string)=>nativeId(projectId,'zendesk',kind,source),target=id(record.kind,record.sourceId)
 const created=time(p.created_at,'iso'),updated=time(p.updated_at,'iso')
 const group=(value:unknown)=>{const sid=sourceId(value,'zendesk'),source=records.get('group/'+sid)?.payload as any;if(!source||source.deleted===true)throw Error('configuration_group_unavailable');return id('group',sid)}
 const tags=(value:unknown)=>tagNames(value).map(name=>tagIds.get(tagKey(name))??id('tag',tagKey(name)))
 const status=(value:any)=>{if(!['new','open','pending','hold','solved','closed'].includes(value))throw Error('configuration_status_unsupported');return value==='hold'?'on_hold':value}
 function condition(raw:any):Condition{
  if(!object(raw)||typeof raw.field!=='string'||typeof raw.operator!=='string')throw Error('configuration_condition_invalid')
  const {field,operator,value}=raw,op=operator==='is'?'eq':operator==='is_not'?'neq':null
  if(['status','priority'].includes(field)&&op){if(field==='priority'&&!['low','normal','high','urgent'].includes(value))throw Error('configuration_priority_invalid');return {field:field==='status'?'status_id':field,op,value:field==='status'?status(value):value}}
  if(field==='group_id'&&op)return {field,op,value:group(value)}
  if(field==='tags'){
   const values=tags(value)
   if(operator==='contains_at_least_one_of')return {field,op:'in',value:values}
   if(operator==='contains_none_of_the_following')return {field,op:'not_in',value:values}
   if(values.length===1&&['contains','not_contains'].includes(operator))return {field,op:operator==='contains'?'eq':'neq',value:values[0]}
  }
  if(field==='status'&&operator==='less_than'&&value==='solved')return {field:'status_category',op:'in',value:['new','open','pending','on_hold']}
  throw Error('configuration_condition_unsupported:'+field+':'+operator)
 }
 if(record.kind==='group'){
  if(p.deleted===true)throw Error('deleted_group_not_imported')
  omissions.push('group_memberships_and_default_require_native_review')
  return {kind:'group',target,tables:{ticket_groups:[{project_id:projectId,id:target,name:text(p.name,'group_name_required',200),updated_at:updated}],ticket_group_members:[]}}
 }
 if(record.kind==='schedule'){
  if(!Array.isArray(p.intervals)||!p.intervals.length)throw Error('schedule_intervals_required')
  const weekly:any[]=[]
  for(const interval of p.intervals){
   if(!object(interval)||!Number.isInteger(interval.start_time)||!Number.isInteger(interval.end_time)||interval.start_time<0||interval.end_time>10080||interval.end_time<=interval.start_time)throw Error('schedule_interval_invalid')
   for(let start=interval.start_time;start<interval.end_time;){const day=Math.floor(start/1440),end=Math.min(interval.end_time,(day+1)*1440),hhmm=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');weekly.push({day,start:hhmm(start-day*1440),end:hhmm(end-day*1440)});start=end}
  }
  if(p.holidays!==undefined&&!Array.isArray(p.holidays))throw Error('schedule_holidays_required')
  const closures:string[]=[]
  for(const holiday of p.holidays??[]){
   if(!object(holiday)||!/^\d{4}-\d\d-\d\d$/.test(holiday.start_date)||!/^\d{4}-\d\d-\d\d$/.test(holiday.end_date))throw Error('schedule_holiday_date_required')
   const start=Date.parse(holiday.start_date),end=Date.parse(holiday.end_date)
   if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==holiday.start_date||new Date(end).toISOString().slice(0,10)!==holiday.end_date||end<start||(end-start)/86400000>3660)throw Error('schedule_holiday_range_invalid')
   for(let at=start;at<=end;at+=86400000){if(closures.length>=3660)throw Error('schedule_holiday_limit');closures.push(new Date(at).toISOString().slice(0,10))}
  }
  const definition=calendarDefinition({name:p.name,timezone:timezoneAliases[p.time_zone]??p.time_zone,weekly,holidays:'none',closures,active:false})
  omissions.push('calendar_imported_inactive_explicit_activation_required')
  return {kind:'calendar',target:id('calendar',record.sourceId),tables:{workflow_calendars:[{project_id:projectId,id:id('calendar',record.sourceId),...definition,updated_at:updated}]}}
 }
 if(record.kind!=='sla_policy'&&(!object(p.conditions)||!Array.isArray(p.conditions.all)||!Array.isArray(p.conditions.any)))throw Error('configuration_conditions_required')
 if(record.kind==='sla_policy'){
  // Refuse unknown semantics for the entire policy, including nested metrics.
  if(auditShape('zendesk','sla_policy',p).issues.length)throw Error('sla_policy_structure_unsupported')
  if(p.filter.any.length||p.filter.all.some((c:any)=>c.field!=='priority'||c.operator!=='is'||!['low','normal','high','urgent'].includes(c.value)))throw Error('sla_policy_conditions_unsupported')
  if(!Array.isArray(p.policy_metrics)||p.policy_metrics.length!==1)throw Error('sla_policy_single_metric_required')
  const metric=p.policy_metrics[0]
  if(metric.metric!=='first_reply_time'||metric.business_hours!==true)throw Error('sla_policy_metric_unsupported')
  if(!['low','normal','high','urgent'].includes(metric.priority)||p.filter.all.some((c:any)=>c.value!==metric.priority))throw Error('sla_policy_priority_unsupported')
  // This annotation is supplied by the reviewing admin, never inferred from an
  // account default or another policy. The referenced schedule must map intact.
  if(p.move_in_schedule_id==null)throw Error('sla_policy_calendar_review_required')
  const sid=sourceId(p.move_in_schedule_id,'zendesk'),schedule=records.get('schedule/'+sid)
  if(!schedule||auditShape('zendesk','schedule',schedule.payload).issues.length)throw Error('sla_policy_calendar_unavailable')
  zendeskConfiguration(schedule,projectId,actorId,records,tagIds,[])
  const definition=policyDefinition({name:p.title,calendar_id:id('calendar',sid),position:p.position,conditions:{priorities:[metric.priority]},first_response_minutes:metric.target,active:false,pause_on_hold:false,approaching_minutes:0},projectId)
  omissions.push(`sla_policy_commitment_reviewed:${metric.priority}:${metric.target}`,'sla_policy_imported_inactive_explicit_activation_required',`sla_policy_calendar_reviewed:${sid}:${(schedule.payload as any).name}`,'sla_policy_native_pause_and_order_review_required')
  return {kind:'sla_policy',target,tables:{sla_policies:[{project_id:projectId,id:target,...definition,updated_at:updated}]}}
 }
 if(record.kind==='view'){
  if(p.conditions.any.length)throw Error('view_any_conditions_not_supported')
  if(p.restriction!=null)throw Error('restricted_view_requires_native_review')
  const filters=parseFilters(p.conditions.all.map((raw:any)=>{const c=condition(raw);return {field:c.field,operator:c.op==='neq'?'ne':c.op,value:c.value}}))
  // Zendesk presentation columns and grouping do not change ticket inclusion.
  // Do not silently reinterpret unsupported source sorting.
  const by=p.execution?.sort_by??'updated_at',direction=p.execution?.sort_order??'desc'
  if(!['created_at','updated_at','priority','status','id'].includes(by)||!['asc','desc'].includes(direction))throw Error('view_sort_unsupported')
  const sort=parseSort([{field:by==='status'?'status_id':by,direction}])
  omissions.push('view_imported_personal_review_before_sharing')
  return {kind:'view',target,tables:{ticket_views:[{id:target,project_id:projectId,owner_id:actorId,name:text(p.title,'view_title_required',100),visibility:'personal',filters_json:JSON.stringify(filters),sort_json:JSON.stringify(sort),version:1,created_at:created,updated_at:updated}]}}
 }
 const all=p.conditions.all.slice(),any=p.conditions.any.slice();let timing:RuleDefinition['time']
 if(record.kind==='automation'){
  const clocks=all.filter((c:any)=>typeof c?.field==='string'&&c.field.startsWith('hours_since_'))
  if(clocks.length!==1||any.some((c:any)=>c?.field?.startsWith('hours_since_')))throw Error('automation_one_all_time_condition_required')
  const clock=clocks[0],field:Record<string,string>={hours_since_created:'created_at',hours_since_updated:'updated_at',hours_since_assigned:'assigned_at',hours_since_pending:'pending_at',hours_since_on_hold:'on_hold_at',hours_since_solved:'solved_at'}
  if(!field[clock.field]||clock.operator!=='greater_than'||!/^\d+(?:\.\d+)?$/.test(String(clock.value)))throw Error('automation_time_condition_unsupported')
  timing={field:field[clock.field],hours:Number(clock.value)};all.splice(all.indexOf(clock),1)
  omissions.push('automation_native_hour_boundary_once_per_eligibility_episode')
 }
 if(!Array.isArray(p.actions)||!p.actions.length)throw Error('configuration_actions_required')
 const actions:WorkflowAction[]=p.actions.map((a:any)=>{
  if(!object(a))throw Error('configuration_action_invalid')
  if(a.field==='status')return {type:'status',status_id:status(a.value)}
  if(a.field==='priority'){if(!['low','normal','high','urgent'].includes(a.value))throw Error('configuration_priority_invalid');return {type:'priority',priority:a.value}}
  if(a.field==='group_id')return {type:'assign',user_id:null,group_id:group(a.value)}
  if(['current_tags','remove_tags'].includes(a.field))return {type:'tags',[a.field==='current_tags'?'add':'remove']:tags(a.value)}
  throw Error('configuration_action_unsupported:'+String(a.field))
 })
 const definition=checkedRule({name:p.title,kind:timing?'time':'event',position:p.position??0,conditions:{all:all.map(condition),any:any.map(condition)},actions,...(timing?{time:timing}:{})})
 omissions.push('rule_imported_draft_preview_and_publish_required','rule_execution_uses_native_event_journal')
 return {kind:'rule',target:id('rule',record.kind+':'+record.sourceId),tables:{workflow_rules:[{id:id('rule',record.kind+':'+record.sourceId),project_id:projectId,name:definition.name,kind:definition.kind,position:definition.position,state:'draft',draft_json:JSON.stringify(definition),published_version:0,owner_id:actorId,created_at:created,updated_at:updated}],workflow_rule_versions:[]}}
}
