# Ticket notification interface

`notifyTicketEvent(env, event)` from `integrations/triggers.ts` is the post-commit
entry for R5 rules, R6 inbound and native writers. The caller must first commit an
authorized native ticket change. Do not call for preview or import operations.

```
{ projectId, conversationId,
  event: 'request_received' | 'ticket_solved' | 'customer_updated' | 'ticket_updated' |
         'assignment' | 'group' | 'follower' | 'mention',
  eventId, actorId?, recipientIds?,
  source?: 'native' | 'import' | 'merge' | 'isolated', expectedReplyTime? }
```

`eventId` is the stable committed message, note or mutation identity, not a fresh
UUID on retry. For request_received specifically, eventId is the first persisted
customer message's ID; a later reply to old history cannot acknowledge it as new.
Assignment/follower/mention name their recipients. Group selects
the current unassigned group, and customer_updated selects assignee, followers and
the unassigned group. ticket_updated selects followers on other ticket changes;
mention also selects followers, preferring mention for a person in both lists.
Self notices are suppressed. Existing assignment statements
and dispatch already enter this API; do not call a second assignment hook.
Existing notifyMessage dispatches both received and customer_updated for contacts
and ticket_updated for public operator replies.
Assignee customer-update email stays in the existing coalesced unread digest;
its new personal customer_updated email preference also gates that digest.

Received and solved each claim once per ticket, not once per resolution cycle.
Imported, machine and isolated tickets are excluded using current stored provenance
in addition to caller source. A customer CC is notified only when it is a current
participant proven independently of the Cc header that named it
(`participant-proof.ts`): an operator added it, it has written to the ticket itself
(authenticated mail or its issued reply address), it is a widget-signed identity, or
it has itself sent authenticated mail to the workspace. Each participant records
how it joined (`joined_via`: `cc_header`, `operator`, `self`); a Cc header alone
never makes an address proven, so a sender cannot have the desk mail third parties.
A widget's own contact remains a notification destination without becoming a
proven inbound identity. Automatic notices resolve the canonical address, never
a Reply-To or collector preference. `provided_email_source` records `reply_to`,
`widget` or `operator`; only an `operator` preference can override the canonical
address. Unmarked historical preferences cannot override it. Signed business
metadata cannot introduce or replace that provenance. Operator replies keep their
existing preference behavior. All recipients are deduplicated by address. The claim
freezes the recipient set before the provider batch; a claimed/uncertain result
never reconstructs recipients or sends again. Reconciliation is explicit outside
this automatic interface. No application substitute for a missing provider exists.

Templates share MACRO-001's renderPlaceholders syntax and fallback values.
`expected_reply_time` is available in addition to requester, ticket, brand,
assignee and public custom ticket fields. Customer templates never read private
role-restricted field values. Missing values create a template_error outcome,
visible in settings, with no mail. Scope overrides support channel and current
workspace brand, then wildcard defaults. Push and Slack/Teams belong to R11.

Mount `notificationRoutes` under `/api/management`. Its GET/PUT
`projects/:projectId/notification-triggers` is settings authority (GET also gives
outcomes); GET/PUT `notification-preferences`, GET `notification-inbox` and PUT
`notification-inbox/:id/read` are the current member's own resources. Register
PUT triggers as settings.manage and other PUT doors as self. No body user ID is
accepted. Current membership and contact privacy govern every read and send.
`notificationErasureStatements(env, projectId, contactId)` redacts claim outcomes
while retaining receipt identity (erasing a CC must never unlock another
acknowledgement), deletes affected inbox rows, and returns the
`notificationErasureCount` statements for parent contact-erasure composition.

## Explicit workflow notices (R5)

`sendTicketNotification(env, {projectId, conversationId, eventId,
audience: 'requester' | 'assignee' | 'group' | 'followers',
template: {subject, body}, actorId?, source?, expectedReplyTime?})` sends a
post-commit workflow action. It is exported from `triggers.ts`. The source values
and template syntax match the event API. Supply a committed stable action ID;
that ID and audience claim separately from the default once-per-ticket triggers.
Requester means requester plus independently proven customer CCs, as above. Assignee, unassigned group
and follower recipients must currently belong to the workspace; personal
customer_updated, group and follower preferences govern their respective inbox
and email channels. The actor receives no self notice. Templates see the same
public template context as default customer notices, so role-private fields are
never implicitly disclosed by a workflow.

The result is suppressed, no_recipient, not_configured, template_error, claimed,
complete, failed or uncertain, with deliveries where available. A claimed send
never retries itself, including an uncertain one. `not_configured` has made no
provider attempt, so the caller can hold its decision rather than pretending the
notice was sent. Rules, sandbox preview, scheduling and decisions remain R5's
responsibility; this function never invokes those mechanisms.
