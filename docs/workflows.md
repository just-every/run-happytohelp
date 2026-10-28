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

The widget also uses these calendars for availability. **Accept new
conversations** off always wins, independently of hours or presence. With
acceptance on, the first active matching ordinary widget SLA policy with an
active calendar supplies business hours, holidays, closed dates and timezone.
If no matching policy has an active calendar, the widget's own opening hours
and workspace timezone are the fallback. During open hours, live presence
then decides availability when its away setting is on; an enabled visitor
assistant with its provider key installed keeps the widget available when
nobody is online.

**Settings → Project → Availability → Right now** uses the same availability
as the server and widget and identifies the governing SLA calendar. Away
notices, headers and replies show the next reopening when known, otherwise
**Human response time** from **Settings → Widget**. With acceptance on, a
calendar closure uses the widget's **Away message outside hours**, or the
standard message if that field is empty; it never uses the message for paused
new conversations. See [When your team is away](away.md) for visitor behavior
and away-message settings.

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
by itself establish that an email or other notice was delivered. Alerts are
recorded within a minute of their moment, however many tickets fall due
together.

## Preview and publish rules

In **Rules**, create an event rule for a new ticket, customer reply, operator
reply or ticket change. Combine conditions that must all match with alternatives
where any match is enough. Choose actions such as status, priority, assignment,
tags, custom fields, a private note or an operator notification. The away
message your workspace posts while nobody can answer is not an operator reply:
it starts no rule, and time since the last operator reply counts from a
teammate's or an assistant's reply.

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
an unknown send is never automatically replayed. A run that cannot finish yet,
such as an assignment that keeps losing to a concurrent change, tries again
after 1, 5, 15 and 60 minutes and then stops, showing its reason in the
execution history. A notification that this installation cannot deliver is
marked **Not delivered** with the reason at once; it is not kept to be sent
late. Waiting work never holds up other rules or other workspaces.

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
are checked again. A customer reply or a change of responsible operator or team cancels a queued
reply. A reply that is no longer eligible is cancelled rather than sent against
stale context.

An **Uncertain** reply means the send may already have happened. Check the
conversation and delivery evidence before deciding what to do next. It is never
sent again automatically. Snoozes and scheduled replies record their state and
history so a reload or worker restart does not create a second send.

## Erasure and portable backups

Contact erasure removes the workflow records of the contact's own tickets:
journal snapshots, follow-up links, SLA state and alerts, rule runs and action
details, notifications, time-rule state, routing decisions, snoozes and
scheduled replies. Records are chosen by ticket, never by searching text for a
name or address, so rules, policies, calendars, routing settings and other
customers' history stay as they are, even when a name such as "Al" appears
inside a rule or policy name. The existing erasure record counts removed
workflow records with ticket records.

Portable backups carry calendars, policies, rules and their versions, routing
configuration and the retained workflow history. Pending replies, notifications
and rule runs are cancelled on restore; a send that was already claimed remains
uncertain. Pending SLA notifications are stopped. Their recorded identities stay
so restoring a backup cannot replay the same queued action. Local clock overrides
are excluded. Restoring does not establish delivery of any archived message.


## Review a stopped workflow run

An owner or admin with settings permission can review a failed, not-delivered or
uncertain run through `POST /api/dashboard/projects/:projectId/workflow-runs/:runId/reconcile`.
Inspect the current run first, then submit its `expected_updated_at`, a `note`
(up to 2,000 characters) and an evidence `reference` (up to 500 characters).
The guarded command records who reviewed it and cancels its remaining actions.
It never sends, retries or resumes work, and it preserves every existing provider
outcome, including uncertainty. A receipt or review note does not itself prove
that a customer received a message. Repeated or stale reviews are refused.
The review stays in the portable audit store under its existing custody rules.

A named group notification is limited to the ticket's current group while the
ticket is unassigned. It uses each current member's group preferences; followers
use their own preferences. A group from another workspace is refused. Changing
the group or membership before delivery cancels the old authority. Customer and
follower notices use the ticket audience and cannot be redirected to a named
person. Terminal delivery claims remain terminal across restart.

Workflow and SLA inbox notices remain available when email delivery is not
configured. Their frozen delivery record says email was not configured; installing
a mail provider later does not replay that action. The workflow run or SLA alert
keeps the explicit not-delivered email outcome for review.


## Slack SLA escalations

An owner or admin can save an incoming webhook or bot destination in Settings →
Slack. Turn off **Notify on new conversations** for a destination used only by SLA
policies. In Settings → Workflows → SLA policies, explicitly select the **Slack
escalation destination** and named backup operators. Leaving the destination empty
sends no SLA alerts to Slack. Existing alerts keep their original destination;
changing the selection never redirects an old alert.

Approaching, breached and unattended alerts send fixed ticket and named-operator
identifiers, the metric and alert kind. Customer text, names, email addresses and
private notes are excluded. The configured Slack channel is an explicitly chosen
external audience; the app does not infer its members. Current backup membership,
policy authority, destination availability and ticket state are checked before
sending. The destination installer must still be a workspace owner or admin, as for Teams handoffs. Removing that authority, a backup or destination consent cancels unsent work. Saving a connection sends no test message; use the separate **Send test** action to consent to a test post.

Ticket → Schedules shows Slack delivery separately from the persistent alert:
pending, accepted, failed, uncertain or cancelled, with attempts and any next retry.
An explicit rate-limit refusal respects its cooldown and stops after five attempts.
A lost response, unknown provider outcome or interrupted send stays uncertain
across restart and never sends again automatically. Inspect Slack to reconcile
unknown outcomes. **Acknowledge alert** in HappyToHelp persists acknowledgment and
stops unsent work; it does not edit the Slack message or create another post.
Teams and live account qualification remain pending under SLA-001.
