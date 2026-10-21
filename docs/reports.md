# Ratings and Reports

A visitor sees **Did this answer your question?** after a conversation is resolved. Thumbs up or down and an optional comment (up to 1,000 characters) belong to that resolution. Only the conversation's current owning visitor session can submit a rating. A visitor can change the rating; each change remains in history. The usual widget action rate limit applies. Operators see the current rating and comment in the conversation's Details panel.

A new visitor message reopens the conversation. Its next resolution has a separate outcome and rating. A rating for an earlier cycle cannot be submitted while the conversation is open or against a later resolution. Contact erasure removes comments from both the current rating and change history.

## Outcomes

Each resolution records its evidence at the time it occurs. Confirmed operator-sent AI or paired-local-agent drafts make the cycle **assisted**, including drafts edited after adoption. Assisted takes precedence when a cycle also has human-written replies. Otherwise confirmed operator-written answers make the cycle **human**, even when other replies have unknown provenance. **AI** requires every visible answer to be confirmed AI, a complete cycle history, and no person handoff. Missing evidence produces **unknown**. Notes, provisional replies, context insights and the workspace's away message are not answers.

Draft provenance travels with the composer through edits, suggestion changes and undo/redo. The server validates the stored completed draft against the workspace, conversation and current operator/device authority before admitting an assisted reply. External integrations that omit provenance are unknown; an operator role alone does not prove human authorship.

The additive migration preserves every original message. A historical paired-local-agent delivery receipt proves message authorship, but cannot identify which resolution cycle owned it. Historical resolution outcomes therefore remain unknown; missing operator draft or handoff records cannot prove human or AI-only resolution. The old current `resolved_at` does not establish the first historical resolution. Such first-resolution durations remain unavailable. Newly created native conversations record full lifecycle history going forward.

## Workspace calendar and cohort

Reports uses **Project → Timezone**, the workspace-owned IANA timezone, with UTC as the initial default. An operator's profile timezone does not change the report. Last 7, 30 or 90 days include today in that workspace. Custom ranges use an inclusive start date and an exclusive end date, across daylight-saving changes. Choose between 1 and 366 calendar days. Figures are aggregated in the database with bounded output, regardless of cohort size. CSV downloads stream bounded pages through the entire matching cohort.

The cohort consists of conversations **created** during that range. Both Move in and legacy-import history are excluded, including imported conversations subsequently edited. Daily volume groups this same cohort by its workspace-local creation date.

- First response: time from the first visitor message to the first subsequent visitor-visible answer. Notes, context insights and streamed/provisional text are excluded.
- First resolution: time from conversation creation to the first resolution, only when the complete initial lifecycle is known.
- Median: the middle duration, or the mean of two middle durations. P90: nearest rank, the item at `ceil(0.9 × count)` in ascending order. Unknown durations are omitted and each sample count is shown.
- AI resolution rate: latest AI outcomes divided by currently resolved conversations in the cohort. Unknown outcomes remain in the resolved denominator.
- Satisfaction: thumbs-up ratings divided by rated, currently resolved conversations in the cohort. Use only the latest rating for the latest resolution. Unrated conversations are omitted from the rated denominator.

Each conversation contributes once. Reopened conversations leave both rate denominators until resolved again. Earlier cycles remain recorded. Latest comments come from this same currently resolved cohort.

Conversations CSV contains the ID, creation timestamp, first-response duration, known first-resolution timestamp and duration, current open/resolved status, latest recorded outcome, rating and comment. An open conversation can retain an earlier cycle's history in the CSV, while remaining excluded from current resolution/rating rates. Summary CSV uses exactly the page's cohort, counts and percentile conventions and includes only its aggregate metrics and daily series. It contains no individual conversation records or comments, and its query count is independent of cohort size. Timestamps in CSV are UTC and durations are seconds. String cells with leading formula characters `=`, `+`, `-` or `@` (including after whitespace) receive a leading apostrophe and all cells are quoted.

## Team report

Open **Reports → Team report** to see workload by agent, team, channel, brand or tag. Choose a calendar range, team and brand, then apply the filters. **Include imported history** is off initially. Turning it on includes imported tickets in this panel and its export, with separate native and imported counts. It does not change the original daily-volume report above.

Incoming tickets were created in the selected range and have a message. Workload uses their current assignment and status. Resolved means currently Solved or Closed. A ticket with several tags counts under each tag; unassigned and untagged tickets have their own rows. Merged-away source tickets are excluded.

The current backlog includes unresolved tickets created before the range's end, including tickets older than its start. Its age buckets use the report's generation time. This is the backlog now, rather than a reconstruction of what the queue looked like on a past date.

First-response, next-response and resolution compliance use the stored SLA policy and business-hours calendar for each ticket. They include every recorded cycle. The displayed numerator is commitments met; the denominator is met plus breached. Overdue active commitments count as breached. Pending commitments that have not breached and tickets without SLA records are shown separately. Calendar pauses, holidays and due times come from the SLA records; opening a report does not change them. The panel shows the oldest and newest record times so a lead can judge freshness.

Reopen rate counts distinct tickets that returned to an active status after a recorded resolution, divided by tickets with a known resolution. Repeated reopenings also appear as an event count. Imported history without native status history is unknown. Handle time adds recorded timer sessions that overlap the range, including work on older matching tickets. Concurrent operators' work counts separately. A manual duration correction is split proportionally across the original session's dates. Group handle time by agent, request form or the visible custom field named Intent. A restricted Intent field remains hidden from a role that cannot read it. Missing form, intent or timer history is shown without estimating work.

**Team summary CSV** contains every metric, grouping, numerator, denominator and definition from this panel, without sampling. It uses the same filters and formula-safe CSV cells. Report access requires report viewing permission; downloads also require data export permission and a recent security check. Collaborators cannot read reports or timers.

## Scheduled CSV

A lead with report and export permission can open **Create a report schedule** in the team report. Choose daily or weekly delivery, a local hour, filters and workspace teammates. Daily reports cover the previous complete local day; weekly reports cover the previous seven complete local days. The selected workspace timezone controls the boundaries, including daylight-saving changes. A missing local delivery hour runs at the first valid later hour; a repeated hour has one delivery window.

Recipients must be current workspace members with both report and data export permission. Customer addresses, including imported customers, cannot be selected. Each recipient's current role is checked again when the report is prepared and sent. Removing access prevents delivery; removing the creator's access pauses the schedule. Reports use each recipient's field visibility. Pause, resume or delete a schedule from its list.

Each recipient gets at most one send attempt for each schedule window. A rejected or uncertain send is recorded and is never automatically replayed. Local development suppresses external mail. Installation export/import preserves report settings, timers, links and history; restored schedules are paused and pending sends cannot restart. Contact erasure removes the contact's timers and problem preview data.
