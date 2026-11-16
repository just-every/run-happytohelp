# HappyToHelp rer adoption and independent contract-docs verification

Tag: hh-rer-0219-adopt-1
Repository: just-every/run-happytohelp
Product branch: cloud/hh-rer-0219-adopt-1

1. Configure fleet identity, bundle-only Git authentication, commit hooks and the checkout-pinned toolchain. Read repository authoring/landing rules and capture baseline pins, clause counts and protected source identities.
2. Pin @runeditrun/rer exactly to 0.2.119. Use the installed official rer refresh-base with immutable Base commit bbab5d84b72e333ff1e9a6f234c0512e5721b1d9 and --from-api; no additional repository clone. Preserve seed-owned adaptations and prior judgments.
3. Move both existing contract-docs checks out of build into an independent checkout/install job. Keep build and shard dependency selection intact. Require this job explicitly in the aggregate Verify gate. Check the job graph and unchanged command inputs.
4. Regenerate the source lock after all tracked edits. Check the installed-package and seed source-lock readers, Base copy identity, both contract generators, first-party checks, typecheck and rer verify. Do not change product clauses, generated views, releases, migration history or unrelated configuration.
5. Fetch fresh main before the first publication, retain any newer clause judgments, regenerate/restore generated views as required if an integration is needed, and recheck final lock. Create one combined candidate with fleet identity; inspect every candidate author, committer, trailer and message before guarded branch-only publication.
6. Observe the exact-SHA Verify using bounded REST reads (one watcher, at least 300 seconds between reads of a run, ten CI/provider-observation calls maximum). Diagnose each failed job once if needed; fix within scope. Preserve all finished work and never rewrite published history.
7. Write complete actual non-secret reports and receipts outside the product clone. Publish explicitly selected files only to evidence/hh-rer-0219-adopt-1, retain exact product and evidence custody separately, and return dated signed hh/sd inbox lines plus the exact READY or truthful terminal status.

No UI changes are intended; no browser screenshot proof is required for the CI-only change. There is no product acceptance gate or authorized live deployment. Full hosted/provider qualification remains unchanged.

Execution adjustments:
- The official refresh also carries upstream local-auth presentation changes. Add six browser render captures of the actual shared handlers at 1440/390, with test assertions at 1440 only, without editing product tests or UI source.
- A broad local rer verify attempt used newer VM Node 24 for package scripts and failed fixture-owned server cleanup. Stop only its recorded owned process after confirming the same email path passed exact-head CI, then rerun the existing email journey directly under pinned Node 22.20.0. The isolated retry passed both tests.
- The first exact-head Verify ended cancelled with import-and-reports the last observed active job. Request only that job and its dependent gates again on the unchanged SHA. Reserve the final task-level API observation until its timeout window plus queue/gate allowance has passed; do not weaken checks or exceed the observation budget.
