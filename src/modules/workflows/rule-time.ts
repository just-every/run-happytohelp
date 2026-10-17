import type {Env} from '../../platform/env'
import {calendarData} from './calendars'
import {businessDue,businessMilliseconds} from './calendars-time'
import type {RuleDefinition} from './rule-model'
export async function evaluateTime(env:Env,projectId:string,ticket:any,definition:RuleDefinition,now:number){
 const time=definition.time!
 const anchor=time.field==='sla_due_at'?(await env.DB.prepare("SELECT min(json_extract(clock.value,'$.due_at')) at FROM ticket_sla_state s,json_each(s.state_json,'$.clocks') clock WHERE s.project_id=? AND s.conversation_id=? AND json_extract(clock.value,'$.due_at') IS NOT NULL AND json_extract(clock.value,'$.completed_at') IS NULL").bind(projectId,ticket.id).first<any>())?.at:ticket[time.field]
 if(typeof anchor!=='number')return {matched:false,due_at:null,explanation:'The time anchor is unavailable'}
 if(time.calendar_id){const row=await env.DB.prepare('SELECT * FROM workflow_calendars WHERE project_id=? AND id=? AND active=1').bind(projectId,time.calendar_id).first<any>();if(!row)return {matched:false,due_at:null,explanation:'The selected business calendar is unavailable'};const calendar=calendarData(row),elapsed=businessMilliseconds(calendar,anchor,now);return {matched:elapsed>=time.hours*3600000,due_at:businessDue(calendar,anchor,time.hours*3600000),explanation:`${elapsed/3600000} business hours since ${time.field}; requires ${time.hours}`}}
 return {matched:now-anchor>=time.hours*3600000,due_at:anchor+time.hours*3600000,explanation:`${Math.max(0,now-anchor)/3600000} calendar hours since ${time.field}; requires ${time.hours}`}
}
export const workflowTemplates:RuleDefinition[]=[
 {name:'Pending 48h nudge',kind:'time',position:10,conditions:{all:[{field:'status_category',op:'eq',value:'pending'}],any:[]},time:{field:'pending_at',hours:48},actions:[{type:'notify',kind:'customer_update',message:'We are waiting for your reply. Please let us know if you still need help.'}]},
 {name:'Pending 96h solve',kind:'time',position:20,conditions:{all:[{field:'status_category',op:'eq',value:'pending'}],any:[]},time:{field:'pending_at',hours:96},actions:[{type:'status',status_id:'solved'}]},
 {name:'Solved 4d close',kind:'time',position:30,conditions:{all:[{field:'status_category',op:'eq',value:'solved'}],any:[]},time:{field:'solved_at',hours:96},actions:[{type:'status',status_id:'closed'}]},
]
