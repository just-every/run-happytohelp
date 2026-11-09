# Personal data in HappyToHelp

This page is for whoever runs a HappyToHelp installation: you and your team, the
people who deploy it and answer customers with it. It explains what HappyToHelp
stores about your customers, what it sends to other services, and how to erase or
hand over one customer's data when they ask.

This page describes what the code does. It is not a privacy policy for your
customers, and it is not legal advice.

A few words used on this page: a **workspace** is one support space with its own
inbox, widget and team (the API calls it a *project*, so paths below say
`projectId`); **owners**, **admins** and **operators** are the roles on a
workspace's team (the dashboard shows the operator role as **Agent**).

## The short version

- Everything is stored in your own Cloudflare account. HappyToHelp has no central
  service that receives your customers' data.
- Data leaves your account only through the providers you configure, such as an
  AI model or an email service.
- Customer data is kept until someone erases it. Nothing deletes it on a schedule,
  apart from the few exceptions in [How long data is kept](#how-long-data-is-kept).
- To remove a customer's personal data, use **Erase personal data…**, not
  **Delete**. **Delete** only hides and blocks the contact.
- Erase contacts **before** you delete a workspace. Once a workspace is deleted,
  nobody can sign in to erase them.

## Where your data is stored

Everything on this page is stored in the installation's own Cloudflare account, in
two places:

- **D1**, Cloudflare's database (the Worker reaches it through the `DB` binding):
  accounts, workspaces, contacts, conversations, messages, customer context, and AI
  and email records.
- **R2**, Cloudflare's file storage (the `FILES` binding): uploaded files, namely
  conversation attachments, attachments on inbound email, screenshots from paired
  computers, brand images and files staged while importing knowledge.

Your own accounts, and those of your teammates, are stored in the same database:
name, email, password hash, sessions and settings.

## What HappyToHelp stores about each customer

HappyToHelp calls each customer a **contact**. The tables below list everything it
keeps about a contact, which D1 table holds it, and when it is collected. Table
names are given so you can find the data yourself if you need to.

### Identity and conversations

| What | Stored in | When it is collected |
| --- | --- | --- |
| Name, email and verified identifier (`external_id`, the ID your site passes when it verifies a visitor) | `contacts` | Your site or the widget supplies them, the contact edits them in the widget, an inbound email arrives, or an operator enters them. |
| The name and email the contact typed, phone, block state/date, last seen, widget open state, browser timezone/language, request-observed IP/country/user agent, and signed business details | `contacts.metadata_json` | Widget sessions and presence events, and operator edits. |
| Widget sessions | `sessions` (a hash of the session token, with a 30-day expiry) | Each widget session. |
| Messages | `messages` | Every message in a conversation, including replies from operators and the AI. |
| Attachments | Rows in `media`, with the files in R2 | Uploads from the widget, the dashboard and inbound email. |
| Internal notes, conversation participants and read state | `conversation_notes`, `conversation_participants`, `conversation_reads`, `context_tracked_events` | Operator actions and widget read receipts. |

Assignment changes retain the server-authored target and actor in
`context_tracked_events`. Teammate email intents retain message IDs,
recipient user IDs and revision frontiers in `operator_notification_activity` and
`operator_notifications`; message text and addresses remain in their existing
source tables. Provider attempt identity prevents uncertain sends being replayed.

### Activity and customer context

**Customer context** is the feature that builds a picture of a contact (evidence,
profiles, insights and summaries) from their messages and activity. The work is done
by the **context model**, the AI model you name in `CONTEXT_MODEL`. Page visits and
widget activity are stored only once the contact's consent is recorded in
`context_subjects.consent`, either through the customer-context API
(`PUT /api/customer-context/{projectId}/{subjectId}/consent`) or by a legacy import.

| What | Stored in | When it is collected |
| --- | --- | --- |
| Page visits | `context_tracked_events` (`PAGE_VIEW` URLs) | The widget sends them when contact tracking is on for the workspace. They are stored only if the contact's consent is recorded. |
| Widget activity | `context_actions` | The same consent rule applies, and the bot must also be enabled for the contact. Once a context model has analysed the activity, it is summarised and the raw records are deleted. |
| Evidence, profiles, insights, activity summaries and context jobs | The `context_*` tables | Built by the context model from the messages and activity above. |

### AI, email and delegated work

| What | Stored in | When it is collected |
| --- | --- | --- |
| AI generations | `ai_generations` (the instructions, the generated text, and in `options_json` the operator's draft and any instructions they gave the drafting assistant), `ai_attempt_events` (provider event logs) and `ai_round_usage` (token usage only) | AI replies, suggestions and draft assist. |
| Delegated work | `local_jobs`, `local_events`, `local_attachments` | When an operator sends a conversation to a paired computer (see [Local agent](../local-agent/README.md)). |
| Email delivery log | `email_deliveries` (recipient, subject and delivery state; no message body) | Notification and transcript emails. |
| Inbound email evidence | `inbound_emails.evidence_json` (envelope sender, header From, subject and a fixed set of headers; the body itself becomes a message) | Each inbound email, so HappyToHelp can tell automatic mail from mail a person sent. |

### Request counters and imports

| What | Stored in | When it is collected |
| --- | --- | --- |
| Request counters | `abuse_counters` (the limit's name, a SHA-256 hash of what is being limited, such as a visitor ID, conversation ID, client address or account ID, and a count; never the raw address) | Visitor, registration and workspace-creation requests. The scheduled job removes each counter once its window ends, which is at most one day. See [Limits and AI ceilings](PUBLIC-LIMITS.md). |
| Imported conversation buckets | `conversation_buckets.metadata_json` (the original bucket record, including any conversation summary) | Only if you [imported data from the original HappyToHelp service](../OPERATIONS.md#import-data-from-the-original-happytohelp-service). |
| Legacy import archive | `legacy_import_rows` (the source rows exactly as imported) | Only if you imported data from the original HappyToHelp service. |

## What is sent to outside services

Nothing is sent to a provider unless you set its credentials. Each provider keeps
what it receives under its own terms.

- **AI models** (OpenAI, Anthropic, Google, DeepSeek, xAI or OpenRouter, chosen per
  AI profile): to draft replies and suggestions, HappyToHelp sends the conversation
  transcript, the contact's name and email, internal notes, customer-context
  evidence (when consent is recorded), and whatever knowledge or conversation
  history the AI's tools look up.
- **Context model** (`CONTEXT_MODEL`): the contact's messages, widget activity,
  evidence and existing profiles, to build profiles, summaries and insights.
- **Semantic knowledge search** (OpenAI embeddings and `QDRANT_URL`): search
  queries, which may contain text from a conversation. What gets indexed is your
  published knowledge, not customer data.
- **GitHub** (when repositories are connected): searches the AI makes in your
  repositories, which may contain text from a conversation.
- **Email** (`EMAIL_PROVIDER`: Resend, Cloudflare Email or SendGrid):
  - reply notifications to contacts include the message text
  - notifications to operators include the customer's message
  - transcript emails include the whole transcript

  Inbound email arrives through the mailbox you configure. See
  [Email and integrations](../src/modules/integrations/README.md).
- **Paired computers**: when an operator delegates a conversation, HappyToHelp sends
  the transcript, the contact's name and email, and internal notes to that
  operator's own paired computer. The agent running there may pass it on to its own
  model provider.

Erasing a contact in HappyToHelp does not reach copies a provider already holds or
anything already sent by email.

## How long data is kept

HappyToHelp does not delete customer data on a schedule. Records stay until an
owner or admin erases them. There are two exceptions:

- Raw widget activity is replaced by summaries once a context model has analysed it.
- Widget sessions stop working after 30 days. The session row stays until the
  contact is erased.

Request counters are also short-lived; see the table above.

## Before you delete a contact or a workspace

**Deleting a contact does not erase it.** The **Delete** button on a contact only
hides and blocks it. It does not remove any personal data. To remove personal data,
[erase the contact](#erase-a-contacts-personal-data) instead.

**Erase contacts before you delete a workspace.** Deleting a workspace keeps its history
(HappyToHelp calls this "retained history"), blocks its contacts and removes every
membership. After that, nobody can sign in to erase those contacts. If you have
already deleted the workspace, you have to remove the data directly from your D1
database and R2 bucket.

## Erase a contact's personal data

Only the **owners** and **admins** of the contact's workspace can erase a contact.
**Agents** and **collaborators** cannot. Erasing asks you to confirm it is you if you
have not done so in the last 15 minutes (see [Account security](account-security.md)),
and each erasure is written to the workspace's security log.

**In the dashboard:**

1. Go to **Contacts** and select the contact.
2. Choose **Erase personal data…**.
3. Type `ERASE` to confirm.
4. Choose **Permanently erase**.

**With the API:** send
`POST /api/management/projects/{projectId}/contacts/{contactId}/erase` with an owner
or admin session. The response is the erasure record described in
[What is kept](#what-is-kept).

**One erasure at a time.** A contact is erased by one request at a time. If you send
the request again while that contact's erasure is still running (for example after
your connection dropped), the new request waits up to 30 seconds for it and then
answers `409` with a `Retry-After` header; it changes nothing. Send it again after
that many seconds: once the first erasure has completed, the request answers `200`
with the same erasure record (the same `erased_at`; `runs` and `last_erased_at`
advance) and changes nothing else but the security log and a repeated deletion request
to connected services. The same `409` answers while a legacy import update (a delta
sweep) is being applied to the workspace. Erasing different contacts never waits. If an
erasure stops part-way (the request was cancelled or the server stopped), send it again:
it completes the erasure, at the latest once the stopped one's one-minute hold expires.
Until a stopped erasure is completed, legacy import updates treat the contact as erased.

### What is removed

Erasure works only inside the contact's own workspace. It removes:

- the contact's name, email, identifier, verified flag and all metadata
- its widget sessions
- the content of every message in its conversations (customer, operator and AI
  messages), and of any message it wrote elsewhere in the workspace
- each of those messages' client-supplied local ID, which becomes
  `erased:<message ID>`. Two IDs are kept: the hashed `email:` ID of an
  inbound email, and the `generation:` ID that links an AI reply to its kept
  generation record. Neither can hold text a visitor or operator chose, because the
  email ID is a hash and a reply request's ID must be a UUID.
- attachments in its conversations, on those messages or uploaded by the contact,
  including the files in R2, and screenshots from delegated work on those
  conversations
- page visits, widget activity, evidence, profiles, insights, summaries, context
  jobs and their provider logs
- internal notes on its conversations, and its participant and read records
- for its conversations: AI instructions, the operator drafts and assist
  instructions sent with them, generated text and provider event logs. Token usage,
  the editing tool and request IDs are kept. Queued or running AI replies are
  cancelled.
- imported bucket summaries for its conversations (bucket IDs and times are kept)
- delegated-work instructions, context, results and progress for its conversations.
  Active delegated work is cancelled.
- its address in the email delivery log
- inbound email evidence (sender, subject and headers) on its conversations and
  messages, or sent from its addresses. Only the names of the reasons the
  automatic-mail classifier gave are kept.
- the verbatim legacy import copy of those records. The row digest is kept, so
  importing the same bundle again does not bring them back.

### What is kept

- The contact row, with only an ID and an "erased" flag.
- The conversations: IDs, timestamps, assignment and status.
- Each message's ID, author role, revision and time, with the content removed and
  the message marked erased. This keeps conversation counts and transcript order
  intact for operators.
- An erasure record in `contact_erasures`: who erased the contact, when, how many
  times, and how many conversations, messages, attachments, tracked events, context
  records and sessions were removed.
- Request counters. They hold only a count under a SHA-256 key (no name, email,
  address or content), and they expire within a day.
- Daily AI ceiling counters, which are kept per workspace or per installation, not per
  contact.

### Running it again

Erasing the same contact again is safe. It removes anything added since, for
example an operator reply sent after the erasure, and adds to the counts in the
erasure record.

If an erasure stops partway through, run it again to finish it. Files waiting to be
deleted are listed in `contact_erasure_objects` until the database changes are
committed, so a repeat run picks them up.

### Connected providers

After the local erasure commits, HappyToHelp asks each connected service to delete
what it holds, as far as that service allows, and the contact page shows each
request and its outcome under **Erasure record**, with completed, waiting, failed
and cannot-delete counts:

- **Webhooks**: every enabled webhook receives a signed `contact.erased` event with
  the contact's HappyToHelp ID and your own external ID for them (no name, email or
  message text), whatever events it subscribes to. The request is complete when your
  endpoint answers with success. A lost answer stays unknown and is never resent
  automatically; resend it from **Settings → Delivery log**.
- **Slack**: messages already posted are not recalled. Delete them in Slack.
- **Your email provider**: mail already sent stays in the recipients' mailboxes, and
  the provider keeps its own delivery logs for its retention period.
- **Your AI provider**: conversation text sent for answers stays under that
  provider's retention policy.
- **Paired computers**: files downloaded for delegated work stay on the computer.

Erasing again sends a new request to each webhook; the latest request's outcome
is the one shown.

### What erasure cannot reach

- Cloudflare's own backups: D1 Time Travel keeps up to 30 days of history.
- Anything already sent to a provider, an email inbox or a paired computer. Only
  webhooks receive a deletion request they can act on, as described above.

## Give a customer a copy of their data

When a customer asks for a copy of their data (an access request), there is no
single-click export. Any member of the contact's workspace can put one together:

1. Read the contact record:
   `GET /api/management/projects/{projectId}/contacts/{contactId}`
2. Find the contact's conversations. Search matches name or email:
   `GET /api/dashboard/projects/{projectId}/conversations?view=all&q={email}`
3. Read each conversation's transcript, with attachment details:
   `GET /api/conversations/{conversationId}/messages`
4. Download each attachment:
   `GET /api/conversations/{conversationId}/media/{mediaId}`

Two other ways to get the data:

- **Email a transcript** from the conversation's contact menu (**Email conversation**).
- **Query D1 directly** with `wrangler d1 execute`, filtering on the contact's
  `project_id` and `id`/`subject_id` in the tables listed above, or take a full
  private copy with `node scripts/export-d1.mjs --remote --output private-backup.sql`.
  Follow [Back up your data](INDEPENDENT-RELEASE.md#back-up-your-data) to select
  the database/configuration and stop writers throughout the export and search
  rebuild. This copy contains every workspace's data; keep it private.
