# HappyToHelp D20 follow-up

Run Edit Run fleet, 17 November 2026. Repository `just-every/run-happytohelp`. Branch `cloud/hh-owner-design-d20-1-c1`.

## Plan and execution

1. Fetch `main` and `cloud/hh-owner-design-d20-1` in the same blobless depth-100 checkout. Confirm the former D20 branch is based on the newest `main`, then replay its two commits as a single change. `main` was `b6f16fc44feaad1164753d895419bb78e61e40e3` on both fetches and the pre-push ref probe. It is the candidate's sole parent. The carried D20 head was `d36288793b599c22034881a6eeda46e71c01dd37`.
2. Search the whole test tree for both invitation endpoints, the invitation page and action, the old Sign in locator, and installer wording. Distinguish actual invitation navigation from direct API fixture provisioning and independent sign-in checks.
3. Update the macro handoff's UI invitation to assert the invited workspace inbox, Lena Patel's rendered name, and the same browser's authenticated operator session. Keep the preview, editing, send, reload, persisted handoff and explicit takeover assertions.
4. Regenerate and check the source lock after tracked edits. Verify that only the macro helper and its source-lock entry differ from the former D20 branch. Run the build, typecheck, first-party rer check and touched journeys. Take separate 1440px and 390px screenshots of the D20 screens.
5. Audit the candidate's identity, trailers, ancestry and diff. Push the named product branch through the fleet guard. Record the push and exact-SHA Verify separately from the evidence transfer.

## Tests and helpers

| File | Before D20 | Candidate |
| --- | --- | --- |
| `tests/helpers/stranger11-browser.mjs` | The UI-invited teammate chose a password, clicked Sign in, entered the password again and waited for a conversations URL. | The first submission reaches the exact invited inbox, which renders its Inbox heading and Lena Patel's name. The browser's cookie session reports the invited project and operator role. The owner still previews the handoff, edits and sends, confirms assignment after reload, then takes over explicitly. |
| `tests/helpers/identity/native-account.mjs` | The route journey accepted an invitation and then proved ordinary password login. | The carried D20 assertions verify the invitation cookie, scoped operator, direct inbox read, and used, revoked and expired token refusals without session creation. The independent password-login and reset assertions remain. |
| `tests/helpers/identity/two-factor.mjs` | The factor-policy journey signed the agent in after API invitation acceptance. | The carried D20 journey uses the invitation session and preserves the existing exact session-count and revocation assertions. |
| `tests/helpers/identity/magic-browser.mjs`, `tests/journeys/identity-browser.mjs` | The existing owner and security registration started with the owner flows. | The carried journey first exercises teammate acceptance, direct inbox access, sign-out, ordinary sign-in pages and replay refusal. Existing owner magic-link and security checks follow in the same registration. |
| `tests/journeys/inbox-browser.mjs` | The macro registration called the handoff helper. | The registration is byte-for-byte identical and executes the corrected helper. |

The macro helper was the sole stale browser path that clicked Sign in after new-account invitation acceptance. Direct API fixture logins mint the ordinary credentials those callers use and do not assert an extra UI step. The route journey separately proves fresh password login and password reset. Magic-link tests still click Sign in to redeem an emailed sign-in link explicitly. Used, revoked and expired invitation tests assert refusal and the absence of a new session. They do not take the invitation error page's optional Sign in link.

Extra password prompts before the inbox go from one to zero for an ordinary new teammate. Identity route registrations remain 14, identity-browser registrations remain 6 and inbox-browser registrations remain 7. The contract remains 4 done, 71 partial and 16 missing across 91 clauses. IDENTITY-001, IDENTITY-002 and IDENTITY-003 remain partial. CONTRACT.md and both generated views have identical bytes to main.

## Truthfulness review

- The carried identity README describes direct signed-in inbox access. The browser exercises it with a real cookie, the macro journey additionally checks the rendered teammate name, and the native route journey checks the invited operator and workspace. The two-factor test covers the policy exception before workspace access.
- The README's reset sentence reflects the separate reset response and the existing reset and fresh password-login assertions. Its invitation refusal sentence reflects the one-use guard and the cookie, token and persisted-session checks for used, revoked and expired links.
- The local email page says “You can’t receive sign-in emails here. Sign in with your password.” The emitted Worker reports local mail mode, the local magic-link handler refuses requests, and the page offers the password door. The ordinary sign-in screenshot and route checks use a browser without local-owner custody. The guarded installer re-entry door remains available to the installer.
- The carried code has no email-prefilled “Sign in with your new password” screen for a failure after password choice. The existing-account branch offers its own sign-in route. This round preserves the parent product code and claims no fallback evidence.
- Screenshots use the isolated emitted Worker, synthetic accounts and system Chromium. No hosted or paid provider was exercised.

## Product and validation

See `RECEIPT.json` for the exact candidate, touched-check outcomes, before/after counts, push and CI. The fleet's publication scan and independent auth gate follow outside this VM. No PR, deployment or landing was performed.

## Browser evidence

The packet carries fresh candidate captures of the invitation form, signed-in inbox, password sign-in and local email-sign-in screens at 1440px and 390px. Assertions ran at 1440px. The 390px captures are visual proof. The browser test fills the synthetic email after normal sign-out before capturing password sign-in. See `SCREENSHOTS.json` for file dimensions and hashes.

## Results

The product branch was pushed once and the remote ref resolves to the single commit
`15edad251ba4f93b2f8af867764a9d3a415ee5c9`. The final pull-request field is empty because the lane owns landing.
Node 22.20.0, pnpm 10.12.4, the rer build, typecheck, first-party rer check,
source-lock generation and check, both contract checks and the secret-declarations
check passed. Local setup applied 200 migrations to an isolated trial.
The two touched route registrations passed (50.3s total).
The direct emitted-Worker invitation browser helper passed and yielded eight proof images.
The macro registration in the inbox browser journey passed on the final commit
(196.8s total).
Broader coverage was left to Verify.

Exact-head [Verify 44193740986](https://github.com/just-every/run-happytohelp/actions/runs/44193740986) was observed
`in_progress` / `pending`.
The selected composite identity-browser registration also passed (646.8s total).

## Claims

GAP IDENTITY-002: The carried D20 flow has no email-prefilled fallback if session creation fails after password choice.

CLAIM IDENTITY-002 PARTIAL points=none tests=tests/journeys/identity.mjs#the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion; tests/journeys/identity-browser.mjs#a new teammate chooses a password and opens the inbox signed in, and an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session; tests/journeys/inbox-browser.mjs#an owner previews a shared macro handoff to a UI-invited agent, edits and sends without taking over, then explicitly takes over
CLAIM IDENTITY-001 PARTIAL points=none tests=tests/journeys/identity.mjs#the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion; tests/journeys/inbox-browser.mjs#an owner previews a shared macro handoff to a UI-invited agent, edits and sends without taking over, then explicitly takes over
CLAIM IDENTITY-003 PARTIAL points=none tests=tests/journeys/identity.mjs#an owner enrolls factors, enforces teammate enrollment, steps up to export and recovers lost factors with audited single-use authority
