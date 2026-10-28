# Source-linked feedback

`routes.ts` owns native source capture, service-update preferences and approved
conversation replies. `penny.ts` owns the existing-request attribution adapter;
`events.ts` owns the signed release receiver. The ticket panel is under `ui/`.

Source quotes come from a selected customer message in the same workspace and
conversation. Sharing with Penny and receiving service updates have separate
requester permissions and explicit operator actions. Penny approval binds the
exact preview. The native conversation admission predicate rechecks the current
subscription and privacy fence before admitting an approved service update.
Every release is identified by workspace plus external event id and exact body
digest. A release never resolves the customer request.

Penny writes use the edition’s existing bounded HTTPS transport, encrypted
installation custody and a durable pre-send claim. A lost receipt is unknown and
never automatically replayed. Source capture, preferences, approvals, connection
changes and release intake join the native audit log without quote or credential
content. `erasure.ts` participates in the existing contact-erasure transaction.

The portable archive policy strips credentials, disables subscriptions, cancels
pending reply approvals and preserves interrupted provider writes as unknown.
Staged validation checks workspace and source ownership before restore. See
`docs/feedback-and-assurance.md` for the provider API contract, setup and limits.
