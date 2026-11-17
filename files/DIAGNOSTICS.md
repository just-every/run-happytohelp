2026-11-17 — Run Edit Run fleet

Baseline commands (from product checkout; cloud_run sourced from /tmp/rer-cloud-toolchain.sh):

cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium HH_CHECKOUT="$PWD" HH_DIAGNOSTICS=../diagnostics-before HH_CPU_RATE=6 HH_NETWORK_LATENCY=100 HH_RUNS=3 HH_KEEP_GOING=1 node ../diagnostic.mjs
cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium HH_CHECKOUT="$PWD" HH_DIAGNOSTICS=../diagnostics-baseline2 HH_CPU_RATE=6 HH_NETWORK_LATENCY=250 HH_RUNS=3 HH_KEEP_GOING=1 node ../diagnostic.mjs

The diagnostic invokes the actual exported proceduresBrowserJourney with the actual emitted native Worker, isolated D1/R2/queues and existing provider network-edge fixture. Browser context instrumentation adds CDP CPU throttling, network latency and Playwright tracing. It records requests without headers and redacts generated IDs in the diagnostic JSON. Raw traces are deliberately not selected for the public evidence packet.

The first runner reused one runtime with the exact seed email. Its second and third attempts failed at users.email uniqueness before browser execution. The second runner varies fixture emails and the synthetic admin-role ID between tenants; this changes no assertions or product API payloads.

Historical reads:
gh api repos/just-every/run-happytohelp/actions/runs/44094867861/jobs
gh run view 44094867861 --repo just-every/run-happytohelp --job 134080357924 --log-failed
gh api repos/just-every/run-happytohelp/check-runs/134080357924/annotations
gh api 'repos/just-every/run-happytohelp/contents/tests/helpers/ai/procedures-browser.mjs?ref=4c86a426ccd1184b2be306de181a27ef85e767d3'

Four GitHub calls consumed. The historical helper is byte-identical to this checkout's helper; the failed-log command returned exit 0 / zero stdout bytes, and the annotations do not locate the assertion. No blocked blob retries were made.

Final repeat harness:
- Node 22.20.0 drives node:test with --test-concurrency=1 and the exact existing target name.
- repeat-registered.mjs imports the actual workflows-browser.mjs module 20 times with distinct URL query strings so the unchanged registration executes 20 times, including missingProviderProcedureBrowser.
- proof-preload.mjs instruments only browser creation and native runtime creation. Every context uses /usr/bin/chromium, --no-sandbox, CDP CPU rate 6 and 250 ms latency.
- The first runtime migrates a fresh native database. Before fixture seeding it stops its own Worker, copies its migrated empty state, and restarts. Each later runtime receives a separate copy of that empty state, preserving all assertions and identities while avoiding repeated application of 200 migrations. Queue/provider options remain the actual test's options. Each runtime and browser closes normally.
- Each context writes a trace outside the public packet and a non-secret response summary. Context traces are not published.
