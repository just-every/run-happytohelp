/** Whether the team is taking conversations now, from the workspace's settings. The "Accept new conversations"
 * switch can make the team away; otherwise the optional weekly schedule uses the workspace timezone. `opensAt` is when a scheduled team is next back (the visitor's expected reply time) and `changesAt` when
 * the schedule next changes this answer, so a widget left open can ask again. `live` says the answer also follows
 * live presence (presence-based away), so an open widget keeps asking. Times are epoch milliseconds. */
export interface Availability {available:boolean;message:string;scheduled:boolean;timezone:string;opensAt:number|null;changesAt:number|null;live:boolean}

/** Presence-based away: on unless a lead turns it off, a teammate counts as away after this many idle minutes, and
 * the away message posted while nobody is online. */
export const PRESENCE_IDLE_MINUTES=[5,10,15,30,60,120],DEFAULT_PRESENCE_IDLE_MINUTES=15
export function presenceSettings(settings:any){
 const minutes=Number(settings.presence_idle_minutes)
 return {enabled:settings.is_presence_away_enabled!==false,idleMinutes:PRESENCE_IDLE_MINUTES.includes(minutes)?minutes:DEFAULT_PRESENCE_IDLE_MINUTES,message:String(settings.presence_away_message||'')}
}

const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
function zone(value:unknown){try{const name=String(value||'UTC');new Intl.DateTimeFormat('en-US',{timeZone:name});return name}catch{return 'UTC'}}
function wall(at:number,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at)
 const get=(type:string)=>parts.find(part=>part.type===type)?.value||''
 return {year:Number(get('year')),month:Number(get('month')),day:Number(get('day')),hour:Number(get('hour')),minute:Number(get('minute')),second:Number(get('second')),weekday:weekdays.indexOf(get('weekday'))+1}
}
// The instant a wall-clock time happens in a timezone. A time skipped by a DST change resolves to the hour after it.
function instant(year:number,month:number,day:number,hour:number,minute:number,timeZone:string){
 const target=Date.UTC(year,month-1,day,hour,minute)
 let at=target
 for(let pass=0;pass<2;pass++){const seen=wall(at,timeZone);at+=target-Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute,seen.second)}
 return at
}

/** `presence` is how many teammates who may reply are online now, where presence-based away applies (no assistant
 * answers visitors); without it the schedule and switch alone decide. While they say the team is open, nobody online
 * makes the team away with no known return, so the visitor sees the away notice and is asked for an email. */
export function availability(settings:any,now=new Date(),presence?:{online:number}|null):Availability{
 return withPresence(hours(settings,now),settings,presence)
}
export function withPresence(base:Availability,settings:any,presence?:{online:number}|null):Availability{
 if(!base.available||!presence||!presenceSettings(settings).enabled)return base
 return presence.online>0?{...base,live:true}:{...base,available:false,message:presenceSettings(settings).message,opensAt:null,live:true}
}
function hours(settings:any,now:Date):Availability{
 const timezone=zone(settings.timezone),at=now.getTime(),live=false
 if(settings.is_available===false||!settings.is_availability_schedule_enabled)return {available:settings.is_available!==false,message:settings.unavailable_message||'',scheduled:false,timezone,opensAt:null,changesAt:null,live}
 // Days are 1 (Monday) to 7 (Sunday); an imported legacy schedule may name Sunday 0.
 const schedule=settings.availability_schedule||{},days:number[]=Array.isArray(schedule.days)?schedule.days.map((day:unknown)=>Number(day)===0?7:Number(day)):[]
 const message=schedule.message||''
 const valid=/^\d{2}:\d{2}$/.test(schedule.time_from)&&/^\d{2}:\d{2}$/.test(schedule.time_to)&&schedule.time_to>schedule.time_from&&days.length>0
 if(!valid)return {available:false,message,scheduled:true,timezone,opensAt:null,changesAt:null,live}
 const [fromHour,fromMinute]=schedule.time_from.split(':').map(Number),[toHour,toMinute]=schedule.time_to.split(':').map(Number)
 const today=wall(at,timezone)
 // Today and the next seven days cover every weekly schedule's next opening and closing.
 for(let offset=0;offset<=7;offset++){
  const date=new Date(Date.UTC(today.year,today.month-1,today.day+offset)),weekday=(date.getUTCDay()+6)%7+1
  if(!days.includes(weekday))continue
  const [year,month,day]=[date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate()]
  const opens=instant(year,month,day,fromHour,fromMinute,timezone),closes=instant(year,month,day,toHour,toMinute,timezone)
  if(at<opens)return {available:false,message,scheduled:true,timezone,opensAt:opens,changesAt:opens,live}
  if(at<closes)return {available:true,message,scheduled:true,timezone,opensAt:null,changesAt:closes,live}
 }
 return {available:false,message,scheduled:true,timezone,opensAt:null,changesAt:null,live}
}
