# Combined release preparation plan

Run Edit Run fleet, 2026-11-15. Tag: sd-hh-combined-next-release.

1. Install the authorized fleet credential helper, product push guard and clone-local commit hooks. Clone only just-every/run-happytohelp and create cloud/sd-hh-combined-next-release from fresh main.
2. Read launcher and seed rules and inline release rules. Compare package metadata, live Git tags and published GitHub releases; select the next unused patch without creating or moving a tag. Confirm the four qualified commits are ancestors of fresh main.
3. Inspect every landed change since published v0.4.28. Inventory all migration sources and compare their names and bytes against the release. Keep rer 0.2.117, Node/pnpm pins and legacy domains. Prepare one truthful combined CHANGELOG section, RELEASE.json and existing package/seed version references. No product, contract, generated-view, provider or deployment edits.
4. Install frozen dependencies. Run the typecheck and meaningful release/metadata, source-lock and first-party checks; do not add literal pin tests or run a full local suite. Regenerate sources.lock.json after all tracked edits. Review the exact diff and all candidate identities/trailers.
5. Fetch fresh main and rebase before the first publication; after any published save use merge only. Push only the named cloud branch through cloud-push.py at the first real commit. Leave public publication scanning, guarded landing, release production, independent signing and GitHub Release publication to their authorized later stages.
6. Discover and poll exact-SHA Verify using REST, with at most one request per run per 300 seconds and ten GitHub calls total. Record actual run IDs, outcomes and limitations; never infer green from a different SHA. Preserve results and complete non-secret receipts outside the product clone.
7. Publish explicitly selected reports/receipts only to evidence/sd-hh-combined-next-release using cloud_evidence.py. Verify report custody and product ref. At a clean pushed end, delete the owned clone/dependencies and retain the packet. Return READY only after exact-SHA green Verify, otherwise truthful PUSHED or real BLOCKED, plus the sd inbox relay.

No clause status changes are authorized or claimed. No tag, GitHub Release, production action, signer action, PR or fleet self-submission is part of this preparation unless the seed's landing rules require a PR; this seed uses the fleet branch lander.
