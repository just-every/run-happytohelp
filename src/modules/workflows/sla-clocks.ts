import {businessDue,businessMilliseconds} from './calendars-time'
import type {WorkflowCalendar} from './calendars'
import type {SlaPolicy} from './sla-policy'

export type SlaMetric='first_response'|'next_response'|'resolution'|'unattended'
export type SlaClock={metric:SlaMetric;cycle:number;started_at:number;due_at:number|null;remaining_minutes:number;completed_at:number|null;breached:boolean;spent_ms:number;target_ms:number;breached_at:number|null}
export type SlaState={status:string;pause_reason:string|null;clocks:SlaClock[];cursor_at:number;response_count:number;resolution_count:number;waiting:boolean;customer_started:boolean}
export type SlaEvent={id:number;at:number;kind:string;after_json:string;before_json:string|null}
const MINUTE=60000
export function newSlaState(created:number):SlaState{return {status:'new',pause_reason:null,clocks:[],cursor_at:created,response_count:0,resolution_count:0,waiting:false,customer_started:false}}
const terminal=(status:string)=>status==='solved'||status==='closed'
function pause(state:SlaState,policy:SlaPolicy){return state.status==='pending'?'pending':state.status==='on_hold'&&policy.pause_on_hold?'on_hold':null}
function start(state:SlaState,metric:SlaMetric,cycle:number,at:number,minutes:number|null){
 if(minutes===null)return
 state.clocks.push({metric,cycle,started_at:at,due_at:null,remaining_minutes:minutes,completed_at:null,breached:false,spent_ms:0,target_ms:minutes*MINUTE,breached_at:null})
}
function active(state:SlaState,metric:SlaMetric){return state.clocks.find(c=>c.metric===metric&&c.completed_at===null)}
function finishResponse(state:SlaState,at:number){for(const clock of state.clocks)if(clock.completed_at===null&&clock.metric!=='resolution')clock.completed_at=at;state.waiting=false}
export function advanceSla(state:SlaState,policy:SlaPolicy,calendar:WorkflowCalendar,to:number){
 const from=state.cursor_at
 if(to<from)return
 state.pause_reason=pause(state,policy)
 const elapsed=state.pause_reason||terminal(state.status)||!state.clocks.some(clock=>clock.completed_at===null)?0:businessMilliseconds(calendar,from,to)
 for(const clock of state.clocks){
  if(clock.completed_at!==null)continue
  const remaining=clock.target_ms-clock.spent_ms
  if(!clock.breached&&elapsed>=remaining&&remaining>=0&&!state.pause_reason&&!terminal(state.status)){
   clock.breached=true;clock.breached_at=businessDue(calendar,from,remaining)
  }
  clock.spent_ms+=elapsed;clock.remaining_minutes=Math.max(0,clock.target_ms-clock.spent_ms)/MINUTE
  clock.due_at=clock.breached_at??(state.pause_reason||terminal(state.status)?null:businessDue(calendar,to,Math.max(0,clock.target_ms-clock.spent_ms)))
 }
 state.cursor_at=to
}
function ensureResolution(state:SlaState,policy:SlaPolicy,at:number){if(!active(state,'resolution'))start(state,'resolution',++state.resolution_count,at,policy.resolution_minutes)}
function customerWaiting(state:SlaState,policy:SlaPolicy,at:number,reopened=false){
 if(state.waiting&&!reopened)return
 if(reopened)finishResponse(state,at)
 state.waiting=true
 const first=state.response_count===0&&!state.clocks.some(c=>c.metric==='first_response')&&!reopened
 start(state,first?'first_response':'next_response',++state.response_count,at,first?policy.first_response_minutes:policy.next_response_minutes)
 start(state,'unattended',state.response_count,at,policy.unattended_minutes)
}
function transition(state:SlaState,policy:SlaPolicy,next:string,at:number){
 const previous=state.status
 state.status=next
 if(terminal(next)&&!terminal(previous)){
  for(const clock of state.clocks)if(clock.completed_at===null)clock.completed_at=at
  state.waiting=false
 }else if(!terminal(next)&&terminal(previous)&&state.customer_started){
  ensureResolution(state,policy,at);customerWaiting(state,policy,at,true)
 }
}
export function applySlaEvent(state:SlaState,policy:SlaPolicy,calendar:WorkflowCalendar,event:SlaEvent){
 advanceSla(state,policy,calendar,event.at)
 const after=JSON.parse(event.after_json||'{}')
 if(event.kind==='created'){
  // Widget admission allocates a conversation before there is a request.
  // Only a real customer message establishes a service commitment.
  state.status=after.status_category??'new'
 }else if(event.kind==='changed'){
  transition(state,policy,after.status_category??state.status,event.at)
 }else if(!after.is_note&&(event.kind==='customer_reply'||event.kind==='operator_reply')){
  if(event.kind==='customer_reply'){
   const next=after.status_category??(['pending','on_hold','solved'].includes(state.status)?'open':state.status)
   transition(state,policy,next,event.at)
   state.customer_started=true
   if(!terminal(state.status)){ensureResolution(state,policy,event.at);customerWaiting(state,policy,event.at)}
  }else finishResponse(state,event.at)
 }
 if(event.kind!=='created'&&after.status_category)transition(state,policy,after.status_category,event.at)
 state.pause_reason=pause(state,policy)
 // Recompute due timestamps at the exact transition, without charging pause time.
 advanceSla(state,policy,calendar,event.at)
}
