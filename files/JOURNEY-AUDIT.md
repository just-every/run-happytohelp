# Existing journey audit

- `tests/journeys/installer-nightly.mjs` registers five existing journeys. Only the slow agent-fix browser journey mounts an anonymous widget on `/help/<project>` after real first-owner provisioning. Its flow sends without filling the now required email.
- `tests/helpers/installer/fresh-install.mjs` exercises native commands and owner/data portability; it does not submit a widget browser form.
- `tests/helpers/installer/readme-restore.mjs` creates its archive visitor through the native widget-session API with `visitor@example.test`, so it has no missing-email form assumption.
- `tests/helpers/installer/reproducible.mjs` builds delivery artifacts without a visitor form.
- `tests/helpers/platform-archive.mjs` tests portable data through native commands, without an anonymous widget form.
- `tests/helpers/delegation-journey/case.mjs` has a route-only visitor for the ordinary delegation journey; the changed email collector is a widget UI precondition. The slow browser journey overrides that visitor. No assertion in `case.mjs` needs changing.
- `tests/helpers/first-run/outcomes.mjs` already fills `input[name=email]` before sending from a fresh provisioned workspace, and provides the intended pattern.
- The `/help/` widget flows in `tests/helpers/hero/flow.mjs` and `tests/helpers/widget/identity-browser.mjs` use directly seeded test tenants (`createRuntime().seedTenant`) rather than first-owner provisioning; the seed helper inserts project/user/member/session rows directly and does not call `publicContact`. Their anonymous sends do not inherit the new workspace email requirement. Identity-switch uses a separately seeded tenant on a routed customer website. Existing brand-support browser proof explicitly enables collection and already enters email.
- `tests/journeys/ai-live.mjs` also sends without filling email, but targets an optionally configured live installation and is not a fresh-workspace installer journey. No disposable configured account was provided and this task expressly forbids live installations/provider calls. Its assumption is reported for the lane; it is not run or changed here.
- Release-upgrade baselines are explicitly out of scope and remain untouched.

Only the existing slow agent-fix journey has the affected required-email assumption within the authorized fresh installer/slow qualification scope. Re-run that journey only; add no tests and preserve all its existing delivery, persistence and operator assertions.
