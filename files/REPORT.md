2026-11-17 — Run Edit Run fleet

Work in progress. Product branch cloud/hh-procedures-race-2 currently has no new commits; baseline 55e2f106c506e4f671d2e474c737124e760e2233.

The first complete procedures helper pass succeeded under CDP CPU rate 6 and 100 ms network latency. Two subsequent attempts failed before browser execution because the reused runtime tried to insert the same fixture email; these are infrastructure exclusions, not journey failures. The runner now varies fixture identities between isolated tenants. Raw Playwright traces remain outside this packet because traces contain transient synthetic session headers.

Historical diagnostic run 44094867861: failed support-workflow-browser job 134080357924. The authorized gh run view --log-failed command returned exit 0 with zero stdout bytes. Check annotations report only Process completed with exit code 1. Those records do not identify the assertion. Four GitHub calls used so far (job listing, failed log, annotations, historical helper source); no log download retries.

A second baseline batch uses CPU rate 6 / latency 250 ms. Pending.
The procedures list load has no ordering token although initial loading and Refresh versions may overlap. A separate real-response experiment is being prepared to test whether this lets an older read expose a draft during a newer refresh or erase a newly saved version. This is a hypothesis, not a historical-cause claim.

No contract status, gap or evidence changes. No other journeys changed. No main push, Base refresh, deployment or provider operation.
