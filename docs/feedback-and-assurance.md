# Feedback and regulated-deployment qualification

## Source-linked feedback

Open a conversation’s **Ticket → Product feedback** section. Select a customer
message and link its existing Penny request and Vector or other engineering issue.
HappyToHelp retains the selected quote, customer, account and original conversation.
Internal notes and other tickets cannot be selected as the supporting quote.
Penny owns aggregation, prioritization, roadmap, changelog and requester closure.
HappyToHelp continues to own the customer response.

An administrator connects their own public HTTPS Penny installation with a scoped
API key granting `votes:write`. Credentials are encrypted under the installation’s
integration key and never appear in ordinary reads. Link a Penny request using its
`/portal/feedback/request-slug` URL. **Preview Penny handoff** shows the selected
quote (up to 2,000 characters), account label, requester name or previously linked
Penny requester, and support URL. No email, internal note or attachment is shared.
Select the requester’s explicit sharing permission from the same conversation,
review the preview and approve the handoff. A changed preview requires another
review. This uses Penny’s `POST /api/v1/requests/:slug/proxy-votes` API; it links an
existing request, rather than creating or prioritizing one.

A confirmed receipt is retained once. If a response is lost, its outcome is unknown:
check Penny directly. HappyToHelp never automatically replays that source, including
after restart or restore. Disconnecting Penny stops new handoffs; it cannot recall
what Penny already holds. Keep the same Penny installation when rotating a key
once requester history exists.

## Shipping events and service updates

Service updates default to **Off**. Select a requester-authored message giving
permission for the update, then subscribe that source. This preference is separate
from approval to share feedback with Penny. An operator can opt out immediately.
An authenticated requester can also opt out through
`POST /api/feedback/conversations/:conversationId/opt-out`; a requester-facing widget
preference control is not supplied in this preview.

Configure a release signing secret of at least 32 characters in **Release
connection**. A trusted release sender or bridge posts to the displayed receiver:

```json
{
  "id": "release-event-identifier",
  "issue_url": "https://tracker.example.com/issues/export-progress",
  "release_url": "https://releases.example.com/export-fixed",
  "released_at": "2026-10-23T12:00:00.000Z"
}
```

Send `X-HappyToHelp-Signature` as the hexadecimal HMAC-SHA256 of the exact UTF-8
request body with the configured secret. Use the same event identifier and bytes
on retry. The linked engineering URL must match. Conflicting reuse of an event id
is refused. Events have a 32 KiB body limit and create drafts only for subscribed,
available requesters. Revoking the signing secret stops intake.

Preview and edit the resulting service update, then explicitly **Approve and send
service update**. It uses the original conversation’s existing reply and channel
policy. A shipped fix does not verify recovery or close the support request.
Closed-ticket reply restrictions still apply. A still-failing customer stays open
for the support team. An opt-out cancels unsent drafts and prevents new drafts.

The Penny API path and signed release receiver have network-boundary tests. No
live Penny/Vector or buyer-tracker sandbox receipt is included. Qualify your own
provider account and release bridge before production use.

### Configure your release sender

Run Edit Run fleet, 17 November 2026.

Use a script or bridge controlled by your release team; an ordinary GitHub,
Linear or Jira webhook does not have this receiver's payload or signature.
Generate a secret on your own machine with `openssl rand -hex 32`, save it in
**Ticket → Product feedback → Release connection**, and store that same value
in your sender's private secret store as `H2H_RELEASE_SECRET`. Store the displayed
Release receiver URL as `H2H_RELEASE_RECEIVER`. Keep both out of source control.
A local receiver is reachable only from the same machine; use your hosted HTTPS
receiver for a remote release sender.

Save the following as `send-release.mjs` in your own release tooling. It reads a
JSON payload from standard input and uses the exact bytes for signing and sending.
Your sender's secret store must supply the two environment variables above.
It uses Node's official [HMAC API](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options).

```js
import { createHmac } from 'node:crypto';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const body = Buffer.concat(chunks);
const secret = process.env.H2H_RELEASE_SECRET;
const receiver = process.env.H2H_RELEASE_RECEIVER;
if (!secret || secret.length < 32 || !receiver) throw Error('Configure receiver and signing secret');
if (body.length > 32768) throw Error('Release body exceeds 32 KiB');
const signature = createHmac('sha256', secret).update(body).digest('hex');
const response = await fetch(receiver, {
  method: 'POST', redirect: 'error',
  headers: { 'Content-Type': 'application/json', 'X-HappyToHelp-Signature': signature },
  body,
});
console.log('Release receiver HTTP status:', response.status);
if (!response.ok) process.exitCode = 1;
```

Create `release.json` using the shape above: replace its event identifier, URLs
and release time with the real release. `issue_url` must exactly match the
engineering URL already linked in HappyToHelp. `released_at` is the actual ISO
release timestamp, not a future schedule. Run `node send-release.mjs < release.json`
from your sender environment. There is no API bearer token or OAuth callback for
this receiver. The signature is only the 64-character hexadecimal digest, with
no `sha256=` prefix; never send the secret itself.

A successful response confirms intake, not a customer send. Inspect the resulting
draft in Product feedback and approve it separately. For a failed or uncertain
request, inspect the receiver and retained event before retrying. Reuse the exact
same event ID and bytes; changing the body with an existing ID returns 409.
Replacing or revoking the connection secret invalidates the previous sender secret.

## Erasure and archives

Customer erasure removes selected feedback quotes, requester mappings, pending
updates and handoff copies, including quotes authored by a participant in another
requester’s ticket. Other requesters keep their independent links. Stale commands
and release events cannot recreate erased sources. External Penny/tracker copies
remain explicit provider deletion work; neither those copies nor sent messages
are claimed to have been recalled.

Portable archives keep source and qualification history, strip Penny and release
credentials, reset subscriptions to Off, cancel pending approvals and restore
interrupted handoffs as unknown. Reconnect providers and separately authorize
future work. Staged ownership checks reject foreign-workspace and erased-source
relationships before restore.

## Regulated deployments remain unqualified

**Settings → Regulated deployment** is an administrator’s qualification preview.
It does not supply HIPAA, SOC 2 or FedRAMP assurance. Before requesting qualification,
prepare a separate isolated deployment, export your data and disconnect unqualified
mail, automation and public channels. Requesting qualification records a preflight for independent review and keeps
health-data activation disabled. It does not intercept ordinary support access or
qualify existing channels. Administrators retain the ordinary security-log,
retention and customer-erasure controls.

Record the qualification partner/provider, isolated deployment reference and IANA
timezone. This preview requires United States contracts, USD, recording disabled,
and approved US processing with no model training, explicit provider retention and
BAA coverage. These are recorded requirements, not an observation of provider
account settings. Configure native security-log retention and legal holds through
**Security log**.

Record current executed DPA/BAA references, approved subprocessors/model handling,
and passing deployment receipts for tenant isolation, permissions, audit,
retention, recovery, erasure, export, incident response and channel consent. Use
controlled HTTPS evidence references without credentials, queries, fragments or
customer content. Evidence has an effective time, expiry, recorder and revocation.
Missing, expired and revoked records are visible blockers. The downloadable
qualification record includes the current assessment and references, not support
transcripts. All changes and refused activation attempts are audited.

Even a complete set of manually recorded receipts only becomes **ready for
independent review**. Health-data activation remains disabled pending independent
partner review of actual executed agreements and representative sensitive-data
acceptance on that isolated deployment. Mail, background automation and remaining
public doors are not qualified by this preview. Successful activation, sensitive-data access enforcement and
withdrawal of a previously qualified deployment remain unimplemented. Keep health
data out until those paths and the live provider/partner qualification are proven.
