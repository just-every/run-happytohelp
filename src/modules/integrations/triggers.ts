import type {Env} from '../../platform/env'
import {customerTicketNotification} from './triggers/customer'
import {teammateTicketNotification} from './notification-teammates'
export {notificationRoutes} from './triggers/routes'
export type TicketEventName='request_received'|'ticket_solved'|'customer_updated'|'ticket_updated'|'assignment'|'group'|'follower'|'mention'
export interface TicketNotificationEvent {
 projectId:string;conversationId:string;event:TicketEventName;eventId:string;actorId?:string;recipientIds?:string[];
 source?:'native'|'import'|'merge'|'isolated';expectedReplyTime?:string
}
/** Post-commit only. Selection never establishes sender or member authority. */
export async function notifyTicketEvent(env:Env,event:TicketNotificationEvent){
 if(event.source&&event.source!=='native')return {state:'suppressed'}
 if(!event.eventId||event.eventId.length>250)throw new Error('A stable committed event identity is required')
 return event.event==='request_received'||event.event==='ticket_solved'
  ?customerTicketNotification(env,event)
  :teammateTicketNotification(env,event)
}
export {notificationErasureStatements,notificationErasureCount} from './triggers/erasure'
export {sendTicketNotification,type TicketNotificationAction} from './notification-actions'
