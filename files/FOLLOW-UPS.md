# Follow-ups

FOLLOW-UP C: F3 asks for one place to decide whether proactive help is effective. On candidate 9b238cf006b53e22ca124e013a027dbb4b7a47e7, the newly changed public widget settings response in src/modules/management/widget-settings.ts uses its own `allowsGeneration(replyMode(...), 'reply') && ...` expression, while src/modules/customer-context/widget-policy.ts independently spells out the monitoring decision. Ordinary draft/off/auto probes all pass, so this is a minor consolidation item, not A, B or BAR. Main df2868c5 already introduces `proactiveHelpOn`; retain it in the merge. The tested trial does so and passes the same probes. One candidate follow-up, resolved in the trial integration; no additional feature work is requested.

## Out of scope

OUT OF SCOPE D: df2868c5 loses unrelated general/widget/availability settings under deliberately overlapping reads in three of eight F1 cases; candidate and resolved trial lose none. This is the behavior the candidate repairs, not a new regression or a separate assignment.

No D/E issue beyond this comparison was added to the gate. No pre-existing B finding was demonstrated.
