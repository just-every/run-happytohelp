# HappyToHelp retained rulings

No new ct ruling is inferred in this rewrite. The entries below carry existing owner and ct decisions.

### RL-1 — Retained native passwords

Date: 2026-10-08. Ruled by: owner. Clauses: IDENTITY-002, IDENTITY-003.

Preserve native password sign-in, first-owner setup, the accepted owner experience and prior account/workspace data with the maintained Base command mechanisms. Retain this edition’s authentication and native owner setup. A second factor adds to native passwords and never replaces them.

### RL-2 — Exact import business-state equality

Date: 2026-10-09. Ruled by: owner. Clauses: MOVE-IN-001.

Exact business-state repeat/undo equality includes contacts, conversations, messages, private notes, tags, source links and every other imported business table. Only platform counters/sequences, audit history and import journals are excluded.

### RL-3 — Bounded ordinary HTTPS transport

Date: 2026-10-09. Ruled by: owner. Clauses: CONNECTIONS-001.

**Scoped edition override, owner decision 2026-10-09:** this consumer uses ordinary platform HTTPS fetch through the unchanged Base wire interface. It refuses every 3xx with manual redirect handling, enforces a 10-second timeout, a 1 MiB request limit and 64 KiB streamed-response limit. Destination syntax and literal IP validation remain enforced. This expressly overrides Base's transport DNS-pinning requirement for this edition; it does not claim DNS pinning or change copied Base contracts. Local synthetic protocol checks do not establish a live Slack connection or hosted installation.



### RL-4 — Selected read-only internal knowledge

Date: 2026-10-23T10:46Z. Ruled by: ct. Clauses: ACCESS-001.

the knowledge-edit permission gates internal knowledge management and connected-application article reads; the knowledge-publication permission still gates publication. Published help keeps its audience gates, so a reader never gains internal articles through it. A separate knowledge-read permission is required for read-only access to selected internal knowledge without edit or publish authority.

### RL-5 — Customer identity links supply staff context

Date: 2026-10-23T12:11Z. Ruled by: ct. Clauses: CUSTOMER-001, PORTAL-001.

interim default = a reviewed identity link gives the operator context only (a labelled “possibly the same customer” view inside the workspace, audited), never customer-side access, merge or send authority. Target (named Gap) = an operator-confirmed link may show the linked history to staff in the same workspace under ROLE scope, with reviewer, time and evidence kept and the link reversible; nothing is merged, no message is sent because of a link, and customers see only what their own verified session allows.

### RL-6 — Synthetic-only procedure simulation slice

Date: 2026-10-27. Ruled by: ct. Clauses: PROCEDURE-001.

owner or admin with settings permission only, explicit synthetic-only confirmation, no historical customer text transfer and no real actions. This initial mode does not complete the clause or replace contracted historical replay, versioned operational context or controlled production release; all three remain gaps.

### RL-7 — SLA Slack alerts with riders

Date: 2026-10-27. Ruled by: ct. Clauses: SLA-001, NOTIFY-001, CHANNELS-002.

APPROVE WITH RIDERS (27 October): only an owner or admin may explicitly select an enabled workspace Slack destination; alerts freeze that destination and send fixed ticket and named-operator identifiers with metric and kind, excluding customer content, names, addresses and private notes. Acknowledgment stays in HappyToHelp and stops pending sends; it does not send a Slack callback or update. Removed backups, disabled destinations, policy opt-out and resolved tickets stop unsent alerts. Installation uses the same owner or admin authority as Teams ESCALATION-001; current installing authority is rechecked before sending. Saving a connection never sends a test: the separate Send test action is explicit test-post consent. Missing or revoked policy consent, wrong workspace and revoked installing authority refuse outbound delivery. Only explicit Slack rate-limit refusals retry, at most five total attempts; unknown effects and interrupted claims never replay. SLA-001 stays partial pending Teams parity, live Slack receipt and exact-SHA evidence.

### RL-8 — Teams outbound escalation slice

Date: 2026-10-27. Ruled by: ct batch 14 (recorded acceptance). Clauses: ESCALATION-001, CHANNELS-002, NOTIFY-001.

ct batch 14 approved this outbound slice with riders; ESCALATION-001 stays partial. The built slice uses owner or admin installation of one fixed Teams channel, current installing authority rechecked before sending, selected public context only, plain text without mentions, and no automatic replay or customer publication. Remaining Slack SLA riders also apply: consent authority must align, five total attempts permit retries only after an explicit rate-limit refusal, and missing refusal cases still need proof. CHANNELS-002 and NOTIFY-001 inherit their own installed-channel and consent obligations; this outbound slice grants no inbound authority.

### RL-9 — Effective leaf test budget

Date: 2026-10-23. Ruled by: ct. Clauses: SOURCE-001.

The cap is **240 effective leaf checks**, not runner registrations. At `29f60c5a322c008e4e564f553df22b61a49c3166`, 188 runner registrations include 18 grouped journeys whose scenarios are registered through `tests/journeys/kit/scenarios.mjs`. The ruling's minimum audit identifies 145 Move-in, 42 Connections and 34 Reports scenarios (221 total). The effective count is at least **188 − 18 + 221 = 391**, **151 over the cap**. Direct registry enumeration expands to 150 Move-in, 42 Connections and 34 Reports registrations (226 total); the ruling's 221-scenario minimum is not an exhaustive total. This is a lower bound; grouping unrelated behaviors never hides their leaf count. Under ct's 23 October ruling, consolidate or delete overlapping tests in the same round, never raise the cap and never weaken an assertion. The excess remains unresolved; this text clarification changes no tests or statuses.

### RL-10 — Retained public-site design

Date: 2026-10-20. Ruled by: owner (retained approvals 1, 2, 8 and 20 October). Clauses: PUBLIC-001, PUBLIC-002, PUBLIC-003, PUBLIC-004, PUBLIC-005.

Keep the owner-approved homepage, UI and behavior intact. The complete retained public design is in docs/contract/public-design.md and its detailed acceptance source is in docs/verify.md. The rewrite changes no marketing or product behavior.
