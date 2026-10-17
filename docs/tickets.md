# Tickets

Tickets keep the conversation, customer, status, priority and operational fields together. The inbox uses these fields for filtering, sorting and bulk work. Workspace permissions apply to every ticket change.

## Status and what customers see

Each ticket has a status. The built-in statuses are **New**, **Open**, **Pending**, **On-hold**, **Solved** and **Closed**. A workspace lead can add statuses and place each one in the `new`, `open`, `pending`, `on_hold`, `solved` or `closed` lifecycle category, so custom labels keep the same behavior as their category.

New, Open, Pending and On-hold are active states. Pending means the team is waiting for the customer; On-hold means it is waiting on an internal team or another party. These internal distinctions do not expose a private status label to customers: the customer-facing API used by the widget presents these four states as **Open**, and Solved and Closed as **Solved**. The customer portal uses the same mapping. A customer reply to a Pending or On-hold ticket returns it to Open and wakes its owner. A reply to a Solved ticket reopens it.

Closed is the final status category: a Closed ticket cannot be reopened, edited or replied to. A customer's email reply or widget choice addressed to a Closed ticket is never refused. The sender is recognized exactly as on an open ticket, including through the reply address the ticket's email gave them, and each such reply opens a new ticket for that same customer, never joining another ticket of theirs. A teammate's email reply to a Closed ticket is refused instead: the Email Worker bounces it with the reason, and through SendGrid or the mail gateway the teammate gets an email notice. Nothing is stored, and no contact is made from their address; they answer from the dashboard. Automatic closing after a configured period and creation of linked follow-up tickets are later workflow capabilities; this release does not claim either behavior.

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
