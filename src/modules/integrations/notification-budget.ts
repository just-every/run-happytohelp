import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'

const requestBudget=Symbol('request notification budget')
interface RequestBudget {remaining:()=>number;deferred?:Map<string,[string,string]>}
type RequestEnv=Env&{[requestBudget]?:RequestBudget}
/** Count all request work. Notices use only the room left after the request's
 * 64-statement response reserve; bulk mutations reserve their own units first. */
export function notificationRequestEnvironment(env:Env):Env{
 const meter=boundedDatabase(env.DB,Infinity)
 return {...env,DB:meter.database,[requestBudget]:{remaining:()=>Math.max(0,1000-meter.statements-64)}} as RequestEnv
}
export const assignmentRequestBudget=(env:Env)=>(env as RequestEnv)[requestBudget]
export const requestRoom=(env:Env)=>assignmentRequestBudget(env)?.remaining()??0
export function deferRequestAssignments(env:Env){
 const budget=assignmentRequestBudget(env)
 if(budget)budget.deferred=new Map()
}
