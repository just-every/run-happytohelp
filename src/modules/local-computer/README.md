# Local computer source capability

Native TypeScript port of HappyToHelp `app/Services/LocalAgents` and
`docs/local-agent-contract.md`; the edition preserves the actual Node connector
under `local-agent/` including Codex app-server, Claude CLI and existing-session MCP.
The Worker never runs a shell or desktop operation. A separately paired host does.
The connector tests use isolated temporary fixtures and provider boundaries.

Select this directory, migrations/030_local_computer.sql and local-agent as source.
Register `registerLocalComputerRoutes(app, integration)`. Integration explicitly
supplies operator authorization, current membership, a bounded scoped context, and
conditional reply delivery. `src/edition/local-computer.ts` binds those contracts to HappyToHelp's
native conversation admission. Consumers may supply another domain's adapters.

Pairing and grants store only secret hashes. Claims preserve run/claim identity;
capacity and queued-to-running transition are conditional SQL. Running jobs are
never requeued after host disappearance. Context access and results check live
membership and device ownership. Authority modes remain investigate, resolve and
resolve_reply. Presence and actual listening readiness are separate markers.

Result proposals are selected explicitly and receipt identity prevents repeated
sends or child creation. Presence of a replies key disables legacy automatic
reply delivery. Unverified resolve_reply requires input. Conversation frontier
checks apply at actual message admission. A failed/uncertain delivery receipt
requires review and is never silently replayed. Screenshots remain job/device
owned and are private project-scoped R2 artifacts.

The native module currently preserves connector protocols and principal lifecycle;
legacy presentation details need acceptance against the full original UI.
Completed reports write native internal notes and context includes recent notes. The current project authorization decision endpoint
is authenticated; the edition supplies the first-party browser form.

Verification: node tests/journeys/delegation-computers.mjs runs the real module HTTP routes against local workerd, D1 and R2. The native browser authorization page is supplied by WorkspacePages/ComputersPage (`LocalComputerAuthorize`): it reports the recorded outcome (approved, denied, or a code that is not valid), clears the code and refuses a second decision until a new code is entered. The code is the only value in its URL; pairing and device secrets never are. The Connect computer dialog is styled for any workspace page (`delegation-computers` styles), not only the inbox. `pnpm run test:computers-delegation-browser` checks both in a real browser.

Revocation withdraws authority; it never confirms that the paired host stopped. Revoking a device or a
grant cancels only queued work (it never started) and moves running/needs_input work to the terminal status
`revoked` with `cancel_requested=1`, `completed_at` and `delivery_state='authority_revoked'`; heartbeat
membership loss uses the same status with `delivery_state='membership_lost'`. The server cannot learn the local
process outcome afterwards: a revoked device or grant answers 401 and the connector records `revoked_unknown`
for its active work, while after membership loss the heartbeat omits the withdrawn job, job routes answer 403 and
the connector stops and drops that run locally without reporting. `cancelled` is written only for queued work or
for a cancellation the device itself reports. Job scope is exactly the revoked device plus its grant siblings;
jobs on any other device, including devices revoked earlier, are untouched. The terminal status frees the
one-active-delegation index, so the conversation can be delegated again.

A claim id belongs to at most one job. Replaying a claim id whose job is no longer running or awaiting input
returns `data:null`: a reconnecting connector is never handed back withdrawn or finished work, and the spent
claim id never claims other queued work.

Result event, terminal status and pending effects commit atomically. Retry or scheduled recoverLocalResultEffects
resumes notes and exact-ID reply admission after a crash. When authority is gone (device revoked or operator
membership lost) the effect is blocked and `delivery_state='authorization_lost'` is recorded while the report
stays terminal; it is never reopened for input that nobody could act on. A reply that fails delivery reopens the
report as `needs_input` with `delivery_state='review'` only while no replacement delegation holds the
conversation. Each effect is swept independently, so one failing row cannot abort the sweep or the scheduled
recoveries after it. Legacy imports use the same vocabulary: started delegations arrive
`revoked`/`authority_revoked`, queued ones `cancelled`/`held`. Tests inject a post-delivery/pre-note failure and
prove one message plus one note after recovery. Verification: node tests/journeys/delegation-computers.mjs.

A new customer message invalidates earlier local reply evidence. Even when a
caller supplies the current composer revision, both draft adoption and final
message admission refuse the older proposal. Internal notes and teammate edits
do not invalidate it. A later customer recurrence reopens the original solved
thread with its accountable owner; the packaged-connector journey restarts the
application, reproduces the recurrence with a fresh read-only investigation and
proves that neither the earlier repair nor its reply is replayed automatically.
These disposable-system observations do not qualify a live customer environment
or enforce all production, data, spending and time constraints required by PUSH-001.
