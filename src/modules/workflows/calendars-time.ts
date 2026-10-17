import {minutesOfDay,type WorkflowCalendar} from './calendars'

const DAY=86400000,MINUTE=60000
const formatters=new Map<string,Intl.DateTimeFormat>()
function localParts(at:number,zone:string){
 let formatter=formatters.get(zone)
 if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(zone,formatter)}
 const parts=Object.fromEntries(formatter.formatToParts(at).map(p=>[p.type,p.value]))
 return {date:`${parts.year}-${parts.month}-${parts.day}`,wall:Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)}
}
const offset=(at:number,zone:string)=>localParts(at,zone).wall-Math.floor(at/1000)*1000
function holidayDates(year:number){
 const dates=new Set<string>(),key=(at:number)=>new Date(at).toISOString().slice(0,10)
 const fixed=(month:number,day:number)=>{
  const at=Date.UTC(year,month,day),weekday=new Date(at).getUTCDay()
  dates.add(key(at));dates.add(key(at+(weekday===6?-1:weekday===0?1:0)*DAY))
 }
 const nth=(month:number,weekday:number,n:number)=>{const start=Date.UTC(year,month,1);dates.add(key(start+((weekday-new Date(start).getUTCDay()+7)%7+7*(n-1))*DAY))}
 fixed(0,1);fixed(5,19);fixed(6,4);fixed(10,11);fixed(11,25)
 nth(0,1,3);nth(1,1,3);nth(8,1,1);nth(9,1,2);nth(10,4,4)
 const lastMay=Date.UTC(year,5,0);dates.add(key(lastMay-((new Date(lastMay).getUTCDay()+6)%7)*DAY))
 return dates
}
const holidays=new Map<number,Set<string>>()
export function calendarClosed(calendar:WorkflowCalendar,date:string){
 if(calendar.closures.includes(date))return true
 if(calendar.holidays!=='us_federal')return false
 const year=Number(date.slice(0,4))
 // Adjacent years include New Year's observed on the preceding December 31.
 for(const y of [year-1,year,year+1]){if(!holidays.has(y))holidays.set(y,holidayDates(y));if(holidays.get(y)!.has(date))return true}
 return false
}
/** Intersect local windows with constant-offset UTC segments. Both folds of a
 * repeated hour count, and nonexistent spring-forward minutes never count. */
function intervals(calendar:WorkflowCalendar,date:string):Array<[number,number]>{
 if(calendarClosed(calendar,date))return []
 const midnight=Date.parse(date),windows=calendar.weekly.filter(w=>w.day===new Date(midnight).getUTCDay())
 if(!windows.length)return []
 const start=midnight-18*3600000,end=midnight+42*3600000,segments:Array<[number,number,number]>=[]
 let cursor=start,currentOffset=offset(cursor,calendar.timezone)
 for(let probe=start+6*3600000;probe<=end;probe+=6*3600000){
  const nextOffset=offset(probe,calendar.timezone)
  if(nextOffset!==currentOffset){
   let low=probe-6*3600000,high=probe
   while(high-low>1000){const mid=Math.floor((low+high)/2000)*1000;if(offset(mid,calendar.timezone)===currentOffset)low=mid;else high=mid}
   segments.push([cursor,high,currentOffset]);cursor=high;currentOffset=nextOffset
  }
 }
 segments.push([cursor,end,currentOffset])
 const result:Array<[number,number]>=[]
 for(const [left,right,zoneOffset] of segments)for(const window of windows){
  const a=Math.max(left,midnight+minutesOfDay(window.start)*MINUTE-zoneOffset),b=Math.min(right,midnight+minutesOfDay(window.end)*MINUTE-zoneOffset)
  if(b>a)result.push([a,b])
 }
 return result.sort((a,b)=>a[0]-b[0])
}
function dateAt(at:number,calendar:WorkflowCalendar){return localParts(at,calendar.timezone).date}
function nextDate(date:string){return new Date(Date.parse(date)+DAY).toISOString().slice(0,10)}
export function businessMilliseconds(calendar:WorkflowCalendar,from:number,to:number){
 if(to<=from)return 0
 let total=0,date=dateAt(from,calendar),last=dateAt(to,calendar)
 while(date<=last){for(const [a,b] of intervals(calendar,date))total+=Math.max(0,Math.min(b,to)-Math.max(a,from));date=nextDate(date)}
 return total
}
export function businessDue(calendar:WorkflowCalendar,from:number,milliseconds:number):number{
 if(milliseconds<=0)return from
 let remaining=milliseconds,date=dateAt(from,calendar)
 // A finite validated weekly schedule guarantees progress, barring explicit
 // closures. The limit exceeds the maximum accepted commitment and closure set.
 for(let days=0;days<40000;days++,date=nextDate(date))for(const [a,b] of intervals(calendar,date)){
  const left=Math.max(from,a)
  if(left>=b)continue
  if(remaining<=b-left)return left+remaining
  remaining-=b-left
 }
 throw new Error('Business calendar cannot reach the requested deadline')
}
