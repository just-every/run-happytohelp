import type {Env} from './env'
import {boundedDatabase} from './d1-budget'
const room=Symbol('cron statement admission')
type CronEnv=Env&{[room]?:{remaining:()=>number}}
/** Admission happens before a durable unit, including its outcome writes. Queue
 * and request consumers have their own invocation and no cron allocation. */
export function inCron(env:Env){return Boolean((env as CronEnv)[room])}
export function cronRoom(env:Env,statements:number){return ((env as CronEnv)[room]?.remaining()??Infinity)>=statements}
export function cronConsumer(env:Env,limit:number){
 const meter=boundedDatabase(env.DB,limit)
 return {...env,DB:meter.database,[room]:{remaining:()=>limit-meter.statements}} as Env
}

export class CronDeferred extends Error {constructor(){super('Cron work waits for invocation room')}}
export function cronRequire(env:Env,statements:number){if(!cronRoom(env,statements))throw new CronDeferred()}
