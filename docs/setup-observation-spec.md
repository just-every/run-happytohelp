# Setup observation rules

An owner sees the durable,
project-scoped eight-step list on the Setup page; the genuinely empty inbox
shows one next action and a link to it, and loads none of it. A
step is confirmed only by an observation, never by a saved configuration, an
installer default or a preset, so a workspace with nothing observed yet is zero
of its applicable steps. The system runs its own checks: while an owner is signed
in the page asks the server to observe, bounded by freshness windows. These
checks are non-generative metadata, domain and DNS reads and never send mail.
They distinguish saved configuration from observed sender DNS, authenticated
model metadata, an inbound receipt, effective runtime ceilings, allowed origin
and an authenticated widget ping; whether an article is published is not one of
them (that step stays among the eight ids but is hidden and never counted). Mail to the owner
is confirmed by a used emailed sign-in link, or by the provider's reported outcome
for the welcome or test email; local development mail is suppressed and never
confirms delivery, and provider acceptance or queueing is pending. `GET` performs no
provider work and writes nothing. Only an explicit owner action (Create
workspace, or Send me a test) may send mail, to that owner's mailbox, with
durable identity; ambiguous work is never replayed. Missing provider permissions
and unsupported status APIs remain unavailable. Configuration changes invalidate
observations; model and DNS validation expire after 15 minutes and every
observation shows its time. The owner can skip an owner-only step (the widget,
the AI service, the sending domain) for now, and undo it. A skip is stored on the
server for the workspace, can be made by an owner or admin only, makes no provider
request, and moves the step out of Needs you and out of the confirmed count and its
total; a skipped step is never shown as confirmed. An observation always wins: a
skipped step that is later observed is confirmed and counted, and a rejected
provider key stays under Needs you whether or not it was skipped. Provider keys and
their fingerprints never enter API responses or browser storage.
