/** Mailbox imports are team-only even if a sender later proves their address. */
export const customerMailboxHistorySql=(alias='c')=>`NOT EXISTS(SELECT 1 FROM move_in_conversations mailbox_history WHERE mailbox_history.project_id=${alias}.project_id AND mailbox_history.conversation_id=${alias}.id AND mailbox_history.vendor='mailbox')`
