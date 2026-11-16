# Large import undo implementation plan

Run Edit Run fleet, 2026-11-16.

1. Set up the fleet launcher, decrypted-bundle Git helper, guarded pushes, clone-local identity and publication hooks. Work only in just-every/run-happytohelp on cloud/hh-stranger11-undo-1.
2. Reproduce the reported import shape with a generated 794723-byte Zendesk JSONL: 1000 customers, 1000 complete mixed-status tickets, one public comment and one private staff note per ticket, two tags, one saved reply and one public article. Measure before changing undo.
3. Diagnose the repeated reference checks and retain all existing authority, native-edit, cross-import dependency, erasure and transaction fences. Keep reversal bounded per queue delivery using existing native import-kit behavior; make the native reference lookup efficient without migrations or Base changes.
4. Initialize undo-specific progress from the actual committed native effects, preserve its denominator across partial apply, resumes and completed undo, and report removed/restored versus remaining effects accurately. Preserve the historical review without presenting it as current imported data or future publication.
5. Extend only the affected import journeys. Prove exact business database equality before import and after whole undo, zero writes on repeated upload, inertness, bounded requests, usable ordinary application reads during undo, restart/resume and partial undo. Inspect changed screens at 1440 and 390 pixels.
6. Run touched journeys, typecheck, source lock/check and rer check. Keep generated contract views and all fleet evidence out of the product branch. Commit with fleet identity, push each substantial save through the guard, merge main after any published save, then push a non-skipped final candidate.
7. Observe only exact-SHA Verify through the specified REST protocol and API budget. Write complete actual report and receipts in this packet and publish explicitly selected files only to evidence/hh-stranger11-undo-1. Report claims and inbox relay lines, with READY only for the qualifying exact head.
