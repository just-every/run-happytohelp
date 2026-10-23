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
  refund context. Bounded USD amount-only partial/full refunds on single-gateway orders use
  the 2026-10 `refundCreate @idempotent` mutation and ledger readback. Return,
  cancellation, multi-tender and tax/shipping allocation remain gaps, along
  with live Shopify sandbox receipts.
- Stripe: customer, invoice and subscription context; bounded USD payment-intent
  refunds, future-invoice credits, collection pause and cancellation at period
  end. Single-item plan changes preserve quantity and billing interval, preview
  the provider invoice, tax and proration at a fixed date, and verify the paid
  invoice after execution. Quotes expire after five minutes. Broader multi-item
  and billing-interval changes are refused.
- HubSpot and Salesforce: independent account verification and contact
  context, source freshness and approved outcome activities/notes. Provider
  sales lifecycle is not a support entitlement. Plan and support-entitlement properties are explicitly selected in Settings;
  no lifecycle inference grants support rights. Complete company/account
  relationship mapping and approved arbitrary field edits remain gaps.
  Both live provider protocols still need sandbox proof.

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

`tests/connections/business.mjs` folds network-boundary scenarios into the
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

Repeat the bounded held-key qualification with
`python3 -I <fleet-root>/briefs/_od08-env.py STRIPE_SECRET_KEY=STRIPE_TEST_SECRET_KEY -- node tests/helpers/business-connectors/stripe-sandbox.mjs`.
It refuses live keys, creates only marked synthetic provider records, forwards
real Stripe requests without transport framing headers, and removes its own
customer/subscription and archives its prices/product. It prints only check
names and status counts; it never runs in Verify or writes credentials to disk.
The 23 October 18:39Z run passed all eight checks, including one refund POST
after a deliberately lost response and explicit read-only reconciliation.
