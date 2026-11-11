-- The every-minute tick and the work after a message send read rows in proportion to the work that is due, not to the
-- size of a large imported workspace or of the database. Additive and index-only: no row changes, no trigger recreated.
--
-- A conversation's own tags (src/modules/workflows/rule-model.ts ticket context, and the inbox_entry_added/removed
-- tag tally statements of 313_inbox_entries.sql) bind project_id and conversation_id; conversation_tags_filter leads
-- with project_id and tag_id, so each read walked every tag link of the workspace. This index leads with the
-- conversation.
CREATE INDEX conversation_tags_conversation ON conversation_tags(conversation_id,project_id,tag_id);
-- Outbox dispatch (src/outbox-recovery.ts: the pending conversations, one conversation's undelivered messages and the
-- outbox page job) and the outbox-first ordering of due workflow events look for undelivered rows only; the outbox is
-- never pruned, so they walked every delivered row. This partial index holds the undelivered rows alone.
CREATE INDEX conversation_outbox_undelivered ON conversation_outbox(conversation_id,project_id) WHERE delivered_at IS NULL;
-- The socket replay (src/modules/conversations/socket.ts) reads one conversation's, or one workspace's, rows after the
-- socket's cursor; it walked the outbox by id from the cursor across every workspace.
CREATE INDEX conversation_outbox_conversation ON conversation_outbox(conversation_id);
CREATE INDEX conversation_outbox_project ON conversation_outbox(project_id);
-- Due workflow events (src/modules/workflows/events.ts and event-batch.ts) are pending events whose
-- coalesce(next_attempt_at,0) has passed; workflow_events_pending holds next_attempt_at bare, so each read walked every
-- pending event, due or waiting for a retry. This index holds the reads' own expression.
CREATE INDEX workflow_events_due ON workflow_events(state,coalesce(next_attempt_at,0));
-- The refresh batch of rule, automation and schedule events (src/modules/workflows/event-batch.ts) leases its pending
-- events by id and completes or retries them by lease token; with only the state columns indexed, each of those writes
-- walked every pending event too. These two indexes let them find their own events.
CREATE INDEX workflow_events_pending_ids ON workflow_events(state,id);
CREATE INDEX workflow_events_lease ON workflow_events(state,lease_token);
