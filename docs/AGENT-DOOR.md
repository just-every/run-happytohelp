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
assistant configuration and email readiness. They can also save a persistent reply draft, update a ticket's
subject or priority, assign a current teammate and add an internal note.
`agent-surface.json` lists the exact names, scopes and schemas. Tool names use
`happytohelp.<area>.<verb>`; retained changes use `happytohelp.events.list`.
Ticket and article searches return at most 100 records. Transcript reads return
the first 1,000 messages and up to 200 attributed operations; they do not promise
a complete export of a longer history. Use the native export door for that job.
Reports include the native calendar aggregates and customer feedback. Protected
content in that returned feedback adds the sensitive class; a policy blocking
that class refuses the read without returning the comment.

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
Record tools resolve native target identities for audit and approval summaries.
Resource refusals expose their machine code in JSON-RPC `error.data.code`.
Reusing a successful mutation key still checks current authority, Pause and
company policy before returning its saved outcome.

The company chooses autonomous, review, approval or blocked dispositions.
Unanswered policy and Pause refuse agent work. Approval pages show the saved
summary and require a named person's decision. Current people can continue to
use the native dashboard while agents are paused. Provider spending caps remain
unenforced; saving a cap does not impose a spending guarantee.

This MCP surface does not yet send or forward customer replies,
publish or edit articles, request connector work, change access or
connections, erase records, or activate procedures and routing. Those native
jobs remain in their existing authorized doors while their agent adapters are
completed. Device pairing, local process execution, connector claims/results,
imports and installation retain their separate native credentials and authority.


## Draft-only support preparation

The signed Business door also advertises these native tools. Each scope is the
exact tool name. Read tools classify returned protected content as sensitive in
addition to standard; saving an internal draft is a standard internal write.

| Tool | Access | Classes | Native boundary |
| --- | --- | --- | --- |
| `happytohelp.saved_replies.list` | Read | standard, sensitive | Native macro search, pagination and personal/role/group/brand visibility |
| `happytohelp.saved_replies.read` | Read | standard, sensitive | Current native macro head and readable fields |
| `happytohelp.settings.read` | Read | standard, sensitive | Current staff membership in the installation's linked project |
| `happytohelp.drafts.read` | Read | standard, sensitive | Current reply permission, available conversation and sponsor's own composer slot |
| `happytohelp.conversations.draft` | Internal write | standard | Current reply permission, native conversation revision and own draft version |

Settings reads require `project_id` to equal the installation's linked project.
They return only stored values from this allowlist: id, name, allowed_origin,
language, timezone, website, help_center_domain, widget_position,
default_responder, unavailable_message, presence_away_message, is_enabled,
collect_email, is_human_response_enabled, is_available,
is_availability_schedule_enabled, is_presence_away_enabled and
presence_idle_minutes. `availability_schedule` contains only days, time_from,
time_to and message. Missing values remain absent, as in native Settings.
The native Settings GET allows current staff to read; editing authority is
separate. This projection omits raw settings JSON, widget keys, notification
addresses, security/retention configuration, ticket/SLA/workflow configuration,
provider configuration and all secret connection fields. Those Settings areas
remain a gap in this tool, not a claim of complete Settings coverage.

Saving requires `id`, `content`, `draft_id` (null only for an empty slot),
`revision` and `last_message_id` from the current conversation, plus a unique
`idempotency_key`. Read `happytohelp.drafts.read` first and use its `usage_id` as
`draft_id` when replacing a draft. That opaque version also protects a draft
created by a native macro. A stale edit refuses; different sponsors have separate
slots. A successful write returns identifiers only. Read the content afresh with
`happytohelp.drafts.read` or the existing native staff composer. Retrying a prior
successful key returns its receipt without rolling back a newer edit. There are
no attachments in this tool. Saving never creates a message, queues mail or calls
a provider. Human Send remains an independent native action.

The minimal operator allowlist for finding a saved reply and preparing a known
case is:

- `happytohelp.conversations.read`
- `happytohelp.saved_replies.list`
- `happytohelp.saved_replies.read`
- `happytohelp.settings.read`
- `happytohelp.conversations.draft`
- `happytohelp.drafts.read`

Add `happytohelp.conversations.list` only if case discovery is required, or
`happytohelp.context.read` for additional customer context. These are scope names
for a future authorized integration; no operator is deployed or policy adopted
by the feature. Existing selected-resource connected-application grants receive
none of the new scopes. All tools pass through the shared signed-policy door.
An internal draft approval grants no send or publication scope.

Native customer erasure removes the owned drafts and cancels their pending
approval and review displays. Native teammate erasure removes that teammate’s
drafts and anonymizes their draft-operation attribution while preserving other
sponsors and approvers. Operational identifiers remain. Native exports retain
the draft content, ownership and opaque version; restoring them admits no send.
