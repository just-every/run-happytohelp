import {addDays,calendarBoundary,calendarDate,reportRange} from './calendar'
export interface ScheduleClock {frequency:'daily'|'weekly';hour:number;weekday:number}
const weekday=(date:string)=>new Date(`${date}T00:00:00Z`).getUTCDay()
/** At a missing DST hour, run at the first valid later hour; at a repeated hour,
 * run at its first occurrence. The durable local-date window prevents a duplicate. */
export function scheduleHour(date:string,hour:number,timezone:string){
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'})
 let low=calendarBoundary(date,timezone),high=calendarBoundary(addDays(date,1),timezone)
 while(low<high){const mid=low+Math.floor((high-low)/2),localHour=Number(format.formatToParts(mid).find(p=>p.type==='hour')!.value);if(localHour<hour)low=mid+1;else high=mid}
 return low
}
export function nextScheduleWindow(clock:ScheduleClock,timezone:string,after:number){
 let date=calendarDate(after,timezone)
 for(let i=0;i<9;i++,date=addDays(date,1)){
  if(clock.frequency==='weekly'&&weekday(date)!==clock.weekday)continue
  const at=scheduleHour(date,clock.hour,timezone)
  if(at>after)return {date,at}
 }
 throw new Error('Could not determine the next report schedule window')
}
export function scheduleRange(clock:ScheduleClock,date:string,timezone:string){return reportRange({period:'custom',start:addDays(date,clock.frequency==='weekly'?-7:-1),end:date},timezone)}
