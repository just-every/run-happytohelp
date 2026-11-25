-- An open ticket polls its handle timer and its local-agent work while it is on screen.
-- Each poll reads only the viewed ticket's rows and the operator's own devices, so its
-- cost stays the same however much history the workspace keeps.

-- Handle timer: the ticket's sessions, newest first. It replaces the two-column index,
-- which only found the ticket and left the planner sorting the whole workspace's sessions.
CREATE INDEX IF NOT EXISTS ticket_handle_conversation_recent
 ON ticket_handle_sessions(project_id,conversation_id,started_at DESC,id DESC);
DROP INDEX IF EXISTS ticket_handle_conversation;

-- Delegations: the ticket's local-agent jobs, newest first.
CREATE INDEX IF NOT EXISTS local_jobs_conversation_recent
 ON local_jobs(project_id,conversation_id,created_at);
-- A device's live and queued jobs, counted on the Local agents list and claimed by the agent.
CREATE INDEX IF NOT EXISTS local_jobs_device_status
 ON local_jobs(device_id,status,created_at);
-- An operator's own devices.
CREATE INDEX IF NOT EXISTS local_devices_user
 ON local_devices(user_id);
