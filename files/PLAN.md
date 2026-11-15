# HappyToHelp 0.4.30 plan

Run Edit Run fleet, 2026-11-15.

1. Refresh the fleet launcher, install credential and commit guards, and clone only just-every/run-happytohelp. Start cloud/sd-hh-release-0-4-30 from fresh main.
2. Verify prerequisites 85bd29235181c90e7626cbebb6c1fe6b2564756d and a7e05db8c6b5787328d56657453f551229d57405; verify v0.4.28 commit/tree; inspect latest published Release and confirm 0.4.30 is unused.
3. Restrict product edits to existing release metadata, the explicitly leased baseline entries, and the source lock. Keep previousVersion 0.4.28 and rer 0.2.117. Record truthful combined changes from v0.4.28 and an exact migration inventory. Preserve the retired v0.4.29 tag.
4. Add verified 0.4.28 baseline (200 migrations, existing populate03 API), moving previous:true from 0.4.26. Add no tests and alter no assertions.
5. Run pinned dependency install, noninteractive rer setup, typecheck, first-party check and the 0.4.28 upgrade journey with a rer build. Regenerate and check source lock last. Commit using fleet identity with hooks active and publish the first real commit through the cloud push guard.
6. Inspect all candidate identities/messages and retain actual non-secret receipts. Wait for exact-SHA branch Verify through REST within ten GitHub calls, no faster than 300 seconds per run. No tag, Release, deployment or self-submission. The exact-tag slow tier remains a downstream gate before signing.
7. Publish the explicit report packet to evidence/sd-hh-release-0-4-30 independently of product custody. Return lane POST entries and READY or PUSHED based on observed exact-SHA Verify. Clean the owned clone only after successful product and evidence transport.

No clause status, Gap or Evidence changes are authorized. Source publication scan remains on the fleet Mac, which this cloud cannot run.
