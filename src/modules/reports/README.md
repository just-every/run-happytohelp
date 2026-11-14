# Workspace Reports

`readReport` aggregates native conversations created in an inclusive-start,
exclusive-end workspace-calendar range. Four independent statements return daily totals, response and resolution
distributions, and ten comments. Daily totals use a balanced calendar-boundary
lookup and supply the summary counts. No statement expands the entire evidence
tree for every aggregate. Source conversation count does not affect the number
of aggregate statements or rows returned to the Worker.
Move in and legacy-import history are excluded explicitly.

Response duration starts at the first visitor message and ends at the first
subsequent visible answer. An insight button response is a visitor message; an
insight display, internal note or provisional stream is not an answer. First
resolution duration needs affirmative initial lifecycle history. Percentiles
use median and nearest-rank p90. Current rates exclude reopened conversations;
the latest historical cycle remains in per-conversation CSV records.

Conversations CSV streams keyset pages of 500 conversations, retaining complete coverage
without a cohort-size cutoff. Summary CSV includes only the aggregate and daily
series; it does not read or export individual conversation details. Cells are quoted and
formula prefixes are neutralized. See `docs/reports.md` for product definitions.

`reporting_conversations` is a membership projection of conversations with at
least one same-workspace message, including erased and imported messages. Its
date and active-backlog indexes avoid inspecting empty drafts and unrelated
history. Message insert/delete/move and conversation date/status/workspace
updates reconcile it transactionally. Migration backfill and portable archive
replay derive the same four fields directly from conversations and messages.
All actual report evidence and access decisions remain live reads.

Team counts, each duration distribution, and SLA breakdowns are independent
statements keyed by dimension and ID. Evidence always starts from the selected
date cohort. Backlog separately includes older active tickets; overlapping handle
sessions include older tickets with work in the interval. Workload retains the
historical empty buckets required by its existing response, so that inventory
alone still visits older message-bearing tickets. It never enriches those older
tickets with response, lifecycle, rating, AI or SLA evidence.
