# HappyToHelp 0.4.32 metadata preparation

Run `sd-hh-release-0-4-32`, 2026-11-21 UTC. Repository `just-every/run-happytohelp`.

## Plan and execution

1. Verify the latest published baseline. The non-draft GitHub Release [HappyToHelp 0.4.31](https://github.com/just-every/run-happytohelp/releases/tag/v0.4.31) was published at 2026-11-16 11:23:15 UTC. Its tag dereferences to `e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f`. The candidate base is `ea02bafd06b5a123879b5c3a36d14b3d136225c9`, the rer 0.2.127 re-pin on main. The tag is an ancestor of that base and the range contains 58 commits. The remote advertised no v0.4.32 tag during the initial and pre-push checks.
2. Compare committed file inventories and read the relevant product and documentation diffs over that range. Use the published release as the comparison point, preserve the previous notes, and retain the buyer's backup, migration, upgrade and rollback instructions. Both SQL inventories contain 200 files with identical paths, modes and blob IDs.
3. Set the three authoritative version fields to 0.4.32 and record previousVersion 0.4.31 with the current UTC date, 2026-11-21. Copy the same new notes body into CHANGELOG.md and RELEASE.json. Preserve the release schema and keep contract and migration change declarations empty. The tracked pnpm lock already pins rer 0.2.127 and has no root application version. The checkout has neither package-lock.json nor RELEASE.md. Regenerate sources.lock.json after the metadata edits.
4. Confirm current main, then verify the committed metadata with the pinned rer release source validator, exact release-note parity, the typecheck, source-lock and contract checks, and declared project hashes. Verify the candidate's commit identity, scope and complete message before the guarded product push. The product publication scan remains part of Mac landing.
5. Push the candidate once to `cloud/sd-hh-release-0-4-32`, check Verify on that exact SHA through REST, and attach this packet to the published product commit on the dedicated evidence ref. The fleet owns landing and release publication.

## Notes checked against the published range

| User-visible area | Changes examined |
| --- | --- |
| Restore, Setup and Cutover | `ea02baf` pins rer 0.2.127 and Base `c21583b3`, including native owner readiness and hosted-export restore. `fa44624` corrects restart guidance and local mail-off setup progress. `5bbe2cf` links email and widget Cutover cards to their check guides. |
| Zendesk import and disclosure | `67d20bd`, `9a7e478`, `73f5927` and `a83dff8` cover JSON arrays, API collections, numeric fidelity and primary phones. `ff15a22`, `8cd397f`, `12913e7`, `9290543` and `55e2f10` cover the field ledger, native requester/company/supplied-file relationships, source warning locations and losses. The notes name source-only examples and distinguish supplied attachment bytes from URL-only records. |
| History, legacy and reversal | `e943b76`, `bec54d7` and `d0000ff` add private, inert mailbox and legacy history import and follow-ups. `348a001`, `20b254f` and `a61a0cd` improve large import undo progress and show reversal blockers. |
| Widget, owner access and invitation | `b6f16fc`, `ca9eedc`, `ee5edc1` and `6a5968b` improve owner re-entry, password choice, widget website confirmation and unavailable-chat messaging. `c81b5b4` opens the inbox after invitation acceptance, and `a61a0cd` keeps the invitation link out of copied-link announcements. |
| Desk, AI and workspace | `c798ff4` keeps bulk replies within the database statement budget and keeps AI usage figures workspace-scoped. `16ebc01` improves first-run workspace creation, ticket-reference search, schedule time zones and delegation setup. |
| Documentation and verification | `a1ec372` and `d845c20` explain local limitations, connecting providers, contacting support and contributor setup. Test-only changes, including the nightly build ordering in `1ffe9e0` and Verify shard balancing in `8e28f7e`, are outside the user-visible change list. |

## Candidate and scope

Product head `c9f4904b175366d0226fc2a4c33348d6e4f8ffc9` is one commit over main. It changes CHANGELOG.md, RELEASE.json, package.json, seed.json and sources.lock.json. The source lock is the only generated file in the commit. No product code or test was changed. No PR, tag or GitHub Release was created.

Contract summary before and after is 4 done, 71 partial and 16 missing, total 91. SQL migrations before and after are 200, byte-identical. No contract clause claimed; this is release metadata.

The validation receipt records the exact candidate's check results. The CI receipt records the observations for candidate Verify and main Verify. Launch context cited green upstream runs 44892177640 and 44880462264 for the already-landed re-pin.

## CI outcome

Candidate Verify [44894371505](https://github.com/just-every/run-happytohelp/actions/runs/44894371505) was still in progress on the exact product SHA after the ten-call GitHub budget. The guarded product push succeeded. Main Verify [44893206320](https://github.com/just-every/run-happytohelp/actions/runs/44893206320) was last observed in progress on the candidate's parent. See CI.json for the exact observation times and SHAs.

_Run Edit Run fleet, 2026-11-21._
