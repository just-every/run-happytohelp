# First-run setup

Prepare the first owner through [Install](INSTALLER.md), using
`rer setup --owner-email you@example.com --answers .seed/local-answers.json`.
Setup creates the native owner and first workspace before it exits. Start with
`rer dev` and wait for `RER_READY`. Open `RER_OPEN` to enter as the
real local owner and reach **Setup**.
The owner decision retains native passwords, prior account/workspace data and
HappyToHelp's own tenant/permission checks.

## Do you need this page?

Use this guide for the one-screen first run, the in-app **Setup** page and the native first-owner
boundary. A rer local installation already has an owner. An existing installation
never creates another owner through setup. A remotely deployed installation is claimed by `rer deploy`
for the owner named by `OWNER_EMAIL`, who then signs in by email (`rer signin` does not
yet work with this seed's native sign-in). Its private first-owner setup capability and native `/setup` page over
the configured HTTPS origin are recovery only. Keep the capability private and enter it
only in the owner form. It is not a sign-in shortcut and is closed permanently after claim.

## Create your owner account and workspace

First-run setup is one screen: your email, a password, your website and, on a
hosted installation, the private setup token. Local setup takes the same
answers from the private file; only the website and the owner password are
required, and the owner email comes from the command. Anything you do not give is
derived: the workspace name from your website (or your company email domain), your
name from your email and a default colour. When the website is a `workers.dev`
deployment address, the default workspace name is **My workspace** regardless of
the owner email; an explicitly chosen native workspace name takes precedence.
Each can be changed afterwards. Native bootstrap checks origin, validates inputs and claims the first owner atomically.
Failed claims do not leave partial credentials or memberships. Concurrent claims
cannot create two owners. Imported identity state also closes first-owner setup.

On a hosted installation `rer deploy` has already claimed the owner; sign in by
email. Only to recover an unclaimed empty installation, enter the private setup token in
the native form. Keep tokens and passwords out of shell arguments, URLs, recordings and
logs. After a recovery claim sign in with the native password.

Pressing **Create workspace** is your explicit action, and it may send you one
welcome email at the address you gave. It goes through the same durable send path
as every other mail, so it is never sent twice, and a send whose outcome is
unknown is reported as unknown and never replayed. Local mail uses rer dev v2;
it is suppressed without storage or external sending. Setup succeeds whatever
happens to that email.

### The widget website origin

The website hosting the widget is separate from the HappyToHelp app origin.
Supply an exact HTTP(S) origin: scheme and hostname, with an explicit port when
needed, but no path, query, credentials or fragment. The widget is admitted on
the saved website origin and always on the HappyToHelp app's own origin. Configure
the external website through **Settings → Widget → Settings**; keep the app address
in the installation snippet. Do not expose an operator token or the server
verification secret to customer code. See [the local widget walkthrough](INSTALLER.md#try-the-customer-widget-locally).

## After setup

The workspace is already set up when you arrive. Every new workspace (the first
owner's, one created while signed in and one created by email-verified
registration; never a demo workspace) is provisioned in one step with:

- a starter assistant, "Support assistant", as the default visitor assistant. It
  answers visitors by itself from the help articles you publish and from what we
  read on your website, within the daily AI ceilings, once an AI provider key exists on the installation. With no key, no
  assistant is assigned to a new conversation, so it stays with your team and
  nothing fails or pretends to succeed. The AI page and Setup say a key is missing
  and which secret it needs. The key is an installation secret: add it to `.dev.vars`
  locally, or as a Worker secret, as in [Install](INSTALLER.md#private-setup-answers)
  and the README's [AI replies](../README.md#set-up-ai-replies) section;
- a reply-by-email mailbox, when the installation holds `INBOUND_EMAIL_TOKEN`,
  on `in.` plus your website's host or on `INBOUND_EMAIL_DOMAIN`;
- the installation sender for mail, until your own sending domain is verified,
  and then your own address;
- a one-time read of your website that keeps up to eight of its pages as private
  knowledge your assistant can answer from, and may fill in your name and colour
  while you have not changed them. It runs once, it is best effort (a site that
  cannot be read leaves nothing and no error), and it publishes nothing: no article
  is written and none is public. Existing drafts from earlier reads are left as
  they are.

Sign-in opens the workspace's **Setup** page: **Needs you** lists only what cannot
be done for you, widget first (adding the widget to your website), then connecting
an AI service and, with a hosted email provider, the DNS records for your sending
domain. **What we've set** lists the rest, each with a **Change** link. The system
runs its own checks while the page is open: observations of mail to you, sender
DNS, inbound receipt, model access, spend ceilings, saved widget origin and an
authenticated widget visit. A published help article is not one of them: the
assistant also answers from your own site, so the article step is hidden and never
counts. The page counts what is confirmed against what can be confirmed on this
installation ("N of M confirmed"). Defaults, presets and saved configuration do
not count; a step is confirmed only when it is observed.

Each item under **Needs you** has **Skip for now**, for something you do not want
to do yet, such as connecting an AI service. A skipped item moves to **Skipped**,
with **Undo**, and leaves the count: M shrinks by one, and the heading reads "All
set" once nothing is left under **Needs you**. A skipped item is never shown as
confirmed. The skip is kept by the server for the workspace (not in your browser),
so it lasts a reload and a new sign-in; only an owner or admin can make it, and it
contacts no provider and sends no mail. If you skip something and it is later
observed (the widget is seen on your site, a working key is added), it shows as
confirmed and counts. A key the provider rejects stays under **Needs you**, because
a problem is not hidden by a skip.

Mail to you is confirmed by using an emailed sign-in link, or by the provider's
reported outcome for the welcome email or the test you send from the Email page
(**Send me a test**). Provider acceptance is pending, and suppressed local mail
never confirms delivery. GET inspection performs no provider work. The page's
own checks read metadata and DNS, never send mail and never request a generation. Only your
explicit action sends mail, to your own mailbox; uncertain work is never replayed
automatically. See [the activation module](../src/modules/management/activation/README.md)
for the shape of the snapshot and the freshness windows.

Ordinary workspace creation starts with the widget snippet. **Advanced** holds
server secrets and verification examples. Empty inbox actions offer widget
installation, a link to Setup and a separate demo; demo content is
explicit and never replaces customer data. See [Workspace workflows](WORKSPACE-WORKFLOWS.md).

## Local sign-in and private state

Only trusted local configuration enables rer dev v2 owner entry and mail.
Open `RER_OPEN` to enter as the real local owner. Visitor and teammate mail use
the development transport: it validates and suppresses messages, reports
`development`, and keeps no message store or viewer. Production does not expose
this local surface, and real mail failures remain failures. Native passwords and permissions remain
in force.

Stop dev before reset/export/import. Use [Operations](../OPERATIONS.md#local-data-and-backups)
for confirmed reset and private backups. Re-running setup preserves existing
owners and settings; it never rotates secrets or erases data.
