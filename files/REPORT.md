# Design: import first, turn on live mail later

Author: Run Edit Run fleet, 2026-11-17. Tag: hh-mailbox-import-1.

Settings → Email → Add mailbox keeps the provider selector and adds a labelled Mode control for Gmail, Microsoft and IMAP. “Import history only” explains that selected folders are read once, then reviewed in Move in before import. The mailbox card displays the mode and offers folder selection, Review history, and a separate Turn on live mail action. Sending, aliases and live sync controls are absent in this mode. IMAP shows only its receiving host, port and credentials. The later live step explains the additional send permission/SMTP configuration and that live Inbox receiving starts then; imported records remain historical and private. This uses the existing form and mailbox visual system, rather than a new screen or navigation category.

The implementation will use the existing encrypted mailbox secret custody and existing cursor JSON to identify the mode, without a migration. OAuth state binds the requested mode to encrypted PKCE state; reconnect preserves it, while a dedicated live endpoint explicitly upgrades it. Existing connections retain their current scopes and polling. History routes read provider folders and MIME only and pass a mailbox-specific normalized source into the same Move in admission, review, apply and undo pipeline. Stable account/message identities deduplicate folder overlap and repeated imports. Real MIME senders become unverified contacts; imports do not establish customer access. Provider threads are preserved (Gmail/Graph thread identities, IMAP reference chains). Attachment admission follows existing supported byte and type bounds; unsupported history is refused visibly rather than silently omitted.

Plan: inspect existing custody, import and UI flows; verify official provider permissions/endpoints; implement the mode, separate activation and source mapping; exercise all three providers at the network edge using synthetic MIME and fake servers; run touched checks, then inspect browser proof at 1440/390; regenerate the source lock last; commit/push only cloud/hh-mailbox-import-1 and observe its exact-head Verify; publish this packet separately.

12ui design skill was read and its CLI installed/help inspected. Hosted image generation was not used because this brief explicitly prohibits paid APIs/credits. The change extends existing controls, with no generated design assets.

## Provider documentation read

- Google: https://developers.google.com/workspace/gmail/api/auth/scopes — gmail.readonly reads messages/settings; sending and send-as settings are separate permissions.
- Google: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list — lists messages filtered by label, with pagination.
- Microsoft: https://learn.microsoft.com/en-us/graph/permissions-reference#mailread — delegated Mail.Read reads the signed-in mailbox including content; Mail.ReadBasic excludes bodies and attachments.
- Microsoft: https://learn.microsoft.com/en-us/graph/permissions-reference#offline_access — refresh access adds no mail permission.
- Microsoft: https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0 — GET message/$value returns MIME.
- Microsoft: https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages?view=graph-rest-1.0 — folder-specific message reads.

## Results

Pending implementation and actual execution. No live provider account, mailbox or credentials used. No contract status change authorized.

## Implemented candidate and bounds

The first save, db859c8, is on cloud/hh-mailbox-import-1 with fleet author/committer identity and no co-author trailers. It is an intermediate [skip ci] save, not a READY candidate. The final SHA and workflow receipt will be recorded below.

The three providers now have an explicit history mode; existing rows default to live. OAuth mode is encrypted alongside single-use PKCE state, reconnect retains it, read-token refresh retains its scopes, and a returned broader scope set is refused before custody. Microsoft also uses User.Read solely for connected-account identity. IMAP history ignores all SMTP inputs even if supplied directly. History rows cannot enter cron selection, forwarding alias lookup, manual live polling, sender preparation, outbound ticket creation or reply staging. The later live endpoint requires owner/admin step-up and provider consent, or re-entered and checked IMAP/SMTP configuration.

Mailbox-specific normalized records enter the existing Move in admission, immutable private source custody, review, approval, native targets, repeat detection and conflict-safe whole undo. Every sender is an unverified contact, including a historical support-side sender. Gmail and Graph thread IDs and IMAP Message-ID reference chains group selected messages; overlap is deduplicated. The source retains provider/account attribution and a mailbox-history provider tag. Read paths and websocket admission deny mailbox historical conversations to customers, including later verified portal/company viewers. Native import targets already exclude historical rows from reporting, SLA and workflow effects.

Limits are explicit rather than silently dropping history: 20 folders, 1 MiB MIME/150 read calls per request, then ordinary 2 MiB/128 KiB record and supported supplied-attachment bounds. Large selections and unsupported complete threads are refused; checkpointed whole-large-mailbox retrieval remains outside this candidate. Changed copies of already held threads remain source conflicts instead of merging new replies. Live activation uses the existing connector's Inbox behavior, so existing Inbox mail can enter as live tickets; it does not promote historical imported records.

No migration, Base refresh, dependency pin, version, tag or contract source/status/view edit was made. MAIL-001 remains partial, MOVE-IN-001 remains done, and MOVE-IN-002 remains partial; the lander and independent gate own their judgments. The added history behavior is supporting evidence, not a declaration that any previously incomplete full clause is now done.

## Validation history

The initial new-provider journey passed all three synthetic providers. The first browser pass also passed, with the editor, history card and later-live confirmation captured at 1440/390 and inspected. The extended pass adds actual fake-provider folder selection and the resulting Move in review.

A combined existing email/Move in run was interrupted by an environment restart before its final diagnostic report. Later isolated runs identified separate causes: the local-email clean-checkout fixture copies git ls-files and initially missed untracked new modules; Move in's existing catalogue check still held the prior hash/size of the intentionally updated moving-in documentation. Tracking the new modules and refreshing the catalogue binding addressed those issues. The interrupted run is not reported as passing; the subsequent completed results are listed below.

The history journey now checks all three providers through real HTTP routes and the real Worker/D1/R2 import pipeline with only the provider network/socket edge faked. It checks read scopes and refresh scope retention, multi-page/folder reads, no provider writes or SMTP connection, encrypted-custody SMTP exclusion, current-role/foreign-owner refusals, approval before native changes, real sender contacts, thread/attachment bytes, no customer list/detail/transcript access, Reports exclusion, no SLA/AI/workflow/notification/local-task activity, explicit send/poll refusals, no scheduled reads, exact business-row equality on repeat and undo, and refusal to store a token reporting broader send permission. Final additions cover import again after undo and completed later OAuth consent. Actual final receipts follow.

DEFAULT MAIL-001: Preserve existing live scopes and Inbox polling; history is an explicit separate mode and its activation is explicit fresh authorization/configuration.
GAP MAIL-001: Large/checkpointed mailbox history, arbitrary attachment types/sizes, changed-thread catch-up and live-account qualification are not established. No real mailbox/account/credential was used.
DEFAULT MOVE-IN-001: Use existing bounded review/apply/undo custody and preserve native edits rather than replacing records.
GAP MOVE-IN-001: This round supplies small synthetic mailbox-history evidence, not new 1,000-conversation scale qualification for mailbox providers.

The isolated complete-tree live-email rerun exposed a second local-toolchain issue: `Journey server PID has no owned control socket` in the pre-existing rer test cleanup helper. The cloud VM's Node 24 causes rer to re-execute under the repository's Node 22 pin, so the helper's process identity can differ. Validation has switched to the repository's existing Node 22.20.0 binary; no sign-in or cleanup code was changed. The earlier Node 24 result remains a failed local run, not a green receipt.

The final behavior also permits reading the identical selection after a completed undo: it retains the old immutable custody/journal, uses an additional JSONL record separator to give the fresh review a new artifact identity, and preserves per-record IDs/hashes. Repeated reads of the current import still reuse that import. The fake-provider journey exercises reimport/apply/undo again after an undo, plus completing Gmail/Microsoft live consent and checking mode, sender authority and the reset live cursor.

Final local results: Node 22.20.0 email journeys 3 passed/0 failed (610.964 s); final focused mailbox-history journey 1 passed/0 failed (11.114 s), including custom-role integration permission refusal; focused Move in regression 1 passed/0 failed (217.699 s), including the 312-ticket Zendesk grant-door proof, source-custody/privacy/repeat/undo, Zendesk/Help Scout reply compatibility and legacy adoption. Typecheck, first-party rer check and source check exited 0. The initial hash failure was the existing importer catalogue binding to docs/moving-in.md: its size/hash were refreshed in importers.json, with its verification assertions preserved. No acceptance or validation tier was promoted. The complete final browser flow passed before the last sentence clarification; a fresh build/capture of that wording is running.


## Final candidate provenance and browser proof

Branch: cloud/hh-mailbox-import-1. Final product commit: 621d11ff3581a1e6cfda23957c5d430349539c66. Final source tree: 7392ebb76ba4682f5a7c9194981688b8b302e86b. The guarded product push succeeded on its first attempt; a Git ref probe independently matched that exact head. The worktree is clean. Both candidate commits have fleet author/committer identity and no trailers. No PR was required by this repository's landing instructions and none was created. Nothing was landed, submitted or deployed.

The final build exited 0. The final browser flow exited 0 against that exact source tree before commit, with no source changes between build/capture and commit. The one small change after the route-test tree was the precise attachment-refusal sentence and its regenerated source-lock hash; the final browser/build cover it. Editor, selected folders, actual fake-provider Move in review, retained history card and live activation confirmation were captured and inspected at 1440 and 390. Assertions and axe checks run at 1440 only; all passed with no serious/critical finding or horizontal overflow. Chromium used /usr/bin/chromium with --no-sandbox, synthetic native owner state, a synthetic encrypted read credential and a fake Gmail network edge. All contexts, browsers and runtime servers were closed by their owning helpers.

Before/after: 0 → 3 providers with an explicit inert read-only history mode; 0 → 1 registered history journey, with the existing email browser registration extended. Per-provider synthetic data: 2 source messages → 1 historical thread, 2 native messages and 2 byte-exact attachments; repeating retains every imported business row exactly and undo restores the initial business rows. Scheduled history reads: 0; send attempts through history mode: refused before any provider send; customer history list/detail/transcript reads: refused. Provider mailbox HTTP methods are GET only; OAuth token exchange/refresh uses POST to the authorization token endpoint, and IMAP uses only login, LIST, EXAMINE, UID SEARCH and BODY.PEEK reads. No SMTP connection was made in history mode. The provider receipt has the actual counts/commands; validation and browser receipts bind the source tree and file hashes.

Screenshots: screenshots/mailbox-history/{editor,folders,review,history,live-step}-{1440,390}.png. The packet contains each regular file explicitly, along with the actual successful TAP logs and receipts. These are public synthetic artifacts, not real company data or account proof.

Verify discovery: run 44162342688, https://github.com/just-every/run-happytohelp/actions/runs/44162342688, in_progress on exact head 621d11ff3581a1e6cfda23957c5d430349539c66 at discovery. Final observed conclusion will be appended below. One GitHub API call used so far; one watcher, minimum 300 seconds between calls for this run. The independent Opus access/privacy/data gate and Mac publication/landing scans remain the fleet's work, not this builder's acceptance judgment.


## Builder claims, without status edits

CLAIM MAIL-001 PARTIAL points=2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome; tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP
CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP; tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

These are supporting builder claims on the candidate. Contract status changes: none. MAIL-001 and MOVE-IN-002 remain partial, and the published MOVE-IN-001 judgment remains done. No independent gate, landing or submission is claimed.

CI status observation 2: Verify run 44162342688 remains in_progress on 621d11ff3581a1e6cfda23957c5d430349539c66 after the required polling interval; conclusion is null. No READY or acceptance claim follows from this evidence snapshot.
