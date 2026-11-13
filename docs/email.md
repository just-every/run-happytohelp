# Support email

Use **Settings → Email** to configure sending, forwarding and connected mailboxes. Mailbox connections, sender addresses and signatures belong to the current workspace. Owners and admins manage connections; ordinary ticket permissions still apply when an operator sends a reply or creates a ticket.

Forwarding uses the installation's email provider. Connected mailboxes receive and send through the account you authorize. Disconnecting stops intake and sending while keeping ticket history.

## Installation email choice

Choose **Email off**, **Your email provider** or **Run Edit Run managed email** in native setup. Platform installations use the existing **Settings → App settings** and owner Publish flow when the platform carries this mail-choice contract. Workspace **Settings → Email** manages mailboxes and senders; it does not store installation provider keys.

| Choice | Selection bindings | Active provider bindings |
| --- | --- | --- |
| Off | Setup `MAIL_MODE=off`; deployed as `MAIL_MODE=off` and `MAIL_PROVIDER=none` (`MAIL_PROVIDER=disabled` is also accepted) | No sending credentials, sender or Mailgun signing key. Saved provider keys stay dormant. |
| Own provider | `MAIL_MODE=own` (legacy `MAIL_PROVIDER=direct` remains accepted), plus `EMAIL_PROVIDER=resend`, `sendgrid`, `cloudflare` or `mailgun` | `EMAIL_FROM`; Resend/SendGrid: `EMAIL_API_KEY`; Cloudflare: `EMAIL_API_KEY` and `EMAIL_ACCOUNT_ID`; Mailgun: `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAILGUN_SENDING_KEY`, and `MAILGUN_WEBHOOK_SIGNING_KEY` for receiving. |
| RER | `MAIL_MODE=rer` | Platform-assigned `MAIL_FROM`, `MAIL_RELAY_URL`, `MAIL_API_KEY`, `H2H_RER_MAIL_VERSION`, `RER_MAILBOX_ID`, `RER_MAIL_ADDRESS`, `RER_MAIL_CONTROL_URL`, `RER_MAIL_INGRESS_KEY`. Own-provider keys stay dormant. |

Native deployment also retains the existing `MAIL_API_KEY` and `MAIL_PROVIDER_API_KEY` aliases for Resend, SendGrid and Cloudflare, and `MAIL_ACCOUNT_ID` for Cloudflare. These aliases are withheld while Off. `INBOUND_EMAIL_TOKEN` may remain for other authenticated receiving paths; it grants no sending authority and the no-mail check explicitly permits it.

Native Cloudflare setup calls its entered token `CLOUDFLARE_EMAIL_API_KEY`; deployment maps it to `EMAIL_API_KEY`. For Mailgun, `MAILGUN_REGION` is `us` or `eu`. `EMAIL_API_KEY_NAME=MAILGUN_SENDING_KEY` remains compatible; omitting it selects the same binding. Mailgun never uses `EMAIL_API_KEY` as its sending key.

### Outbound email off

With Off selected, sign-in links, password resets, invitations, notifications, replies by email, the test send and surveys each report that outbound email is off. **Settings → Email** and **Setup** show the state. Imports and work that does not send remain available. Mailgun forwards are refused: Off withholds `MAILGUN_WEBHOOK_SIGNING_KEY` too. Owners use their password or a one-time link from `node scripts/hosted-signin.mjs`.

You can keep provider values in private local configuration or the platform's encrypted store while Off is selected. Saving or rotating a key does not activate email. Activation requires changing the provider choice and publishing the installation configuration.

### Turn Mailgun on

Choose **Your email provider**, then **Mailgun**, and enter the verified sending domain, region, sender address and domain-scoped sending key. Enter the separate HTTP webhook signing key to receive Mailgun forwards; incoming Mailgun mail refuses without it. The Routes administration key is not a sending or signing key.

For a native deployment, set `MAIL_MODE=own`, `EMAIL_PROVIDER=mailgun`, `EMAIL_FROM`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAILGUN_SENDING_KEY` and, for receiving, `MAILGUN_WEBHOOK_SIGNING_KEY` in your private `--env-file`. Run a full deployment from its checkout:

```sh
rer deploy --environment production --env-file <file>
```

For a platform installation, save the choice and fields in **Settings → App settings**, then use the normal owner Publish flow. Stored values do not establish which bindings the currently published Worker holds. Platform adoption and installed proof remain separate from this seed's declarations.

Resend, SendGrid and Cloudflare Email Sending use the inputs in the table above and the same explicit choice and publication step. A secret-only `--set-secret` command cannot turn an Off installation on.

### Turn sending off again

Choose **Email off** and publish. For native deployment, put `MAIL_PROVIDER=none` in your private file and run the full deploy command above. It removes existing mail credential bindings, including `MAILGUN_WEBHOOK_SIGNING_KEY`; keeping their values saved does not bind them. Repoint a live Mailgun route before switching off: refused forwards are retried for 8 hours and then dropped.

### Stop Mailgun receiving

Use this to retire the signing key, for example when you leave Mailgun. First point the Mailgun route somewhere else, then run:

```sh
rer deploy --environment production --env-file <file> --unset-secret MAILGUN_WEBHOOK_SIGNING_KEY
```

Every forward is then refused. Mailgun retries a refused forward for 8 hours and then drops it, so move the route first. To rotate the key on an active installation, put the new value in the file and run `--set-secret MAILGUN_WEBHOOK_SIGNING_KEY`. This does not override an Off provider choice.

### Mail through a Mailgun route

With an active provider choice and `MAILGUN_WEBHOOK_SIGNING_KEY` bound, a Mailgun route can forward your support mail to `POST /api/integrations/email/mailgun/inbound`. Mailgun signs each forward, so the route URL carries no secret and none shows in the Mailgun dashboard or its logs. A forward is accepted when its signature verifies under the key, its timestamp is within five minutes ahead or nine hours behind, and its token has not been used before; anything else is refused without writing a record. Received, repeated and Suspended mail is answered 200, which is all Mailgun accepts; an address no workspace receives is not, so Mailgun retries it. Route setup is in [Email and integrations](../src/modules/integrations/README.md#option-3-mailgun-route).

## Receive mail that Amazon SES stores in S3

Use this when your support address receives mail through Amazon SES (the domain's MX is `inbound-smtp.<region>.amazonaws.com`) and you want that mail to reach a HappyToHelp workspace, including replies to per-conversation addresses of the form `help+<conversation id>@mail.example.com`. An SES receipt rule stores each message in an S3 bucket; HappyToHelp lists the bucket on its own schedule, reads each new object and admits it as a conversation. There is no inbound URL to protect and no function to run in your AWS account, and a message waits in the bucket for as long as HappyToHelp is down. Nothing happens until the inputs below are all set.

### What to set up in AWS

- **A receipt rule** with one S3 action, for the address and its `+label` forms, that writes each message to your bucket under the **SES prefix**, for example `ses/<name>/`. SES stores the message exactly as it received it, with its own headers on top, in an object named by the SES message id. When the rule is created SES also writes one object named `AMAZON_SES_SETUP_NOTIFICATION`; HappyToHelp records it and never reads it as mail.
- **A bucket policy** so that everything under the SES prefix was written by SES: only SES may put there, and nobody may delete there. SES's own verdict headers in those objects are then trusted; nothing else in a message is.

```json
{"Version":"2012-10-17","Statement":[
 {"Sid":"SesMayWrite","Effect":"Allow","Principal":{"Service":"ses.amazonaws.com"},"Action":"s3:PutObject","Resource":"arn:aws:s3:::<bucket>/ses/<name>/*","Condition":{"StringEquals":{"AWS:SourceAccount":"<account id>"}}},
 {"Sid":"OnlySesWrites","Effect":"Deny","Principal":"*","Action":"s3:PutObject","Resource":"arn:aws:s3:::<bucket>/ses/<name>/*","Condition":{"StringNotEquals":{"aws:PrincipalServiceName":"ses.amazonaws.com"}}},
 {"Sid":"NobodyDeletes","Effect":"Deny","Principal":"*","Action":["s3:DeleteObject","s3:DeleteObjectVersion"],"Resource":"arn:aws:s3:::<bucket>/ses/<name>/*"}]}
```

- **A replay prefix** (optional), for example `replay/<name>/`, in the same bucket. Operators write recovered copies of mail your old help desk failed to process there. It must not contain, and must not sit inside, the SES prefix. Nothing under it is ever trusted as authenticated, whatever its headers say.
- **A read-only key** for HappyToHelp. It needs to list and get under the two prefixes and nothing else; add `kms:Decrypt` for the specific key only if the bucket uses SSE-KMS.

```json
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::<bucket>","Condition":{"StringLike":{"s3:prefix":["ses/<name>/*","replay/<name>/*"]}}},
 {"Effect":"Allow","Action":"s3:GetObject","Resource":["arn:aws:s3:::<bucket>/ses/<name>/*","arn:aws:s3:::<bucket>/replay/<name>/*"]}]}
```

### The inputs

All seven are optional on a new deployment. The reader is **off** unless the bucket, the SES prefix, the mailbox, the region and both halves of the key are set; the replay prefix is optional. A partial set, or a value of the wrong shape, is refused when you deploy.

| Input | Meaning |
| --- | --- |
| `LEGACY_MAIL_S3_BUCKET` | The bucket. |
| `LEGACY_MAIL_S3_PREFIX` | The SES prefix, ending in `/`. SES's verdict headers under it count. |
| `LEGACY_MAIL_S3_REPLAY_PREFIX` | Optional. The operator-written prefix, ending in `/`. Never authenticated. |
| `LEGACY_MAIL_S3_MAILBOX` | The one address this reader admits mail for, and its `+label` forms. It must be the inbound address of a workspace (**Settings → Email**); mail waits until one is. |
| `LEGACY_AWS_REGION` | The bucket's region, which is also where SES receives. |
| `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY` | The read-only key. Runtime secrets; they appear in no response, row or export. |

How to turn the reader on and off is in [Operations](../OPERATIONS.md#receiving-mail-that-amazon-ses-stores-in-s3).

### What HappyToHelp does with each object

- **Lists both prefixes every minute**, through every page, and gives each new key one receipt. Each minute it gives up to 20 new keys per prefix a receipt, and reads and admits up to 10 messages, so a backlog of N messages takes about N/10 minutes. The replay prefix is listed only in a minute that took in the SES prefix to its end, so a message's SES copy is always recorded before its replay copy. Every request is a signed read-only `GET` to the bucket's own host under the two prefixes.
- **Binds the message to your mailbox by SES's own record.** The envelope recipient is read only from the first `Received` header, and only when it names SES receiving in your region and carries a `for` clause. The message is routed only when that address is the mailbox or one of its `+label` forms. It is never taken from `To:` or `Cc:`. Anything else is held in the workspace that receives on the mailbox as **Suspended** with the reason `envelope_recipient_unproven`, with its bytes kept.
- **Judges the sender by SES's verdict.** For the SES prefix only, the first `Authentication-Results` header counts, and only when its server is `amazonses.com`. A passing DMARC for the From domain, a passing DKIM or SPF aligned to it, verifies the sender and the mail is admitted. A failing check, or a header that cannot be read unambiguously, lands in Suspended as `authentication_failed`; no verdict at all lands as `sender_unproven`.
- **Threads replies.** `help+<conversation id>@…` joins that conversation when the sender is its contact, a participant or a member, as it does for every other way mail arrives. A reply address issued by HappyToHelp (`+r.<token>`) joins by possession. Everything else follows the usual rules for new mail.
- **Never trusts the replay prefix.** Mail there is routed to the plain mailbox with its label dropped, so even a live reply address cannot admit it. It lands in Suspended as `sender_unproven`; it creates no message, no AI work and no outgoing email. Review it in **Suspended**: because its sender is unproven, it can be kept as a private note, and Suspended keeps it for 14 days.
- **Admits once.** By object key, by SES message id (a copy of a message under the replay prefix holds nothing new once its SES copy is known), by Message-ID and by the private copy's key. Reruns change nothing. If the legacy desk also stored the message, a [legacy delta sweep](LEGACY-EXPORT.md#delta-sweeps) skips it: the receipts keep each SES message id for that.
- **Waits for its workspace.** While no workspace receives on the mailbox the receipts are `pending_mailbox`, neither admitted nor held; they are retried every minute.
- **Retries and shows failure.** An S3 or other error retries with a delay that starts at seconds and grows to an hour; after twelve attempts the receipt shows as `failed`. One failing object never delays the others.
- **Holds mail over 25 MB** whole in Suspended as `message_too_large`, and never admits it. An object larger than SES stores (40 MiB) is shown there too without being read, and stays in the bucket.
- **Keeps the message private.** Before admitting it, HappyToHelp writes an encrypted copy of the raw message (it can carry a live reply address) to private storage, deletes it once the receipt is final, and sweeps a final receipt's copy left behind after a minute and any copy after seven days. The sweep runs every scheduled tick whether or not the reader is configured, so turning the reader off keeps no copy longer. Each receipt records the workspace it is read for with its private copy, and contact erasure in that workspace clears the receipt's sender and copy, reader on or off; an erasure in any other workspace leaves the reader's receipts as they are. A receipt read before the workspace was recorded is the workspace's that receives on the mailbox, and the reader records it on its next run. Review copies in Suspended have reply addresses redacted.

### What you see

The email settings read (`GET /api/management/projects/:projectId/email-settings`, owners and admins) gains `legacyMailS3` for the workspace that receives on the mailbox, and `null` for every other workspace and whenever the reader is off:

```json
"legacyMailS3": {
 "mailbox": "help@mail.example.com",
 "lastListedAt": "2026-11-08T10:00:00.000Z",
 "lastListError": null,
 "counts": {"pending":0,"pendingMailbox":0,"complete":12,"held":{"envelope_recipient_unproven":1},"failed":0,"setupNotice":1,"duplicate":0,"replay":0}
}
```

`lastListedAt` is the last list that succeeded and is `null` before the first. `pending` counts receipts listed but not finished, including those in flight or waiting to retry; `held` counts by Suspended reason; `replay` counts every receipt from the replay prefix in any state.

## Managed email

A compatible installation that selects Run Edit Run managed email receives an address from Run Edit Run before its first workspace is created. Setup shows it under **What we’ve set**. There is no customer mail key, provider account or DNS task. Your own provider choice uses Resend, SendGrid, Cloudflare or Mailgun; Off keeps provider sending and Mailgun receiving credentials unbound.

**Settings → Email** shows configuration, receiving-route activity and actual inbound observations separately. An active route is not proof that mail arrived. The last outbound timestamp means **provider acceptance**, not inbox delivery. Password recovery and sign-in links use this same sending service. A failed binding stays visible; **Retry connection** repeats the original allocation rather than inventing another address.

Customer replies use a private recipient-specific Reply-To address and retain the relay’s RFC Message-ID for threading. CC, BCC, inline images and attachments use the same native permissions and frozen recipient snapshot as other transports. Files over the included-file limit are linked through the existing authorized file route. A timeout or lost response stays uncertain and is never sent again automatically. A conversation reply, a scheduled reply or a problem’s reply to its incidents that is refused because the sending key was just rotated has not reached the relay: it shows as in progress (a scheduled reply as sending) and the same command is submitted once more, under the same identity, after the rebuilt release holds the new key; about an hour after the first refusal it fails instead, and a scheduled reply then shows as failed. Other mail, such as sign-in, invitation, report and trigger mail and the Settings test email, is not held and fails at once. **Check retained send receipt** reads the relay’s existing result without sending.

Additional workspaces receive distinct allocations. Renaming a workspace or rotating relay/ingress credentials keeps its address and history. Deletion stops local intake immediately and durably queues retirement of the platform mapping. Custom mailboxes remain an optional later connection; checking a website’s DNS never replaces the managed sender.

Signed MIME enters through `/api/integrations/email/rer/v1/inbound`. The edge’s verified, failed or unproven authentication verdict is passed to native admission; message-supplied authentication headers do not establish sender authority. Failed and unproven senders follow the existing Suspended policy, unless an existing recipient grant independently proves possession. Duplicate delivery identities cannot create another ticket; changed bytes are held for review.

Original managed MIME is encrypted with the installation’s stable integration data key before acknowledgment. Acknowledged transport buffers expire after one minute; failed intake is retained for at most seven days of scheduled cleanup, while digest tombstones remain. Conversation history and attachments have their existing retention. Relay and ingress keys are separate from that data key. Preserve the data key privately when rotating transport keys; never include it in an archive. Exports retain conversations, attachments, RFC thread identities, routing history and redacted receipts. Restored routes are revoked, reply-grant metadata is unusable, and mailbox-control effects are excluded. This does not qualify the complete hosted export or live mail path: those gates remain pending with their owners.

The Managed journeys replace only the external relay/edge network boundary. They establish application engineering behavior, not delivery through a real mail domain, provider account or deployed platform.

## Hosted installation

A local trial cannot receive or send email. Use the website chat to try conversations locally; do not configure DNS or mail routing for `localhost.test`, which is reserved for the trial.

To use email, the installation owner needs a hosted HappyToHelp installation and a real mailbox or a receiving address on a domain they control. Choose one path:

- **A mailbox at Google or Microsoft:** register an OAuth app and install its credentials using the steps below, then authorize the mailbox in **Settings → Email → Add mailbox**.
- **An IMAP and SMTP mailbox:** allow its exact hosts and TLS ports using [IMAP and SMTP setup](#connect-imap-and-smtp), then enter the mailbox credentials in **Add mailbox**.
- **Forwarding to HappyToHelp:** configure a hosted sending provider as described above, an inbound credential and a route to the hosted Worker. Follow [Receive email](../src/modules/integrations/README.md#receive-email) for Cloudflare Email Routing, SendGrid Inbound Parse or your own gateway. Use a dedicated subdomain to preserve your existing mail routing.

Connecting a mailbox does not configure installation sign-in and invitation mail. Keep the installation's sending provider configured as described at the start of this guide. A provider account, permission to use the mailbox and a deployed configuration are prerequisites, not supplied by a local trial.

## Connect Gmail or Microsoft 365

The installation owner registers an OAuth application for this installation. Use your own application credentials and HappyToHelp origin; a connection on another installation does not authorize this one.

### Installation settings

The runtime reads `APP_ORIGIN` for its callback origin. On a native deployment, follow [Custom application origin](INSTALLER.md#custom-application-origin): attach your hostname and retain `H2H_PUBLIC_ORIGIN` in the private deployment env file. The deploy command writes `APP_ORIGIN` from it. If you use the default hosted workers.dev origin, register that actual HTTPS origin instead. Register the exact callback below, replacing `support.example.com` with your HappyToHelp host, without adding a trailing slash:

| Provider | Installation inputs | Registered redirect URI |
| --- | --- | --- |
| Gmail / Google Workspace | `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` | `https://support.example.com/api/management/mailboxes/oauth/gmail/callback` |
| Microsoft 365 / Outlook | `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` | `https://support.example.com/api/management/mailboxes/oauth/microsoft/callback` |

Both use `INTEGRATION_ENCRYPTION_KEY`, the installation's base64-encoded 32-byte encryption key. Retain the existing key; replacing it without migrating credentials makes existing connections unreadable. Native setup generates this key for a new installation. Back it up privately with your installation secrets.

Keep input values in an owner-only, mode 0600 private env file outside the repository. Preserve your existing owner, origin and sending-provider settings in that file. For your own provider, email must be explicitly enabled with `MAIL_MODE=own` and `EMAIL_PROVIDER` set to your configured sending provider, with its required inputs; an Off installation refuses mailbox input updates. Managed installations retain their existing managed configuration. Do not paste keys in ticket notes, shell arguments or source files.

For an already deployed installation, install each provider input from the private file, substituting the input name only for `SETTING_NAME`:

```sh
pnpm exec rer deploy --environment production --env-file /path/to/private-mail.env --set-secret SETTING_NAME
```

Repeat for both client inputs and, only if not already installed, `INTEGRATION_ENCRYPTION_KEY`. The same command installs the IMAP settings below. A changed hostname or sending-provider choice requires a full deployment with the same private file, without `--set-secret`. Saving a secret alone does not enable an Off installation or change its origin.

### Google Gmail setup

1. Sign in to the [Google Cloud console](https://console.cloud.google.com/) with the account that will own the OAuth app. Create or select a project, then enable the **Gmail API** under **APIs & Services → Library**.
2. Open **Google Auth Platform** (the OAuth consent screen under **APIs & Services** in some consoles). Set the app name, support email and developer contact. Choose **Internal** only for mailboxes in your Google Workspace organization; otherwise choose **External**. For External testing, add the intended mailbox account under **Audience → Test users**.
3. Under **Data Access**, add these scopes that HappyToHelp requests:
   - `https://www.googleapis.com/auth/gmail.readonly` to read mail and attachments.
   - `https://www.googleapis.com/auth/gmail.send` to send replies.
   - `https://www.googleapis.com/auth/gmail.settings.basic` to discover accepted send-as aliases.
4. Under **Clients**, create an OAuth client with application type **Web application**. Add the Gmail callback from the table as an **Authorized redirect URI**. This is a server callback, not the website widget origin.
5. Save the client ID as `GOOGLE_MAIL_CLIENT_ID` and its client secret as `GOOGLE_MAIL_CLIENT_SECRET` in your private env file. Install those inputs using the command above. Keep the secret private.
6. As a workspace owner or admin, open **Settings → Email → Add mailbox → Google Gmail**, enter the sender/brand name and select **Authorize mailbox**. Complete any HappyToHelp security verification, sign in as the intended mailbox and approve the requested access. HappyToHelp requests offline access so sync can continue after the browser closes.

Google Workspace administrators may need to trust the app before consent works. External apps using Gmail scopes can require Google verification before production use; testing grants can expire after seven days. Complete Google's applicable verification and publishing requirements before relying on unattended mail. A redirect mismatch means the registered URI must match this installation's actual callback exactly. If offline access was not granted or a grant expires, resolve it in Google and use **Reconnect** with the same mailbox account.

### Microsoft 365 setup

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/), then open **Identity → Applications → App registrations → New registration**. Name the app for this installation. To support Microsoft 365 and Outlook.com with this connector's `/common` authorization endpoint, choose **Accounts in any organizational directory and personal Microsoft accounts**.
2. Under **Authentication**, add a **Web** platform with the Microsoft callback from the table as its redirect URI. Use the hosted HTTPS origin, not your widget website. This connector uses a confidential server app; leave public-client and implicit-grant flows disabled.
3. Under **API permissions**, add **Microsoft Graph → Delegated permissions**: `User.Read`, `Mail.Read` and `Mail.Send`, plus `offline_access` for refresh tokens. The connector acts as the signed-in mailbox user; application permissions and client-credentials mail access are not used.
4. Under **Certificates & secrets**, create a client secret. Copy its **Value**, not its Secret ID, into `MICROSOFT_MAIL_CLIENT_SECRET` in the private env file. Copy **Application (client) ID** from Overview into `MICROSOFT_MAIL_CLIENT_ID`. Record the secret's expiry privately and rotate it before it expires. Install both inputs using the command above.
5. If the tenant blocks user consent, have its administrator review and grant the delegated permissions under **API permissions**. The account needs an accessible Exchange Online or Outlook mailbox; app registration alone does not create one.
6. As a workspace owner or admin, open **Settings → Email → Add mailbox → Microsoft 365 / Graph**, enter the sender/brand name and select **Authorize mailbox**. Complete any HappyToHelp security verification and consent as the mailbox account you intend to connect.

Resolve redirect mismatches, expired secrets and tenant consent restrictions in Entra before reconnecting. HappyToHelp requests `offline_access User.Read Mail.Read Mail.Send` and retains an encrypted refresh credential; it does not ask for a tenant ID input or provide an app-only/shared-mailbox grant. Use **Reconnect** with the original mailbox account after restoring access.

Authorization expires after ten minutes, works once and is tied to the signed-in administrator and workspace. If configuration is missing, the connection remains unavailable; no simulated connection substitutes for provider consent.

## Connect IMAP and SMTP

The installation owner first allows the mailbox servers; a workspace user cannot add arbitrary network hosts from the connection form.

1. Ask your mail provider for its **IMAP over TLS** and **SMTP over TLS** hostnames and ports, and whether an app password is required. The Worker must be able to open outbound TLS sockets to both hosts. IMAP defaults to **993** and SMTP to **465**. Plaintext and STARTTLS, including servers that offer only STARTTLS on port 587, are not supported by this connector.
2. In the installation's private mode 0600 env file, set `MAILBOX_SOCKET_HOSTS` to both exact hostnames, separated by commas, for example `imap.example.com,smtp.example.com`. Use hostnames only, without URL schemes or ports. Wildcards and numeric IP addresses are refused. Retain any hosts needed by other connected mailboxes when editing this installation-wide list.
3. Set `MAILBOX_SOCKET_PORTS` to the allowed numeric TLS ports if different from the default `993,465`. The connection form accepts only ports in this installation-wide list. Ask the provider for its trusted IMAP authentication-service identity and set `MAILBOX_IMAP_AUTHSERV` to that exact identity. Without it, IMAP senders remain unverified and their messages require Suspended review; do not copy an identity from an untrusted message header.
4. Install `MAILBOX_SOCKET_HOSTS`, and any configured `MAILBOX_SOCKET_PORTS` and `MAILBOX_IMAP_AUTHSERV`, using the `--set-secret SETTING_NAME` command in [Installation settings](#installation-settings). Retain the installation's `INTEGRATION_ENCRYPTION_KEY` and enabled email configuration. Reload **Settings → Email** after the deployment finishes; an empty host list keeps the connector unavailable.
5. Choose **Add mailbox → IMAP and SMTP**. Enter the mailbox address, allowed IMAP/SMTP hosts and TLS ports, and the IMAP username and password. Use an app password if required. Supply separate SMTP credentials only if they differ; otherwise the IMAP credentials are used for SMTP too. Select **Save mailbox**.

Saving verifies access to both servers before the connection is usable. Resolve host/port refusals in the installation allowlists, and authentication or socket failures with your provider. Credentials are encrypted and never shown again. Then use **Sync now** and check connection errors before relying on mail intake. The first sync can read existing Inbox mail, so review that mailbox before starting.

## Forwarding, aliases and signatures

For forwarding, configure **Receive Email** and point your existing provider or relay at the installation's inbound route. The [integration setup guide](../src/modules/integrations/README.md#receive-email) describes the forwarding transports and installation sender. Registering a forwarding mailbox does not configure your external mail server's forwarding rule.

Expand a mailbox to manage **Sender and aliases**. Add an alias to receive messages addressed to that alias. Receiving at an alias does not grant permission to send from it. Gmail send-as aliases must be accepted by Google; Microsoft proxy aliases are receive-only in this connector. IMAP aliases use the configured SMTP server, which must permit the selected sender. A forwarding sender also depends on the installation email provider's verified-sender policy.

Under **Email signature**, save a mailbox default or an agent-specific signature. An agent signature takes precedence over that mailbox's default when that agent sends. Choose **Default sender address** and **Save sender identity** to set the mailbox's sender. Sender names, aliases and signatures remain scoped to the selected mailbox and workspace.

## Sync, backfill and reconnect

Expand a mailbox to see its connection status, saved cursor, last successful sync and error. **Sync now** fetches the next bounded batch. The first sync starts with existing Inbox mail, so review the mailbox contents before starting it. **Backfill history** resets the scan to the beginning of the Inbox; use subsequent **Sync now** requests to continue its saved cursor rather than repeatedly restarting backfill. The saved provider cursor records progress, and incoming messages retain stable identities to detect repeated delivery. Gmail stores history/page progress, Microsoft stores a delta link, and IMAP stores UID validity and the last scanned UID.

A rejected or revoked credential shows **Reconnect required**. Use **Reconnect** and authorize the original mailbox account. A mailbox whose saved provider history has expired or whose IMAP UID state changed needs an explicit backfill decision. Do not treat a cursor error as proof that all mail was received.

One message delivered to several connected mailboxes in the same workspace creates one customer message. Each mailbox records its own progress. A permanently refused message is recorded in the audit and skipped so later mail can arrive; temporary failures retain the cursor and back off while healthy mailboxes sync first.

Disconnecting removes local provider credentials and routing aliases, stops new intake and sending through the connection, and retains ticket history and delivery receipts. It does not revoke the application grant in your Google or Microsoft account; remove that grant at the provider if needed. An outgoing delivery with an unknown outcome needs reconciliation: do not create another send merely because no success response was received. For inbound mail stuck during admission, see [Inbound email recovery](INBOUND-EMAIL-RECOVERY.md).

## Review Suspended mail

Open **Suspended mail** to inspect held messages. The view shows the reason, sender, authentication information, headers and plain text. Its count and oldest-message age help operators review mail before retention expires. Suspended mail creates no ticket, automatic reply, AI work or customer notification while held.

Treat the message's claimed sender and header text as evidence to review. Preview is plain text; HTML, remote images and other active content are not executed. Attachment inspection returns filename, type and size. Small plain-text and JSON attachments can be inspected as text; other files remain metadata-only, so do not assume their contents have been inspected.

Operators with permission to manage conversations can review, recover and delete held mail. Select an existing target conversation or recover into a new ticket. Public recovery requires proven sender authority; an authenticated false-positive spam message returns as a normal customer message without retrospective AI work or acknowledgement. A failed or unproven sender can be retained only with **Recover as a private operator note**, which records it as unverified evidence rather than speaking as the customer. Private-note recovery into a new ticket keeps its requester explicitly unproven. Recovery does not grant the sender authority for future mail; operators may reply normally after review.

Use **Delete email** for unwanted messages. Owners and admins use **Allow sender**, **Block sender** and **Remove sender rule** for a full address or an `@domain` in this workspace. Block rules take precedence. An allow rule does not establish identity or override failed authentication. Recovery, deletion and sender-rule changes are audited.

Messages above the 25 MB receiving limit, or with more than 20 attachments or an attachment above 20 MB, stay in Suspended rather than creating a partial ticket. An oversized raw message is retained as metadata-only `original.eml`; its sender remains unproven. Attachment-limit recovery cannot discard files to bypass the limit; retain the message as a private operator note or request a smaller replacement.

Held messages expire after **14 days**. Expiry explicitly deletes held content and records an audit event; reads and the scheduled cleanup process remove expired entries. Deleting or expiring held mail does not send a reply.

## Create an email ticket or log a call

From the inbox, open **New ticket**. Choose **Email requester**, enter the requester's email and optional name, select a mailbox and authorized sender address, and add the subject, message and any CC/BCC recipients. Leave **First comment** set to **Public reply — email requester**, review recipients and select **Create and email**. To start privately, choose **Internal note — no email**, enter your note and select **Create ticket**. This keeps the email mailbox and channel but saves only a team-visible note, without sending or queuing customer email. Open the ticket later and use **Send** for an explicit public reply; the private note is excluded from customer mail and transcripts. The customer is the requester; the operator is the submitter. CC recipients receive visible copies; BCC recipients receive hidden copies and are not automatically authorized to participate in the ticket.

Choose **Log a call** to record a subject and private call notes for a requester without emailing the customer. Call logs cannot send CC or BCC copies. These flows cover an individual email or call; bulk proactive notices and SMS/WhatsApp template creation are separate unfinished capabilities.

A send failure or unknown delivery result is visible. Retrying the same creation identity must not produce a second ticket or replay a possibly completed send. Investigate an unknown provider outcome before starting another creation.

## Replies after moving from another help desk

Move in preserves supported email threading keys from explicit export fields for Zendesk, Help Scout, Freshdesk and Intercom. These include message reference headers and supported vendor ticket tokens or reply addresses. Export the actual notification headers/reply metadata where possible; a source ticket ID alone cannot reconstruct every notification ever sent.

After you repoint the live email channel, a matching reply can find the imported conversation. Supported subject tokens include native `[H2H:id]`, Zendesk `[XXXX-XXXX]` and `[Ticket #number]` (also `[Request #number]`), Help Scout conversation `[#number]`, and Freshdesk `[#number]`. Help Scout, Freshdesk and Intercom also retain explicit reply addresses. Intercom has no subject-token scheme. Imported source Message-ID chains take priority over subject numbers/tokens, then reply addresses; vendor-header metadata is a final fallback. A key shared by multiple records still requires review, and native-thread conflicts retain their ordinary review rule. A token or reply address identifies a candidate ticket, not the sender's identity. Ambiguous matches and replies from a different or unproven customer go to review instead of being attached to another customer's history. Review the authentication evidence and requester before recovering them. Vendor tokens match only imported keys in this workspace. An authenticated reply with an unmatched token from a vendor whose keys were imported creates a new ticket tagged **Possible pre-migration reply**. Without imported keys from that vendor, bracketed order numbers and references follow ordinary new-ticket routing. Unproven or failing sender authentication still requires review.

An unmatched RFC reply chain or forwarded reply recipient can also receive the migration hint when the workspace retains a completed or undone import. Undo removes the imported keys and their authority to route to a ticket; the retained import journal only supplies context for the hint. A reviewed reimport restores the keys, and repeating a completed import creates no duplicates.

A reply to a Closed ticket creates a linked follow-up; the original ticket stays Closed.

Imports do not activate the old vendor's reply addresses or send notifications. Test replies to real pre-cutover notifications from each vendor before relying on the cutover. See [Move in your history](moving-in.md) for the broader migration boundary.

Imported Zendesk tickets also retain their source ticket number. Explicit
`[Ticket #123]` and `[Request #123]` subject tags propose that imported ticket;
ordinary order numbers do not grant sender authority. Conflicting keys or a
different customer still go to Suspended for review.

Imported Help Scout conversation-number tags such as `[#1901]` use the export’s explicit `number`, independently of its API `id`. The same bracket form can also name a Freshdesk ticket; if imported keys identify multiple tickets, the message is held for review. Neither form grants sender authority, and an API ID is never guessed to be a Help Scout notification number.
