# hh-slow-delegation-2 plan

1. Configure fleet Git authentication, identity and commit hooks; clone only just-every/run-happytohelp and branch cloud/hh-slow-delegation-2 from current main.
2. Read repository rules and trace the existing fresh-clone browser journey and visitor socket transport. Reproduce current main with pnpm run test:installer-nightly --test-name-pattern=agent.fix, one job in the dedicated cloud VM. Record socket frame types/message IDs and exact reply/frame/render counts without tokens or private browser state.
3. Run the same probe at the known good 41fb4024 baseline. Use the smallest faults-2/3/4 comparison needed to distinguish a product regression from a stale test mount.
4. Repair the cause while retaining every existing assertion and test count. Run the candidate journey at its existing 1440 width; capture changed browser surfaces once at 1440 and 390 if UI behavior changes. Run only other relevant socket/widget journeys, plus typecheck and first-party checks.
5. Inspect the old tag run's other shards. Fix only failures naming HappyToHelp code/tests. Fetch fresh main before the first product commit, resolve source first if needed, regenerate sources.lock.json last, and check it.
6. Audit every candidate identity and message/trailer, commit with fleet author/committer and active hooks, then push only the named branch through cloud-push.py. Follow its exact SHA Verify through REST within the ten-call API budget and 300-second per-run interval. Never force push or update main.
7. Keep complete actual non-secret reports and receipts in this packet, publish the explicitly selected packet files through evidence/hh-slow-delegation-2 separately from product custody, and return exact product/evidence provenance plus hh/sd inbox POST lines.

Boundaries: no release metadata, migrations, live accounts, paid APIs, configuration secrets, generated acceptance/claims views, evidence files or proof/ directory in the product change. Clause judgments remain conservative. A product change requires the independent gate before landing; a test-only correction does not.
