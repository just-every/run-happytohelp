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
mail, automation and public channels. Requesting qualification places native
operator, API and widget-session access on hold. There is currently no remove-hold
or health-data activation action. Administrators retain qualification, security-log
and customer-erasure remediation controls.

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
public doors are not qualified by this preview. Successful activation and
withdrawal of a previously qualified deployment remain unimplemented. Keep health
data out until those paths and the live provider/partner qualification are proven.
