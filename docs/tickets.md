# Tickets

Tickets keep the conversation, customer, status, priority and operational fields together. The inbox uses these fields for filtering, sorting and bulk work. Workspace permissions apply to every ticket change.

## Status and what customers see

Each ticket has a status. The built-in statuses are **New**, **Open**, **Pending**, **On-hold**, **Solved** and **Closed**. A workspace lead can add statuses and place each one in the `new`, `open`, `pending`, `on_hold`, `solved` or `closed` lifecycle category, so custom labels keep the same behavior as their category.

New, Open, Pending and On-hold are active states. Pending means the team is waiting for the customer; On-hold means it is waiting on an internal team or another party. These internal distinctions do not expose a private status label to customers: the customer-facing API used by the widget presents these four states as **Open**, and Solved and Closed as **Solved**. The customer portal uses the same mapping. A customer reply to a Pending or On-hold ticket returns it to Open and wakes its owner. A reply to a Solved ticket reopens it.

Closed is the final status category: a Closed ticket cannot be reopened, edited or replied to. A customer's reply, email or widget choice addressed to a Closed ticket is never refused. The sender is recognized exactly as on an open ticket, including through the reply address the ticket's email gave them, and each such reply opens a linked follow-up ticket for that same customer with the original's requester, CCs, tags and fields, never joining another ticket of theirs; the original stays Closed. A teammate's email reply to a Closed ticket is refused instead: the Email Worker bounces it with the reason, and through SendGrid or the mail gateway the teammate gets an email notice. Nothing is stored, and no contact is made from their address; they answer from the dashboard. By default a Solved ticket closes after four days; a workspace lead can pause or change that rule under **Business hours and workflows**.

## Priority and custom fields

Every ticket has one of four priorities: **Low**, **Normal**, **High** or **Urgent**. Leads can define workspace custom fields in eight types: text, whole number, decimal, date, dropdown, multi-select, checkbox and regex-validated text. Fields can be required to solve: a ticket moves into Solved or Closed, by any door including a reply that solves it, only once every required field the person may edit has a value. Tags, assignment and other edits never wait on an empty required field, and clearing a required field is refused. Number and decimal fields can have minimum and maximum bounds, which the server validates. The Workspace API permission controls access by scoped bearer tokens; tokens do not inherit owner-only field access. Field visibility and editing follow the workspace's read-role and write-role settings. Values belong to the ticket and can be read or changed only through an authorized workspace action. [Customer request forms](request-forms.md) supply values using these same field definitions.

## Groups and membership

Groups let a workspace organize operators around a support function. Manage groups and memberships in **Settings → Tickets**. A lead can assign a ticket to a group and, where appropriate, to an individual operator. Group assignment records the destination; it does not promise automatic routing, capacity balancing or round-robin assignment. Membership and ticket access are checked against the current actor and workspace on every operation.

## Saved inbox views

Save a view from the inbox with ticket filters and sort order. Personal views are available to their owner; shared views are available to permitted workspace members. Filters can use ticket status, priority, group, assignee, tags and custom fields. Sorting uses supported ticket fields and an explicit direction. A saved view stores its definition, not a snapshot of tickets, so it reflects current ticket data when opened.

## Bulk changes

Select tickets and preview a bulk assignment, tag, priority or status change before applying it. Each ticket is checked again when the change is committed. The result identifies each ticket as changed or refused and gives a reason for refusals, so a stale or unauthorized record does not hide the outcome for the rest of the selection. Bulk operations do not send customer replies. Applying action macros in bulk is part of the separate macro capability.

## API fields

Ticket records are returned by the conversation API with their status ID and category, priority, subject, channel, `brand_id` (the workspace), `group_id`, `requester_id`, `submitter_id`, `submitter_type` (`contact`, `agent` or `system`), assignee, tags, visible custom-field values, timestamps and `ticket_version`. Read and update tickets with the existing `conversations:read` and `conversations:write` scopes. Read available definitions with `GET /api/v1/ticket-fields`, `/api/v1/ticket-statuses` and `/api/v1/ticket-groups`. Update a ticket with `PATCH /api/v1/conversations/:id`; custom-field values are keyed by the workspace field identifier and validated against its definition. Writes use the same workspace permissions and stale-version protection as inbox changes. A denied or stale update returns an error instead of silently skipping the field.

Personal and shared views use `GET`, `POST`, `PUT` and `DELETE /api/dashboard/projects/:projectId/ticket-views`. Leads preview and apply changes with `POST /api/dashboard/projects/:projectId/tickets/bulk/preview` and `/apply`. The preview reports eligible and refused records before commit; the apply response reports each record's result. These dashboard routes use the signed-in workspace session and enforce current permissions.

The conversation API's existing messages and contact operations remain documented in [Workspace API](api.md).

## Handle time

From a ticket, choose **+ (Actions) → Start timer** while working, and **Stop timer** there when you finish. **Ticket → Handle time** shows your total and the ticket's, and corrects completed sessions. Solving or closing the ticket stops every operator's running timer, including when a rule or bulk action solves it. Reopening a ticket lets you start another session.

Choose **Adjust completed time** to correct a stopped session. Enter the corrected duration and a reason. Operators can correct their own sessions; permitted leads can correct a teammate's. Original timestamps and corrections stay in ticket history and the security log. The [team report](reports.md#team-report) adds these sessions using the workspace's calendar range.

## Problems and incidents

For an issue affecting several customers, mark its tracking ticket as a **Problem** with **+ (Actions) → Mark as problem…**, which opens **Ticket → Problem and incidents**. Search for affected tickets and preview their links, or select tickets in the inbox and choose a problem in the bulk-link control. Each incident keeps its own customer, conversation, SLA and rating. A problem lists its linked incidents, customers and count; large lists have page controls. Preview an unlink before removing a ticket that belongs elsewhere. Link changes are recorded in both tickets' history and the security log.

In the problem, compose a public update and preview it before sending. Placeholders such as `{{contact.name}}` and `{{agent.name}}` are expanded separately for every requester; unresolved placeholders block that ticket. Review each rendered reply, channel and recipient. Choose whether to solve the incidents or send an update that leaves them open. The problem itself is solved after this operation. You can also solve the problem through the ordinary status control without sending an incident update.

Email replies go only to each incident's requester, through that incident's connected mailbox when present. Widget replies appear in that incident's own conversation and do not send an extra email. Opted-out email recipients, unavailable requesters, disconnected mailboxes, unsupported channels and changed tickets are reported with a reason. Unsupported channels wait for their own transport; an email address does not turn another channel into email.

Each ticket has a separate result. A failed or uncertain send leaves the incident open. The result remains readable after reloading; repeating the same operation does not resend its replies. A new customer message, changed requester, changed link or permission loss invalidates the reviewed ticket before delivery. For more than 100 incidents, review and send explicit batches from the incident pages. Ticket history and the security log record links, admitted replies and confirmed bulk solves. Export/import preserves the relationship history while preventing old previews or uncertain sends from restarting.

### Engineering context on a problem

A Problem keeps the ticket's existing engineering links. Use Engineering to
preview chosen messages and files, then create or link the issue. The Problem
API also returns `engineering_issues` with provider status, assignee, last
observed time, provider update time and connection state. Disconnected context
is marked stale and never presented as a fresh provider read. A signed shipped
fix creates a draft for operator approval; it does not prove customer recovery
or send to the linked incidents. Preview an incident update separately to
render and approve each requester's reply. SMS and expired messaging windows
remain unavailable until a supported, consented channel is connected.

## Create tickets and service notices

In the inbox, **New ticket** searches existing requesters by name, email or phone,
or accepts a new email contact inline. Choose the workspace brand, connected
mailbox and sender, form, typed fields, group and assignee before creating the
ticket. A selected form enforces its required and conditional fields. The customer
remains the requester and the current teammate is recorded as submitter.

Choose **Internal first comment**, **Log a call** or **Log a walk-in** to record
private notes without sending a message. A new outbound email still has its own
threading reference and immutable sender, CC and BCC choices.

**Service notice to several requesters** accepts up to ten existing contacts. It
is for a concrete support update, never marketing. Preview shows the exact
message and each recipient's eligibility; confirm creates a separate ticket for
each eligible requester and records its delivery outcome. This interim consent
default requires the customer to explicitly enable update emails in their portal
preferences. Missing consent and opt-outs are blocked. New tickets use the
workspace's and contact's conversation rate limits. Previews expire after fifteen
minutes, and requester changes or permission revocation require a fresh review.
**Refresh outcomes** checks the same command: it never resends a failed or
uncertain delivery. Pending or sending means the outcome has not been confirmed.
Email provider receipt, customer-mailbox delivery and messaging-provider sandbox
qualification remain separate checks.
