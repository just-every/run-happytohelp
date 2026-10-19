import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'
import {cronConsumer,cronRoom} from '../../platform/cron-budget'
import {deliverOperatorNotification,type OperatorNotification,operatorNotificationCost,operatorPendingSql,operatorAdmission} from './operator-notifications'

import {assignmentRequestBudget} from './notification-budget'
export {notificationRequestEnvironment,requestRoom,deferRequestAssignments} from './notification-budget'

export async function flushRequestAssignments(env:Env){
 const budget=assignmentRequestBudget(env),deferred=budget?.deferred
 if(!budget||!deferred)return
 budget.deferred=undefined
 for(const [project,id] of deferred.values())await dispatchRequestAssignment(env,project,id)
}
/** Direct delivery never discovers another conversation or batches digests.
 * Unadmitted rows remain in their original durable FIFO for scheduled recovery. */
export async function dispatchRequestAssignment(env:Env,projectId:string,conversationId:string){
 const request=assignmentRequestBudget(env)
 if(!request)return
 if(request.deferred){request.deferred.set(`${projectId}:${conversationId}`,[projectId,conversationId]);return}
 const limit=request.remaining()
 if(limit<1+operatorNotificationCost.assignment)return
 const meter=boundedDatabase(env.DB,limit)
 const input=cronConsumer({...env,DB:meter.database},limit)
 try{
  const rows=await input.DB.prepare(`${operatorPendingSql} WHERE o.state='pending' AND o.kind='assignment' AND o.project_id=? AND o.conversation_id=? ORDER BY o.created_at,o.id LIMIT 100`).bind(projectId,conversationId).all<OperatorNotification>()
  for(const row of rows.results){if(!cronRoom(input,operatorAdmission(row)))break;if(!await deliverOperatorNotification(input,row))break}
 }catch(error){console.error('Assignment notification queued',error instanceof Error?error.name:'Error')}
}
