import {ticketScopeSql} from '../access/ticket-scope'
import {contactAvailableSql} from '../conversations/contact-privacy'

// Discover candidates from this conversation, then seek each thread by its key.
// The receipt index covers the message link even after intake moves elsewhere.
export const channelThreadSql=(scoped=false)=>`SELECT t.*,conv.id AS conversation_id,c.provider,c.account,c.sender,c.registered,c.token_cipher,c.revoked_at
 FROM conversations conv JOIN support_channel_threads t ON t.id IN (
  SELECT linked.id FROM messages message
   JOIN support_channel_events event ON event.message_id=message.id
   JOIN support_channel_threads linked ON linked.id=event.thread_id AND linked.connection_id=event.connection_id
   WHERE message.project_id=conv.project_id AND message.conversation_id=conv.id
  UNION SELECT cmd.support_thread_id FROM operator_ticket_commands cmd WHERE cmd.conversation_id=conv.id
  UNION SELECT pointer.id FROM support_channel_threads pointer WHERE pointer.project_id=conv.project_id AND pointer.conversation_id=conv.id
 ) AND t.project_id=conv.project_id
 JOIN support_channel_connections c ON c.id=t.connection_id
 WHERE conv.project_id=? AND conv.id=? AND ${contactAvailableSql('conv')} ${scoped?`AND ${ticketScopeSql('?','conv')}`:''}`
