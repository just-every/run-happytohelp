# Working in your workspace

## Operate multiple brands

Use one workspace per brand. Create each from the Projects list, then set its
website, widget identity and help-center context URL in Project settings and its
sender, mailboxes and signatures in Email settings. Invite each shared teammate
to each brand separately; creating a brand never copies memberships. Publish
routing rules and change availability or collection policies within that brand.
Use deployment configuration `PUBLIC_HELP_HOSTS` to map each owned help-center hostname to that brand's project ID or public alias; DNS and TLS remain deployment prerequisites. The Project settings context URL alone never installs a host alias.
Switch workspaces before configuring or answering its tickets. A customer's
same email in two brands remains two identities; private knowledge and mailbox
credentials stay with their own workspace. Customer handoffs do not transfer
records or grant access to the destination.

An owner or admin can review an explicit selection through
`GET /api/management/projects/:id/brands?projects=:id,:otherId`. It lists the
selected brands' public identities, configured help hosts, mailbox names, policies and currently shared
teammates, with links to each brand's settings and members. Every selected brand
requires current administration access; it returns no credentials or customer
records. Invite staff using the ordinary Members screen in each brand.

Reports stay available in each brand's Reports screen. A shared member with
report permission in every selected brand can read
`GET /api/management/projects/:id/brands/reports?projects=:id,:otherId&period=7`.
This explicitly selected aggregate adds counts and computes rates from their
underlying counts. Each brand keeps its calendar timezone. Customer comments,
identities and cross-brand medians are excluded; removing membership ends access
immediately. Use each brand's own report door for exports.

## Bring existing history

An owner or admin opens **Settings → Move in existing support history** or the
optional Setup page link. Upload documented source files for conversations,
contacts, conversation tags, saved replies and articles. Review the plan counts,
source-located omissions/rejections, native conflicts and articles that will be
published before **Approve and import**. Background batches preserve committed
progress. Resolve a reported issue and choose **Resume import**, then inspect the
report and its record links. Current owner/admin session and membership are
rechecked for each batch. Other workspaces and reviewers cannot inspect private
original files, plans or reports.

Exact repeat imports report already imported decisions; changed source or native
records cause review conflicts. **Undo whole import** reverses unchanged created
records in reverse dependency order; later native edits or references are retained
as conflicts. Source files and provenance remain in private custody. The 9 October owner ruling requires exact business-state repeat/undo equality,
including private notes and source links. Platform counters/sequences, audit and
import journals are excluded. Only the derived contact-key email digest may be
memoized; native email and project/contact links remain exact and validated.

Imports retain source IDs and timestamps, public messages/private notes, and draft or
published article state. They create no trusted staff access or automation consent
and send no mail, widget, model, assignment or connection effects. Imports are
excluded from Reports. Conversation **Tags** lets you add/remove unique workspace
tags; inbox rows show them and the tag filter stays in the current workspace.
See [moving in](moving-in.md) for file limits, format supplements, erasure and
conflict/resume details. Evidence is documented-format and synthetic-only;
**realExport: not-supplied**.

## Resolve, collect feedback and reopen

Resolve a conversation through the normal operator controls. The owning visitor
session sees **Did this answer your question?**, thumbs up/down and an optional
comment of at most 1,000 characters. One latest rating belongs to each resolution;
changing it appends history. The widget action rate limit applies. Another visitor
session cannot submit feedback.
Operators can inspect prior resolution feedback after reopening. Contact erasure
removes comments.

Stored native provenance determines outcomes: **AI** needs complete visible AI
answer history with no person handoff; **assisted** records a confirmed operator
reply drafted by AI or a paired local agent; **human** records confirmed authored
operator replies; missing or API-automation provenance is **unknown**. These labels
come from write-time records, without a classification model request. A new visitor
message reopens the cycle; resolving again records a separate outcome and rating
eligibility. Reopened conversations leave current closed-cycle rate denominators.

## Continue a conversation by email

Customers, recipients and teammates reply to a notification's reply address; keep
that full address when replying. It is issued to its recipient, so a reply from that
address joins the conversation as them. A customer's preferred notification address
counts as the customer only through the reply address issued to it.

The sender is the email's From address. It is verified when DKIM aligns with its
domain, DMARC passes for it, or SPF passes for an aligned envelope domain (Cloudflare
Email Routing's own verdict, or SendGrid's); an unverified sender is still accepted
and labelled **unverified sender** on the message. An unverified From that names a
widget-verified customer, or that the provider reported as failing, starts its own
conversation marked **Unverified sender**: it never joins that customer's threads,
and replies to it go only to the address it came from. The envelope sender, which
SendGrid bounce addresses and Google Workspace forwarding rewrite, is never the
contact. Reply-To is only where replies go, and never replaces a widget-verified
customer's preferred address.

Mail whose From names no usable address (missing, a name only, `<>`, several
addresses) has no author to check: it starts its own **Unverified sender**
conversation under its envelope sender, joins a thread only through the reply
address issued to that sender, and nobody is emailed automatically; add a recipient
or a preferred address to answer it. Mail reaches only a customer whose address is
proven: one who first wrote by email, or a widget visitor whose signed identifier is
that address. An address a visitor only typed into the widget receives
notifications, and an answer through a notification's reply address continues the
chat; any other mail from it starts that address's own email conversation and never
appears in the widget.

No ordinary email is bounced. Mail to the bare support mailbox, or from someone who
is not a current recipient of the addressed thread, continues that sender's most
recently active open conversation or starts one. CC addresses become recipients when
the sender is verified or used their own reply address; otherwise they are skipped.
Replies notify the other recipients, excluding the sender. Removing a recipient or
teammate removes their reply authority; their later mail starts their own
conversation.

Visible replies omit conventional quoted history and signatures. **Original email**
retains the original text in the inbox. Replies and emailed transcripts carry rich
text, inline images and files, up to 8 MiB per file and 20 MiB encoded content. A
larger or unavailable file is left out and named in the email with a link to open it. **Ticket → Customer → Contact actions →
Email conversation** sends the latest customer conversation segment, excluding
automated messages, with its conversation reply address. Reopening or retrying a
transcript keeps the same request and revision. Provider acceptance is distinct
from delivery; an uncertain send is never automatically replayed. Local development
suppresses mail without storing or sending it.

## Read Reports

Reports uses the workspace's IANA timezone (UTC by default). Select 7, 30 or 90
days, or custom dates spanning 1–366 days; the start is inclusive and end exclusive.
The cohort is native conversations created within that workspace-calendar range.
Move in and legacy imports are explicitly excluded. Reports displays volume,
median and nearest-rank p90 from the first visitor message to first visible reply,
and creation to first known resolution, with sample counts for missing evidence.
Historical uncertain durations remain absent rather than zero.

AI resolution rate is AI outcomes divided by currently resolved conversations.
Customer satisfaction (CSAT) is thumbs up divided by rated closed resolutions,
with the rated count shown. Each conversation contributes its latest closed cycle
once; unknown outcomes do not become AI. The daily series uses creation dates in
the selected timezone. The latest ten comments link to their conversations.

Download conversation CSV for IDs, UTC creation/reply/resolution times, durations,
status, outcome, rating and comment; summary CSV contains aggregates and daily
series. Formula-leading `=`, `+`, `-`, `@` cells are neutralized. Export scope
matches the selected cohort and excludes imports. Reading Reports calls no model.

## Connect tools

A workspace owner/admin creates a named token in **Settings → API tokens**, with
only the needed scopes: `conversations:read`, `conversations:write`,
`messages:write`, `contacts:read`, `contacts:write`, `articles:read`,
`articles:write`. Copy the secret once; only its hash is stored. Optional expiry,
revocation, last use and audit are visible in Settings. Workspace grants outlive
the issuing person's membership; revoke unwanted tokens explicitly. The thirteen
[Bearer API operations](api.md) use current native authority, per-token limits,
ISO dates, cursor lists and JSON errors; cookies grant no access and no CORS is
provided. Revoked/expired/wrong-scope credentials are refused; foreign IDs reveal
no other workspace's existence.

**Webhooks** selects `conversation.created`, `message.created`,
`conversation.resolved`, `conversation.rated`. Copy the signing secret once and
verify exact bytes, tenant, destination, freshness and replay identity at the
receiver. Deliveries use ordinary platform HTTPS fetch with manual redirects. Every 3xx fails without following its Location. Requests are limited to 1 MiB, responses (including streams) to 64 KiB, and the entire request/response to 10 seconds. Public HTTPS destination syntax and literal IP validation remain enforced; this edition does not claim DNS pinning. Base HTTP 500 remains uncertain without automatic replay; 429 retains four bounded attempts with the same logical identity and exact body. **Send test** is explicit; logs show event, status, duration and a safe error class.

**Slack** accepts either an incoming webhook or a bot token plus channel ID. It
uses Base escaping and posts once per new native conversation after its first
visitor message. Use explicit test sends and inspect safe logs. Existing evidence
uses recorded responses for both modes; **live Slack: not-supplied**. Import and
undo generate no connection notifications. Erasure suppresses pending payloads;
it cannot withdraw a message already accepted by a receiver.

## Start a local trial

Follow [README](../README.md#run-it-on-your-computer). Password login is retained.
Setup opens on a workspace that is already set up: its Setup page lists only what
the owner must do (the widget, an AI key, sending-domain DNS), each of which can be skipped for now, and the system runs its
own checks. Creating the workspace may send the owner one welcome email; local
mail is suppressed without storage or external sending. A new workspace leads
with the widget snippet and keeps secrets/verification under Advanced. Workspace headers show the
current workspace and visitor agent headers intentionally show the operator's
display name. Open the private `RER_OPEN` address for automatic local owner
entry. Visitor and teammate email is suppressed without storage or external
sending by the rer dev v2 development transport. Without configured hosted mail,
email links are unavailable with a plain explanation and the widget promises no email reply.
Stop the installer or dev terminal with Ctrl+C; closing a browser leaves it running.
