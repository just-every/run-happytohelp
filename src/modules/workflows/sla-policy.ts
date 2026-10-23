import {invalid,named,object,priorities} from '../tickets/model'

export type SlaPolicy={id:string;project_id:string;name:string;calendar_id:string;position:number;conditions:{priorities:string[];plans:string[];channels:string[];brands:string[];form_ids?:string[];fields?:Record<string,unknown>};first_response_minutes:number|null;next_response_minutes:number|null;resolution_minutes:number|null;pause_on_hold:boolean;approaching_minutes:number;unattended_minutes:number|null;backup_user_ids:string[];active:boolean;updated_at:number}
export function policyData(row:any):SlaPolicy{
 const {conditions_json,backup_user_ids_json,...rest}=row
 return {...rest,conditions:JSON.parse(conditions_json),backup_user_ids:JSON.parse(backup_user_ids_json),pause_on_hold:!!row.pause_on_hold,active:!!row.active}
}
function duration(value:unknown,label:string,optional=true){
 if(value==null&&optional)return null
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>525600)invalid(`${label} must be positive business minutes, at most 525600`)
 return value
}
export function policyDefinition(input:unknown,projectId:string){
 const value=object(input),conditions=object(value.conditions??{}),normalized:Record<string,string[]>={}
 for(const field of ['priorities','plans','channels','brands','form_ids']){
  const entries=conditions[field]??[]
  if(!Array.isArray(entries)||entries.length>100||entries.some(v=>typeof v!=='string'||!v.trim()||v.length>120))invalid(`Invalid ${field} condition`)
  normalized[field]=[...new Set<string>(entries.map((v:string)=>v.trim()))]
 }
 const fields=object(conditions.fields??{})
 if(Object.keys(fields).length>50||Object.keys(fields).some(id=>!id||id.length>200))invalid('Choose up to 50 typed SLA fields')
 if(normalized.priorities.some(p=>!priorities.includes(p as any)))invalid('Unknown ticket priority')
 if(normalized.brands.some(id=>id!==projectId))invalid('SLA brands must belong to this workspace')
 const first=duration(value.first_response_minutes,'First response'),next=duration(value.next_response_minutes,'Next response'),resolution=duration(value.resolution_minutes,'Resolution')
 if(first===null&&next===null&&resolution===null)invalid('Configure at least one SLA commitment')
 const position=value.position??0
 if(!Number.isInteger(position)||position<0||position>100000)invalid('Position must be a nonnegative integer')
 const backups=value.backup_user_ids??[]
 if(!Array.isArray(backups)||backups.length>20||backups.some(v=>typeof v!=='string'||!v||v.length>120))invalid('Choose up to 20 named backups')
 for(const key of ['active','pause_on_hold'])if(value[key]!==undefined&&typeof value[key]!=='boolean')invalid(`${key} must be a boolean`)
 const approaching=value.approaching_minutes??15
 if(typeof approaching!=='number'||!Number.isFinite(approaching)||approaching<0||approaching>525600)invalid('Approaching threshold must be nonnegative minutes')
 return {name:named(value.name),calendar_id:named(value.calendar_id),position,conditions_json:JSON.stringify({...normalized,fields}),first_response_minutes:first,next_response_minutes:next,resolution_minutes:resolution,pause_on_hold:value.pause_on_hold===false?0:1,approaching_minutes:approaching,unattended_minutes:duration(value.unattended_minutes,'Unattended threshold'),backup_user_ids_json:JSON.stringify([...new Set(backups)]),active:value.active===false?0:1}
}
export function policyMatches(policy:SlaPolicy,ticket:any,metadata:Record<string,unknown>){
 const values:Record<string,unknown>={priorities:ticket.priority,plans:metadata.plan??metadata.customer_plan??null,channels:ticket.channel,brands:ticket.brand_id??ticket.project_id}
 const {form_ids=[],fields={}}=policy.conditions
 return Object.entries(values).every(([key,value])=>!policy.conditions[key as 'priorities'|'plans'|'channels'|'brands'].length||policy.conditions[key as 'priorities'|'plans'|'channels'|'brands'].includes(String(value??'')))
  &&(!form_ids.length||form_ids.includes(ticket.form_id))
  &&Object.entries(fields).every(([id,value])=>Object.hasOwn(ticket.fields??{},id)&&JSON.stringify(ticket.fields[id])===JSON.stringify(value))
}
