import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'
import {cronConsumer,cronRoom} from '../../platform/cron-budget'
import {deliverOperatorNotification,type OperatorNotification,operatorNotificationCost,operatorPendingSql,operatorAdmission} from './operator-notifications'

const requestBudget=Symbol('request notification budget')
type RequestEnv=Env&{[requestBudget]?:{remaining:()=>number;spent:(count:number)=>void}}
/** One request shares 64 notification statements, including bulk operations.
 * Meter all request work, retaining 64 statements for its post-commit refresh.
 * A single assignment needs at most 23 plus one discovery, out of D1's 1,000. */
export function notificationRequestEnvironment(env:Env):Env{
 const meter=boundedDatabase(env.DB,Infinity)
 let spent=0
 return {...env,DB:meter.database,[requestBudget]:{remaining:()=>Math.max(0,Math.min(64-spent,1000-meter.statements-64)),spent:(count:number)=>{spent+=count}}} as RequestEnv
}
/** Direct delivery never discovers another conversation or batches digests.
 * Unadmitted rows remain in their original durable FIFO for scheduled recovery. */
export async function dispatchRequestAssignment(env:Env,projectId:string,conversationId:string){
 const request=(env as RequestEnv)[requestBudget],limit=request?.remaining()??64
 if(limit<1+operatorNotificationCost.assignment)return
 const meter=boundedDatabase(env.DB,limit)
 const input=cronConsumer({...env,DB:meter.database},limit)
 try{
  const rows=await input.DB.prepare(`${operatorPendingSql} WHERE o.state='pending' AND o.kind='assignment' AND o.project_id=? AND o.conversation_id=? ORDER BY o.created_at,o.id LIMIT 100`).bind(projectId,conversationId).all<OperatorNotification>()
  for(const row of rows.results){if(!cronRoom(input,operatorAdmission(row)))break;if(!await deliverOperatorNotification(input,row))break}
 }catch(error){console.error('Assignment notification queued',error instanceof Error?error.name:'Error')}
 finally{request?.spent(meter.statements)}
}
