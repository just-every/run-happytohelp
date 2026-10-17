import {invalid,named,object} from '../tickets/model'

export type WeeklyWindow={day:number;start:string;end:string}
export type WorkflowCalendar={project_id?:string;id:string;name:string;timezone:string;weekly:WeeklyWindow[];holidays:'none'|'us_federal';closures:string[];active:boolean;updated_at?:number}
export function calendarData(row:any):WorkflowCalendar{
 const {weekly_json,closures_json,...rest}=row
 return {...rest,weekly:JSON.parse(weekly_json),closures:JSON.parse(closures_json),active:!!row.active}
}
export const minutesOfDay=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3))
export function calendarDefinition(input:unknown){
 const value=object(input),name=named(value.name),timezone=named(value.timezone)
 try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(0)}catch{invalid('Use a valid IANA timezone')}
 if(!Array.isArray(value.weekly)||!value.weekly.length||value.weekly.length>70)invalid('Enter at least one weekly business-hours window')
 const weekly:WeeklyWindow[]=value.weekly.map((entry:unknown)=>{
  const w=object(entry)
  if(!Number.isInteger(w.day)||w.day<0||w.day>6||typeof w.start!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start)||typeof w.end!=='string'||!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(w.end)||minutesOfDay(w.end)<=minutesOfDay(w.start))invalid('Weekly windows need a day (0–6), start and later end (HH:mm)')
  return {day:w.day,start:w.start,end:w.end}
 }).sort((a:WeeklyWindow,b:WeeklyWindow)=>a.day-b.day||a.start.localeCompare(b.start))
 for(let i=1;i<weekly.length;i++)if(weekly[i].day===weekly[i-1].day&&weekly[i].start<weekly[i-1].end)invalid('Weekly windows cannot overlap')
 const holidays=value.holidays??'none'
 if(!['none','us_federal'].includes(holidays))invalid('Choose none or us_federal holidays')
 if(!Array.isArray(value.closures??[])||(value.closures??[]).length>3660)invalid('Enter closure dates')
 const closures=[...new Set<string>((value.closures??[]).map((date:unknown)=>{
  if(typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)invalid('Closure dates must be YYYY-MM-DD')
  return date as string
 }))].sort()
 if(value.active!==undefined&&typeof value.active!=='boolean')invalid('active must be a boolean')
 return {name,timezone,weekly_json:JSON.stringify(weekly),holidays,closures_json:JSON.stringify(closures),active:value.active===false?0:1}
}
