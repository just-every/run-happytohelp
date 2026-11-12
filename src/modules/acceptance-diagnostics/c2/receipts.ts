import {scopedInboundId,inboundLocalId,legacyInboundLocalId} from '../../integrations/inbound-identity'
import {receiptSelector} from './selectors'
import {deliveryState,errorCategory,receiptState} from './projection'

export async function projectReceipts(db:D1Database,projectId:string,input:ReturnType<typeof receiptSelector>){
 const [scopedId,localId,legacyLocalId]=await Promise.all([scopedInboundId(projectId,input.messageId),inboundLocalId(projectId,input.messageId),legacyInboundLocalId(input.messageId)])
 const [facts,receipts,deliveries]=await db.batch<Record<string,unknown>>([
  db.prepare(`SELECT
   (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=?1 AND m.actor_role='contact' AND m.local_id IN (?2,?3)) customerMessages,
   (SELECT count(*) FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.project_id=?1 AND ct.email=?4) senderConversations,
   (SELECT count(*) FROM inbound_emails WHERE project_id=?1 AND id IN (?5,?6)) inboundRows,
   (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=?1 AND c.id=?7) conversationMessages,
   (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=?1 AND c.id=?7 AND m.local_id=?8 AND m.actor_role<>'contact') savedReplies
  `).bind(projectId,localId,legacyLocalId,input.sender,input.messageId,scopedId,input.conversationId,input.localId),
  db.prepare(`SELECT ${receiptState('i.state')} state,${errorCategory('i.error')} errorCategory,
   EXISTS(SELECT 1 FROM conversations c WHERE c.id=i.conversation_id AND c.project_id=i.project_id) hasConversation,
   EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=i.message_id AND m.project_id=i.project_id AND m.conversation_id=i.conversation_id) hasMessage,
   (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE c.id=i.conversation_id AND c.project_id=i.project_id) conversationMessages
   FROM inbound_emails i WHERE i.project_id=? AND i.id IN (?,?) ORDER BY i.id LIMIT 2
  `).bind(projectId,input.messageId,scopedId),
  db.prepare(`SELECT ${deliveryState('state')} state,${errorCategory('error')} errorCategory,count(*) count
   FROM email_deliveries WHERE project_id=? AND created_at>=? AND created_at<=?
   GROUP BY 1,2 ORDER BY 1,2
  `).bind(projectId,input.from,input.to),
 ])
 return {...facts.results[0],receipts:receipts.results.map(row=>({...row,hasConversation:Boolean(row.hasConversation),hasMessage:Boolean(row.hasMessage)})),deliveries:deliveries.results}
}
