# HappyToHelp D20: invitation password choice opens your inbox

Run Edit Run fleet, 2026-11-17. Repository: just-every/run-happytohelp. Branch: cloud/hh-owner-design-d20-1.

## Result and provenance

Started from fresh origin/main b6f16fc44feaad1164753d895419bb78e61e40e3, the newest main at the initial clone and the subsequent merge check. Preserved owner-fix-1. Product save: 26eb80e28ebc9aea7737a26315ede5f102ca184e (`[skip ci]`). Final candidate: d36288793b599c22034881a6eeda46e71c01dd37. No PR was created; the fleet owns landing. CI observation is recorded separately in CI-RECEIPT.json when complete.

## Before and after

Before: a new teammate accepted the invitation by choosing a password, reached an account-ready screen, then had to sign in again. That screen said “Sign in once with the password you just chose to open it.” Both ordinary password sign-in and the local email sign-in page could address that teammate as the installer/local owner.

After: only successful new-account invitation acceptance issues a normal native password session. The browser opens the invited workspace inbox directly. A workspace requiring two-factor enrollment still requires it before the inbox; choosing a password does not bypass that policy. The invitation fixes the tenant and role, including the collaborator overlay. Failed, used, revoked and expired links never issue a session. The existing atomic token guard, sibling-link retirement and password-reset sign-in boundary remain in place.

The ordinary password page no longer displays the blanket rer-dev/local-owner instruction. The local email sign-in page says “You can’t receive sign-in emails here. Sign in with your password.” The existing guarded local-owner re-entry door is retained. Installer instructions already exist in README.md (local setup and launch) and docs/INSTALLER.md (local entry); those documents and the Setup page were preserved.

Extra password sign-ins after joining: 1 → 0. Identity registrations: 14 → 14. Identity-browser registrations: 6 → 6. No registration was added or removed. Recorded contract summary: 4 done / 71 partial / 16 missing / 91 total → unchanged. IDENTITY-001, IDENTITY-002 and IDENTITY-003 remain partial; no Status, Gap or Evidence cell was edited. No migrations, release metadata, pins, Base sources, Setup counter, time-zone or widget behavior were changed.

## Implementation and authority checks

- `src/modules/identity/accounts.ts`: the successful guarded invitation consumer uses the same native session table, 24-hour lifetime, sessionCookie helper, password factor statement, signInFactor policy and sign-in audit mechanism as password login. Session creation is reached only after successful one-use consumption. Reset tokens continue to return loginRequired without a new session.
- `src/ui/identity/AcceptInvitation.tsx`: successful account creation navigates directly to the returned inbox destination, or required second-factor enrollment. Removed the intermediate account-ready/sign-in screen.
- `src/ui/identity/Login.tsx` and `MagicLogin.tsx`: ordinary teammate sign-in has no installer instructions. The explicit, existing local-owner custody door was not altered.
- Existing identity journeys now assert the invitation cookie can read the inbox with the invited project/role, reused/revoked/expired links return no cookie/token or stored session, and a collaborator under factor policy cannot read workspace data before enrollment. The existing factor-policy journey uses the invitation-created session and proves that a later policy revokes it; its exact one-session assertion is retained.
- The emitted-Worker browser journey accepts an invitation, chooses a password, reaches the inbox with the teammate's real cookie session, signs out through the teammate menu, and inspects both sign-in pages on the local trial. It also refuses invitation replay without a new session. Assertions run at 1440; phone images are separate proof captures.

## Validation and truthfulness

Typecheck, `rer check --profile first-party`, source-lock check and `npx -y @runeditrun/rer build` passed on pinned Node 22.20.0 / pnpm 10.12.4 at the candidate SHA. The complete identity journey passed 14/14, including local owner re-entry, local trial password choice, time-zone and widget confirmation regressions. The selected identity-browser registration passed 1/1 (637.1 seconds), including the complete invitation and existing owner/security/auth-return journey. Exact-SHA Verify is recorded in its actual receipt.

The first identity run at the save had 13 passes and one failure: factor policy observed two sessions because the old test signed in again after invitation acceptance. The correction uses the invitation session rather than adding a redundant sign-in; the unchanged policy count and revocation assertions now pass. No failing security assertion was removed or weakened.

Removed the “Sign in once…” sentence because the real session now opens the inbox. Removed the blanket installer/local-owner sentences because mail mode alone does not identify the installer. Replaced the local email-page promise of automatic owner access with the available password action. Code inspection follows emailMode and the local magic-link refusal; a real local route probe records the refusal without outbound delivery. Inbox access and invitation refusal claims are backed by the native and emitted-Worker runs. No hosted/live-mail or paid-provider qualification is claimed.

The source lock was regenerated after tracked edits. The final candidate is a real non-skip commit. Fleet identity and trailers are inspected across every candidate commit before each product push. The full publication scan is a separate fleet/Mac gate and is unavailable in this cloud task; this report does not waive it.

## Plan and scope

The complete plan is PLAN.md. Work followed its six steps: inspect current main; issue the native invitation session; remove misplaced installer wording; extend existing public-door journeys; validate and regenerate the lock; push the named candidate, observe exact-SHA Verify and publish the explicit non-secret packet separately. Reports, receipts and screenshots are outside the product branch. One transient fetch rejection (HTTP 503) recovered after launcher refresh and the prescribed first backoff. Product pushes use the fleet guard. No main push, force push, self-gate, deployment or landing was performed.

## Screenshots and receipts

All eight candidate proof images were visually reviewed and copied to `screenshots/`. Files selected from `teammate-invitation/` only: `accept-invitation-1440.png`, `accept-invitation-390.png`, `inbox-after-password-1440.png`, `inbox-after-password-390.png`, `teammate-sign-in-1440.png`, `teammate-sign-in-390.png`, `teammate-email-sign-in-1440.png`, `teammate-email-sign-in-390.png`. The first three screen pairs meet the brief; the fourth records the other sign-in surface where installer wording was removed. No browser state or capability URLs are published.

BUILD-RECEIPT.json, TEST-RECEIPT.json, MAIL-RECEIPT.json, SCREENSHOTS.json, CI-RECEIPT.json, COUNTS.json and the selected actual logs record command results and provenance. Evidence publication is separate from product readiness and acceptance.

## Claims

D20 is implemented. These are scoped contributions, not a promotion of the broader identity clauses or a replacement of their existing gaps.

CLAIM IDENTITY-002 PARTIAL points=none tests=tests/journeys/identity.mjs#the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion; tests/journeys/identity-browser.mjs#a new teammate chooses a password and opens the inbox signed in, and an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session
CLAIM IDENTITY-001 PARTIAL points=none tests=tests/journeys/identity.mjs#the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion
CLAIM IDENTITY-003 PARTIAL points=none tests=tests/journeys/identity.mjs#an owner enrolls factors, enforces teammate enrollment, steps up to export and recovers lost factors with audited single-use authority
