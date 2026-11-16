# HappyToHelp 0.4.31 metadata plan
Run Edit Run fleet, 2026-11-15 UTC.

1. Configure fleet identity, launcher credentials, push guard and clone-local commit hooks; use only the declared HappyToHelp repository.
2. Read fresh main, its rules and the real v0.4.28-to-main diff. Verify published baseline, unused 0.4.31 tag, retained 0.2.117 rer pin and exact SQL inventory.
3. Update existing package/seed/release version references to 0.4.31. Add truthful cumulative release notes for the importer, identity/contact, documentation and faults work. Identify both red tags and test-only delegation/baseline corrections. Preserve backup, migration, rollback and buyer steps. No product or contract edits.
4. Install frozen dependencies, retain repository hooks, check metadata consistency, run typecheck and first-party validation. Fetch fresh main before committing; incorporate updates if any. Regenerate source lock last and require its check.
5. Commit with explicit fleet author/committer, inspect every candidate identity and trailer, then immediately push only cloud/sd-hh-release-0-4-31 through cloud-push.py.
6. Discover exact-SHA Verify through REST and poll at intervals of at least 300 seconds within ten API calls. Record all actual outcomes, with no tags, releases, PR submission, main push or deployment.
7. Publish explicitly selected non-secret report/receipt files only to evidence/sd-hh-release-0-4-31. Retain recovery data if any push fails; delete the clean owned clone after successful evidence transfer.
