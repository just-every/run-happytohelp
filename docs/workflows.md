# Business hours and ticket workflows

Use **Settings → Workflows** to define business hours, response commitments,
rules and automatic assignment for the current workspace. Owners and admins
with settings permission can change these settings. Operators see the resulting
SLA clocks, alerts and workflow history on the tickets they can access.

## Business hours

In **Business hours**, create a calendar with a timezone and weekly working
hours. Add more than one window for a split shift. Choose observed US federal
holidays if your team follows them, and add extra closed dates for your team.
Dates and hours follow the calendar's timezone, including daylight-saving changes.
A calendar can be made inactive when it should no longer be selected.

For example, a two-hour commitment starting at 4 pm on a day ending at 5 pm
uses one hour that afternoon and the next hour when business hours resume.
Closed dates and holidays contribute no working time.

## SLA policies and alerts

In **SLA policies**, choose a calendar and the commitments you need: first
response, next response and resolution. Conditions can select priority,
customer plan, channel and workspace brand. Policies are considered in their
configured order; the first active match supplies the ticket's commitments.

First response measures the wait for the first public answer. Next response
measures the wait after a customer reply. Resolution measures business time
until the ticket is solved. Private notes do not count as public answers.
Pending pauses running commitments while the team waits for the customer;
On-hold pauses them when the policy's On-hold option is enabled. Outside business
hours also pauses working time. The ticket shows the reason for a pause.
A reopened ticket starts the applicable new response and resolution cycles.

Choose an approaching-deadline warning and, if needed, an unattended-ticket
threshold and named backups. Alerts distinguish approaching, breached and
unattended commitments. **Acknowledge** records who has taken notice; it does
not stop a clock or resolve the ticket. Completion resolves the corresponding
alerts. Notification outcomes are shown separately: a recorded alert does not
by itself establish that an email or other notice was delivered.

## Preview and publish rules

In **Rules**, create an event rule for a new ticket, customer reply, operator
reply or ticket change. Combine conditions that must all match with alternatives
where any match is enough. Choose actions such as status, priority, assignment,
tags, custom fields, a private note or an operator notification.

Save the draft, then choose **Preview draft**. The preview explains which
historical tickets match and what the actions would do. It changes no tickets
and sends no messages. Choose **Publish draft** to make a version live. Editing
the draft leaves that published version in use until you publish again.
Published versions remain in the version history. **Pause** stops execution;
**Cancel rule** retires the rule. Execution history records matches, actions,
outcomes and routing decisions.

Rules run in ascending order. Later rules evaluate the ticket after earlier
changes. A repeated event or restarted worker does not apply the same recorded
action twice. A failed or uncertain external notification remains visible;
an unknown send is never automatically replayed.

Snoozed tickets retain their status and responsible owner, and still count toward
that owner’s open workload. Use the snooze filter to see them.

## Time rules

A time rule waits for a chosen ticket timestamp to reach an age. Use it for a
pending reminder, an escalation or closing a ticket that has stayed solved.
Choose a business calendar when the age should count working hours. Add a
condition that defines when the action is still needed. The default published
rule closes tickets after four days in Solved; pause it or publish an edited
version to change that behavior.

A time rule fires once while that ticket remains in the same qualifying
situation. It must stop matching and later become eligible again before a new
run is allowed. Saving a repeated hourly action is refused. This prevents a
reminder or escalation from firing at every scheduler wake-up.

Closed tickets are final. A later customer reply creates a linked follow-up
rather than reopening the closed ticket.

## Routing

In **Routing**, set which operators are available, their maximum active-ticket
capacity and their skills. Create the routing rule in **Rules**. Choose a named
operator, a team, round-robin selection or selection by available capacity.
Team membership, availability, required skills and capacity determine who is
eligible. Configure an overflow group when the preferred team has no eligible
operator. The recorded decision explains the winner or the reason nobody was
selected. Removing a member or changing availability takes effect on subsequent
routing decisions.

## Snooze and scheduled replies

Snooze a ticket until a chosen time to return it to attention later. Cancel the
snooze to stop that wake-up. A customer reply ends the wait early.

Schedule a public reply for a future time from the ticket. Review the text,
sender and due time before saving. You can cancel a pending reply. At send time,
the workspace, ticket, sender's current permissions and conversation changes
are checked again. A reply that is no longer eligible is cancelled rather than
sent against stale context.

An **Uncertain** reply means the send may already have happened. Check the
conversation and delivery evidence before deciding what to do next. It is never
sent again automatically. Snoozes and scheduled replies record their state and
history so a reload or worker restart does not create a second send.

## Erasure and portable backups

Contact erasure removes the contact's workflow snapshots, SLA state and alerts,
rule runs and action details, routing decisions, snoozes and scheduled replies.
It also removes rules whose draft or published text refers to the contact's
personal data. Calendar and policy definitions or routing skills containing the
contact's identity are removed too. Shared plan labels alone are kept. The
existing erasure record counts removed workflow records with ticket records.
Other workspace configuration remains available.

Portable backups carry calendars, policies, rules and their versions, routing
configuration and the retained workflow history. Pending replies, notifications
and rule runs are cancelled on restore; a send that was already claimed remains
uncertain. Pending SLA notifications are stopped. Their recorded identities stay
so restoring a backup cannot replay the same queued action. Local clock overrides
are excluded. Restoring does not establish delivery of any archived message.
