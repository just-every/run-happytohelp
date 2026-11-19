# HappyToHelp follow-ups 2

Run Edit Run fleet, 2026-11-19.

## Plan and scope

Use the current HappyToHelp main as the single parent. Reproduce the Zendesk inspection and repeat-upload sequence before touching undo. Fix mailbox admission at the receiving lookup shared by inbound transports, keep history inert, and prove the changes in an existing email journey. Close the legacy command and owner-copy items, then verify the generated docs digest, Base acknowledgement and source lock. Exercise the changed screens in the existing browser journeys, and verify the final candidate through branch CI. Keep the report and receipts on the separate evidence ref.

## Item results

| Item | Result | Implementation and proof |
| --- | --- | --- |
| B1 | Fixed | The shared lookup in src/modules/integrations/inbound-receiving.ts excludes history connections. Removed the unused alternative lookup. The authenticated inbound gateway returned 404 for the history-only address. The existing mailbox history journey counted no new conversation, outbox row or workflow event. |
| B2 | Disclosure retained | Turning on live mail can bring Inbox history back as live tickets. The disclosure remains in docs/email.md. |
| B3 | Documented | docs/email.md explains that an existing contact holds back every affected thread, including their replies, and explains how to keep or bring over those threads separately. |
| B4 | Fixed | Mail from the connected address becomes a team reply attributed to Unknown source author. The history journey asserted operator attribution and no contact for that address. Threads without an outside sender use the existing no-requester identity. |
| B5 | Fixed | The IMAP reader uses UID SEARCH ALL and budgets actual fetches. The test used two messages at UIDs 1 and 900000. The 150-read, 1 MiB and 1,000-message bounds still apply. |
| B6 | Documented | docs/email.md describes removing the earlier Microsoft sending grant and authorizing reads again. Provider scope handling stayed as shipped. |
| B7 | Skipped by brief | IMAP folder names retain the provider spelling. |
| B8 / A6 | Fixed | scripts/pack-zendesk-offline.mjs resolves the manifest directory once. The existing corpus opened through a symlinked ancestor and rejected both a symlinked file and a traversing path. |
| B9 | Fixed with the declared tool | The baseline reported adaptation-modified for Verify. The edition authoring adapt-base command acknowledged the reviewed bytes and verify-base --offline passed. The workflow itself is byte-identical to the parent. |
| B10 | Fixed | docs/moving-in.md explains what comes across, what stays behind and what to check. Moved implementation details to docs/LEGACY-EXPORT.md and updated the two inbound documentation links. The importers.json size and SHA-256 were derived from the final moving-in.md bytes. |
| B11 | Fixed | docs/LEGACY-EXPORT.md names Paper Lantern and Orbit Repairs. |
| B12 | Fixed | A missing legacy user timezone defaults to UTC. The real SQL fixture includes a nullable owner timezone, and the existing command journey checks the imported setting. |
| B13 | Fixed | The local CLI recovers a PID marker after its process exits. An OS-released SQLite lock serializes recovery and prevents concurrent imports. The existing custody journey checks both a running PID and an exited one. |
| B14 | Fixed for local command imports | The local command uses Miniflare's built-in request metadata with an empty cache. The existing network-edge assertions record any non-loopback attempt. Explicit Cloudflare remote imports still use their named remote resources. |
| B15 | Fixed | The Move in package count uses row/rows. The dashboard uses recorded legacy import custody to omit email delivery status for historical replies, including CLI imports. The existing journeys read the count and the imported reply. |
| B16 | Fixed | Removed the single 600-second test timeout in tests/legacy-export.mjs. Every assertion remains. |
| B21 | Fixed | Saved replies and customer notifications use the requester portal link with the full ticket ID. The saved-reply browser proof and outgoing customer-notice assertions cover the link. Teammate notices continue to use the operator page. |
| Stranger-15 item 7 | Could not reproduce the undo conflict | The baseline browser imported a Zendesk JSONL with one ticket, two public messages, one private note, two people, two tags, a saved reply and a public article. It opened the conversation and article, uploaded identical bytes again, clicked Undo whole import and Resume undo, and finished with six of six changes reversed. Undo returned 202. Resume returned 409 after the run had already completed, and the run had no native edit conflict. Kept the inspection and repeat path in tests/move-in/undo-conflict-browser.mjs. The undo logic was left as shipped. |

## Before and after

The journey files contain 133 direct registrations before and after. The contract remains 4 done, 71 partial and 16 missing across 91 clauses. MAIL-001 and MIGRATION-001 remain partial.

CLAIM MAIL-001 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP

CLAIM MIGRATION-001 PARTIAL points=none tests=tests/legacy-export.mjs#project snapshot → attachment bytes → native import → safe replay → delta sweep since the watermark

DEFAULT MAIL-001: Attribute the connected address to the team as Unknown source author.

GAP MAIL-001: Live cutover may re-admit Inbox history, as disclosed. Real mailbox provider qualification remains open.

## Candidate and verification

Branch `cloud/hh-followups-2`. Product SHA `d0000ff73b7dd4cd5d33161eee0ef042965804bb` with parent `c798ff4f9d60bd4ba7a453349f1b626bd6171139`. Product result `READY`.

Verify run 44501900973 reports completed / success. https://github.com/just-every/run-happytohelp/actions/runs/44501900973

- contract-docs · 135483541415 · success
- plan · 135483541770 · success
- build · 135483763424 · success
- slow · 135483765783 · skipped
- size-check · 135484536910 · success
- Verify / import-and-reports · 135484537068 · success
- Verify / support-workflow-browser · 135484537123 · success
- Verify / public-and-import-browser · 135484537128 · success
- Verify / identity-and-desk · 135484537135 · success
- Verify / support-and-recovery · 135484537158 · success
- Verify / assistant-and-knowledge · 135484537185 · success
- Verify / connections-and-computers · 135484537213 · success
- Verify / identity-and-repair-browser · 135484537266 · success
- nightly-proof · 135486205860 · skipped
- full-push-proof · 135497660097 · success
- verify · 135497702653 · success

### Exact-head local checks

- pack-final · `tests/move-in/zendesk-offline-fixture.mjs zendeskCorpus` · exit 0
- mailbox-final · `node --test --test-name-pattern='read-only mailbox history' tests/journeys/email.mjs` · exit 0
- typecheck-final · `pnpm run typecheck` · exit 0
- source-check-final · `node scripts/edition-authoring/cli.mjs check` · exit 0
- rer-check-final · `pnpm exec rer check --profile first-party` · exit 0
- base-check-final · `node scripts/edition-authoring/cli.mjs verify-base --offline` · exit 0
- contract-check-final · `node src/site/base/contract-docs.mjs check` · exit 0
- contract-alias-final · `node scripts/contract-docs.mjs check` · exit 0
- docs-build-final · `tests/helpers/public-docs-journey.mjs verifyDocs` · exit 0
- build-final · `cloud_run npx -y @runeditrun/rer build` · exit 0
- browser-proof-final · `emitted Worker through headless Chromium, all docs routes, Zendesk undo and legacy package review` · exit 0
- ticket-browser-final · `node --test --test-name-pattern='a saved reply previews the short support reference' tests/journeys/inbox-browser.mjs` · exit 0
- mysql-final · `node --test tests/legacy-export.mjs` · exit 0
- customer-link-final · `customer acknowledgement through the authenticated inbound gateway` · exit 247
- legacy-final · `node --test --test-name-pattern='a legacy package is reviewed, imported and replayed' tests/journeys/legacy.mjs` · exit 0
- move-in-browser-final · `node --test tests/journeys/move-in-browser.mjs` · exit 0
- notifications-registered-final · `node --test running the existing notificationOutcomesJourney helper` · exit 0
- importers-digest-final · `SHA-256 and byte-length check against the importers.json record` · exit 0
- email-final · `node --test tests/journeys/email.mjs` · exit 0

The local MySQL run used an isolated loopback MySQL 8.4.13 container and verified the 53-table, 580-field fixture. The final run took about 991 seconds. The null timezone row mapped to UTC. The local legacy custody checks also exercised an exited PID and recorded zero non-loopback import attempts with an empty Cloudflare request-metadata cache.

Several stand-alone Node eval probes stalled before Miniflare provisioned their fixtures. The affected behaviors were covered by the successful registered mailbox, notification, legacy, and Move in journeys and the separate importer-doc digest check. Local probe exit status and provenance are included in CHECKS.json.

The branch was pushed once after checking its ancestry, identity and trailers. The brief specified a branch handoff without a PR.

All eight push shards and six supporting jobs passed. The push tier skipped its two scheduled-only jobs. The jobs spanned 26 minutes 20 seconds, above the fleet’s 10-minute Verify target.

