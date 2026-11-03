import {ticketScopeSql} from '../access/ticket-scope'
import {contactAvailableSql} from '../conversations/contact-privacy'

// Discover candidates from this conversation, then seek each thread by its key.
// The receipt index covers the message link even after intake moves elsewhere.
// Materialization and CROSS JOIN prevent a project-wide thread loop from
// reevaluating the receipt lookup once for each unrelated customer.
export const channelThreadSql=(scoped=false)=>`WITH requested AS MATERIALIZED (
 SELECT * FROM conversations WHERE project_id=? AND id=?
), served AS MATERIALIZED (
  SELECT linked.id FROM requested conv CROSS JOIN messages message
   CROSS JOIN support_channel_events event ON event.message_id=message.id
   CROSS JOIN support_channel_threads linked ON linked.id=event.thread_id AND linked.connection_id=event.connection_id
   WHERE message.project_id=conv.project_id AND message.conversation_id=conv.id
  UNION SELECT cmd.support_thread_id FROM requested conv CROSS JOIN operator_ticket_commands cmd ON cmd.conversation_id=conv.id
  UNION SELECT pointer.id FROM requested conv CROSS JOIN support_channel_threads pointer ON pointer.project_id=conv.project_id AND pointer.conversation_id=conv.id
 )
 SELECT t.*,conv.id AS conversation_id,c.provider,c.account,c.sender,c.registered,c.token_cipher,c.revoked_at
 FROM requested conv CROSS JOIN served CROSS JOIN support_channel_threads t ON t.id=served.id AND t.project_id=conv.project_id
 CROSS JOIN support_channel_connections c ON c.id=t.connection_id
 WHERE ${contactAvailableSql('conv')} ${scoped?`AND ${ticketScopeSql('?','conv')}`:''}`
