# Business connectors

Settings → Business connections verifies the provider account before storing an
AES-GCM credential using the existing integration key. Accounts have independent
read, prepare, approve and execute grants, optional expiry and a per-action USD
limit. These local grants narrow provider authority; they cannot grant remote
permissions. Credentials never return from a read and are removed from archives.

The ticket's Business context section maps a provider customer ID explicitly.
Operators must confirm the identity; an email match grants nothing. Refresh reads
only the mapped record and projects bounded context, source IDs and sync time.
Disconnect removes the credential, hides cached context and invalidates approvals.
Source providers remain the system of record.

The `/api/business/projects/:projectId` routes compose native sessions and roles.
Installing credentials and approving or executing an action require a recent
identity step-up. Prepared previews retain the exact target, amount, consequences
and reason. Approval and execution are separate commands. Execution re-reads the
provider and refuses changed previews. A durable claim serializes execution;
Stripe receives the action ID as its idempotency key and refund metadata. A
started action never executes twice, including after a lost response. Reconcile
only reads the provider. Success requires provider readback; pending settlement
and unknown results remain uncertain. A pending operation on the same provider
record prevents a second browser request key from bypassing reconciliation.

Implemented provider paths:

- Shopify: verified store and customer order, fulfillment, delivery, return and
  refund context. USD amount refunds allocate explicitly across original tenders.
  Selected-item and full-item refunds use Shopify's suggested tax, shipping and
  tender amounts; every transaction and line allocation is checked on readback.
  Refunds use `refundCreate @idempotent` with the durable action ID. Duty-bearing
  allocations are refused. A return creates approved reverse fulfillment work;
  receipt, restocking and refund are separate. Cancellation is asynchronous and
  deliberately does not refund captured payments; it previews inventory restocking
  and authorized-payment voiding. Both use a send-once claim and marked provider
  readback: Shopify offers no provider idempotency key for these two mutations.
  A lost cancellation job ID with requested restocking stays uncertain.
  Live Shopify sandbox receipts remain pending.
- Stripe: customer, invoice and subscription context; bounded USD payment-intent
  refunds, future-invoice credits, collection pause and cancellation at period
  end. Single-item plan changes preserve quantity and billing interval, preview
  the provider invoice, tax and proration at a fixed date, and verify the paid
  invoice after execution. Quotes expire after five minutes. Broader multi-item
  and billing-interval changes are refused.
- HubSpot and Salesforce: independent account verification, contact and related
  company/account context with source IDs, relationship labels, owner, plan,
  entitlement and freshness. Contact and account property mappings stay separate;
  sales lifecycle never grants support entitlement. Settings explicitly lists
  editable contact/account properties. A field edit previews exact old/new values,
  validates provider metadata, requires approval, rechecks the source revision and
  relationship, and PATCHes only approved properties. Salesforce uses
  `If-Unmodified-Since`. HubSpot has no documented conditional update, so the UI
  states that limitation; observed conflicts refuse execution or remain uncertain.
  Related-account writes refuse incomplete relationships. Approved outcomes remain
  notes/activities and require exact content and association readback. Lost field
  writes reconcile by reading the approved values without replaying the PATCH.
  Live provider receipts remain pending. Orbit remains unavailable on run-orbit
  API-001's missing scoped public records API.

The panel records results in the originating ticket for the operator. It sends
nothing to a customer automatically. After a provider-confirmed commerce or
billing result, a human can review and send an edited confirmation through the
normal native message admission; duplicate clicks retain one reply.
No raw card data is requested, stored or displayed. HappyToHelp holds no funds.

Erasure removes local mappings, snapshots, reasons and action records and fences
in-flight completions. An external erasure task explicitly records that provider
copies and legally retained financial records need separate handling. Restore
removes credentials and snapshots, cancels unexecuted approvals and preserves
started outcomes as uncertain; it never resumes execution.

`tests/helpers/business-connectors/journeys.mjs` extends the existing API credential lifecycle in `tests/journeys/connections.mjs` through the
existing credentials, API, erasure and uncertainty journeys. Provider fixtures
prove local protocol behavior only; they are not live sandbox receipts. The
campaign separately exercised a held Stripe test key through verified account
settings, a paid USD invoice, one refund with a deliberately lost response,
provider reconciliation, a reviewed customer-visible confirmation, a paid prorated plan change,
future-invoice credit, collection pause and period-end cancellation. That receipt is kept outside product source. Shopify, HubSpot and Salesforce live
sandbox receipts remain pending. Orbit means the fleet Sales CRM in
`just-every/run-orbit`; its API-001 still lacks admin-issued scoped public
credentials and a general public records API. Orbit is explicitly unavailable
here until that prerequisite ships. No community service or native browser
session stands in for that integration.
