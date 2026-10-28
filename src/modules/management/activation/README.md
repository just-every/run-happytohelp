# Activation observations

The management router mounts `GET /projects/:projectId/activation`, `POST
/projects/:projectId/activation/check`, `POST /projects/:projectId/activation/skip`, `POST
/projects/:projectId/activation/local-trial` and `POST /projects/:projectId/activation/test-mail`.
All require current owner/admin membership (an anonymous caller gets 401; a contact, an
operator, another workspace's owner and a deleted workspace are denied); sending test mail additionally requires
owner role and always targets that authenticated owner's current email address.
The public HTTP prefix is `/api/management`.

## The snapshot

Every route answers with the same snapshot (`ActivationSnapshot` in `types.ts`): the
eight steps with their observed state, `total` (8), `done`, `checkedAt`, and for the
Setup page `environment` (`local` for a trusted loopback trial whose development
transport suppresses email, as `localMailOrigin` in `src/edition/local-mail` decides,
else `hosted`), per-step
`placement` (`needs_you`, `set`, `hidden` or `skipped`) and `applicable`, `applicableTotal`
(without skipped and hidden steps), and `facts`. `done` counts only steps that are both
observed `done` and applicable, so it never exceeds `applicableTotal`. Facts are stored or
installation values (workspace name, website, colour and its source, mail mode and
provider, the starter assistant, inbound mailbox, AI ceilings, sender DNS records, widget
key and script URL). They never
contain a key, token, secret value or fingerprint; key presence is a boolean.

Placement: the widget and the AI service are `needs_you` until observed `done`. The
published-article step is always `hidden` and not applicable: it stays among the eight
ids but is never observed, and publishing an article changes neither count (the
assistant also answers from the owner's own site). Sender DNS is `needs_you` on a hosted Resend installation, a `set`
row that is not counted on a hosted installation whose provider has no status API,
and `hidden` locally. Receiving replies is not counted locally. Everything else is a
`set` row, and any step observed `done` counts. A preset, default or saved
configuration never makes a step `done`.

## Skipping

`POST .../skip` takes `{step, skipped}` (strict: no other keys; `skipped` must be a
boolean) for `widget_seen`, `model_key` or `sender_dns`; any other id is a 400. It does
no provider work, sends no mail and answers with the snapshot. The skip is the key
`activation_skips` (`{stepId: skippedAtMs}`) in the project settings, written by one
atomic statement (`skips.ts`) that handles skip and undo; repeating either is a
no-op. A stored skip turns a step that would be `needs_you` into `skipped` and not
applicable. It is ignored once the step is observed `done` (a confirmed, counted
row) or `failed` (a rejected key is a problem, not hidden), and it changes nothing for
a step that is not a need right now (such as sender DNS on a local installation).

`POST .../local-trial` takes `{}` (strict) and is the Setup page's "Try locally without a
website or AI key": on a local installation it skips `widget_seen` and `model_key`
together, in one transaction of the same statements (`skipLocalTrial`), and answers with
the snapshot. A hosted installation answers 409; its owner skips each step on its own.

## Reading and checking

GET performs no provider requests and writes nothing. It compares stored fingerprints
with current configuration: a changed configuration, an interrupted check (60-second
lease) or a model or DNS validation older than 15 minutes reads as `unknown` until
the next check replaces it.

`POST .../check` takes `{step?, auto?: true}`. Without `auto` the named step, or all
eight, run now, behind the per-step 60-second lease. With `auto` (the Setup page's
own checks) a step is left as it is while its observation is fresh: provider-backed
steps (model, sender DNS, owner mail) for 15 minutes once done and 60 seconds
otherwise; local steps until they are done. A changed configuration always runs
again, and a used sign-in link is always picked up. Checks are non-generative
metadata, domain and DNS reads; they never send mail and never request generation.

Before the model check, an untouched starter assistant (equal to the `starter_ai`
seed in project settings) whose provider has no key moves to the starter model of a
provider whose key is installed, and its seed follows so it still reads as untouched.
An assistant the owner edited is never changed.

## Observations

Email to you (`owner_mail`): a sign-in link emailed to a current owner of the
workspace at their current address (delivery recorded `sent`) and then used confirms
it with no provider request, whichever workspace the link was issued for (links are
issued for the person's first workspace, so one link confirms every workspace they
own); password sign-in, an unused link, a link used by someone who is not an owner
of this workspace, or a link to an address the owner no longer has do not count.
Local development reports mail as suppressed and leaves delivery pending: no
email is sent, no message is stored and no viewer is exposed. Automatic dev owner
entry and password sign-in do not confirm email delivery. On hosted installations,
the latest owner-requested mail (the activation test mail or the first-run welcome
email, idempotency key `welcome:...`) is reported as its provider reports it:
providers without a status API report acceptance only; Resend completion requires
a matching message ID, current sender,
exact owner recipient and `last_event=delivered`. A durable sendEmail command fences
repeated clicks and uncertain sends; uncertain mail is never resent.

Sender DNS reads Resend's domain list and detail only; it never creates a domain.
It checks the domain of the workspace's `proposed_sender` (project settings) while
one is set, otherwise the domain mail is sent from. Domain completion requires
matching domain identity plus verified SPF/DKIM records plus shared SPF, DKIM and
DMARC TXT checks. The domain's records (type, name, value, status) are kept with the
receipt and returned as `facts.senderRecords` while they describe the current
configuration. When the proposed sender's domain is observed verified, the same
observation switches `email_settings.from_address` to it, by compare-and-set and only
while it is still the installation sender (`EMAIL_FROM`) it was seeded with, so an
address the owner chose is never overwritten; the mailbox version is untouched. The
switch is recorded as `sender_switch` in project settings and reported in
`facts.mail.senderSwitch`. Mail an owner received from the replaced installation
sender still counts for Email to you.

Inbound observations capture the enabled mailbox and its settings version at
native inbound admission, using the migration trigger, then join the actual
delivered receipt and reconstruct its immutable recipient intent from a plain-text message without attachments. This rejects configuration races that could otherwise misattribute an old-address message. Old receipts are not backfilled. Checking sends nothing and
cannot trigger an AI/email loop. Widget observations are recorded only for
accepted authenticated contact `pingActive`/`pingAction` commands carrying the
current allowed origin, excluding owner preview. Changing origin removes them.

Spend ceilings describe validated automatic-work
limits and their UTC reset, never a provider account hard billing cap.

Provider API references:
- https://resend.com/docs/api-reference/emails/retrieve-email
- https://resend.com/docs/api-reference/domains/get-domain
- https://resend.com/docs/api-reference/domains/list-domains
- https://platform.openai.com/docs/api-reference/models/retrieve
- https://platform.claude.com/docs/en/api/models/retrieve
- https://ai.google.dev/api/models
- https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
- https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails

OpenRouter completion requires authenticated key metadata and the selected model
(using the generation registry’s provider ID) in the account-filtered model list.
It does not prove a paid generation.

Local tests intercept these HTTP boundaries only. They never establish real
provider permission, DNS propagation, delivery, generation or timed installation.
