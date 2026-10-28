# Support agent access

HappyToHelp serves one shared MCP endpoint at `/mcp`. It supports protocol
versions `2026-07-28` and `2025-11-25`. OAuth resource metadata is at
`/.well-known/oauth-protected-resource/mcp`. `/agents` shows policy, retained
agent activity, reviews and approval links. A person signs in through the normal
HappyToHelp account and password lifecycle to use these pages.

Business supplies signed settings and policy. Its owner and teammate IDs map to
native `users.id` in one linked project. Token email never selects a native
account. The initial native owner claim links its workspace. An upgrade with
more than one possible owner workspace needs an explicit project link before
Business agents can act. The original native owner signs in to the intended
project and posts `{projectId}` to `/api/rer/business-project` with a current
step-up and same-origin session. Once linked, this endpoint cannot move the
installation to another project. No project is chosen from an email or a routing group.
Native memberships, custom permissions, knowledge selections and second-factor
enrollment requirements continue to narrow access. A new roster entry must
complete native onboarding before it receives active agent sponsorship.

The current tools read tickets, customer context, knowledge, connector job
status, native operations, reports, customer identities, routing rules,
assistant configuration and email readiness. They can also update a ticket's
subject or priority, assign a current teammate and add an internal note.
`agent-surface.json` lists the exact names, scopes and schemas. Tool names use
`happytohelp.<area>.<verb>`; retained changes use `happytohelp.events.list`.
Ticket and article searches return at most 100 records. Transcript reads return
the first 1,000 messages and up to 200 attributed operations; they do not promise
a complete export of a longer history. Use the native export door for that job.

Internal changes call the same native ticket and note services as the dashboard.
They retain native version fences and store the agent, sponsoring person and
actual policy approvers in the native transaction. Internal notes remain private.
Ticket history and note authors identify the agent for its sponsor. Every write
needs an idempotency key; changing the arguments under a used key refuses.

Private resource templates cover project conversations, conversation context,
articles, connector jobs and attributed operations. Missing and restricted
records have the same refusal. Customer and imported text is untrusted. Readers
use redacted projections and never return connector credentials or bearer tokens.
A connector report alone does not establish independently verified repair.

The company chooses autonomous, review, approval or blocked dispositions.
Unanswered policy and Pause refuse agent work. Approval pages show the saved
summary and require a named person's decision. Current people can continue to
use the native dashboard while agents are paused. Provider spending caps remain
unenforced; saving a cap does not impose a spending guarantee.

This MCP surface does not yet send or forward customer replies, save reply
drafts, publish or edit articles, request connector work, change access or
connections, erase records, or activate procedures and routing. Those native
jobs remain in their existing authorized doors while their agent adapters are
completed. Device pairing, local process execution, connector claims/results,
imports and installation retain their separate native credentials and authority.
