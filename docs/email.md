# Support email

Use **Settings → Email** to configure sending, forwarding and connected mailboxes. Mailbox connections, sender addresses and signatures belong to the current workspace. Owners and admins manage connections; ordinary ticket permissions still apply when an operator sends a reply or creates a ticket.

Forwarding uses the installation's email provider. Connected mailboxes receive and send through the account you authorize. Disconnecting stops intake and sending while keeping ticket history.

## Outbound email off

An installation deployed with `MAIL_PROVIDER=none` sends nothing. Sign-in links, password resets, invitations, notifications, replies by email, the test send and surveys each report that outbound email is off, and **Settings → Email** and **Setup** say so. Receiving mail, importing and everything that does not send keep working. Owners get in with a one-time link from `node scripts/hosted-signin.mjs`, or their password.

### Turn Mailgun on

Run this from the checkout that deployed the installation, with `EMAIL_PROVIDER=mailgun`, `EMAIL_FROM`, `EMAIL_API_KEY_NAME=MAILGUN_SENDING_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` (`us` or `eu`, written out), `MAILGUN_SENDING_KEY` (a domain-scoped sending key) and `MAILGUN_WEBHOOK_SIGNING_KEY` (Mailgun's HTTP webhook signing key, which verifies mail Mailgun forwards to you) in your private `--env-file` and `MAIL_PROVIDER=none` removed from it. Nothing else changes. A secret change makes one new Worker version from the live one without rebuilding, so the installation must already run this release first:

```sh
rer deploy --environment production --env-file <file> --set-secret EMAIL_PROVIDER,EMAIL_FROM,EMAIL_API_KEY_NAME,MAILGUN_DOMAIN,MAILGUN_REGION,MAILGUN_SENDING_KEY,MAILGUN_WEBHOOK_SIGNING_KEY
```

Resend, SendGrid and Cloudflare Email Sending take their own inputs, listed in the provider table of [Email and integrations](../src/modules/integrations/README.md#choose-a-provider); they are set the same way, one `--set-secret` run naming those inputs.

### Turn sending off again

Use this to stop all sending while keeping the installation. It removes the six sending inputs; Mailgun receiving continues. A plain redeploy keeps every secret the Worker holds, so redeploying with `MAIL_PROVIDER=none` alone does not stop sending. Run:

```sh
rer deploy --environment production --env-file <file> --unset-secret EMAIL_PROVIDER,EMAIL_FROM,EMAIL_API_KEY_NAME,MAILGUN_DOMAIN,MAILGUN_REGION,MAILGUN_SENDING_KEY
```

Then remove the six sending inputs from your `--env-file` and put `MAIL_PROVIDER=none` back in it for later deploys. `MAILGUN_WEBHOOK_SIGNING_KEY` may stay in the file, because it binds no way to send.

### Stop Mailgun receiving

Use this to retire the signing key, for example when you leave Mailgun. First point the Mailgun route somewhere else, then run:

```sh
rer deploy --environment production --env-file <file> --unset-secret MAILGUN_WEBHOOK_SIGNING_KEY
```

Every forward is then refused. Mailgun retries a refused forward for 8 hours and then drops it, so move the route first. To rotate the key instead, put the new value in the file and run `--set-secret MAILGUN_WEBHOOK_SIGNING_KEY` alone.

### Mail through a Mailgun route

With `MAILGUN_WEBHOOK_SIGNING_KEY` set, a Mailgun route can forward your support mail to `POST /api/integrations/email/mailgun/inbound`. Mailgun signs each forward, so the route URL carries no secret and none shows in the Mailgun dashboard or its logs. A forward is accepted when its signature verifies under the key, its timestamp is within five minutes ahead or nine hours behind, and its token has not been used before; anything else is refused without writing a record. Received, repeated and Suspended mail is answered 200, which is all Mailgun accepts; an address no workspace receives is not, so Mailgun retries it. Route setup is in [Email and integrations](../src/modules/integrations/README.md#option-3-mailgun-route).

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

A compatible Managed installation receives an address from Run Edit Run before its first workspace is created. Setup shows it under **What we’ve set**. There is no customer mail key, provider account or DNS task. Independent and Assisted installations keep their direct Resend, SendGrid or Cloudflare setup.

**Settings → Email** shows configuration, receiving-route activity and actual inbound observations separately. An active route is not proof that mail arrived. The last outbound timestamp means **provider acceptance**, not inbox delivery. Password recovery and sign-in links use this same sending service. A failed binding stays visible; **Retry connection** repeats the original allocation rather than inventing another address.

Customer replies use a private recipient-specific Reply-To address and retain the relay’s RFC Message-ID for threading. CC, BCC, inline images and attachments use the same native permissions and frozen recipient snapshot as other transports. Files over the included-file limit are linked through the existing authorized file route. A timeout or lost response stays uncertain and is never sent again automatically. A conversation reply, a scheduled reply or a problem’s reply to its incidents that is refused because the sending key was just rotated has not reached the relay: it shows as in progress (a scheduled reply as sending) and the same command is submitted once more, under the same identity, after the rebuilt release holds the new key; about an hour after the first refusal it fails instead, and a scheduled reply then shows as failed. Other mail, such as sign-in, invitation, report and trigger mail and the Settings test email, is not held and fails at once. **Check retained send receipt** reads the relay’s existing result without sending.

Additional workspaces receive distinct allocations. Renaming a workspace or rotating relay/ingress credentials keeps its address and history. Deletion stops local intake immediately and durably queues retirement of the platform mapping. Custom mailboxes remain an optional later connection; checking a website’s DNS never replaces the managed sender.

Signed MIME enters through `/api/integrations/email/rer/v1/inbound`. The edge’s verified, failed or unproven authentication verdict is passed to native admission; message-supplied authentication headers do not establish sender authority. Failed and unproven senders follow the existing Suspended policy, unless an existing recipient grant independently proves possession. Duplicate delivery identities cannot create another ticket; changed bytes are held for review.

Original managed MIME is encrypted with the installation’s stable integration data key before acknowledgment. Acknowledged transport buffers expire after one minute; failed intake is retained for at most seven days of scheduled cleanup, while digest tombstones remain. Conversation history and attachments have their existing retention. Relay and ingress keys are separate from that data key. Preserve the data key privately when rotating transport keys; never include it in an archive. Exports retain conversations, attachments, RFC thread identities, routing history and redacted receipts. Restored routes are revoked, reply-grant metadata is unusable, and mailbox-control effects are excluded. This does not qualify the complete hosted export or live mail path: those gates remain pending with their owners.

The Managed journeys replace only the external relay/edge network boundary. They establish application engineering behavior, not delivery through a real mail domain, provider account or deployed platform.

## Connect Gmail or Microsoft 365

The person running the installation first registers an OAuth application with Google or Microsoft for this installation. Use your own application credentials and your own HappyToHelp origin; a connection on another installation does not authorize this one.

Set `APP_ORIGIN` to your HTTPS HappyToHelp origin and configure these installation secrets through your private deployment configuration:

| Provider | Settings | Registered redirect URI |
| --- | --- | --- |
| Gmail / Google Workspace | `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` | `https://<your-origin>/api/management/mailboxes/oauth/gmail/callback` |
| Microsoft 365 / Outlook | `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` | `https://<your-origin>/api/management/mailboxes/oauth/microsoft/callback` |

Keep the values in an owner-only private env file. The native deploy declaration accepts these names; install each with `rer deploy --environment YOUR-ENVIRONMENT --env-file private-mail.env --set-secret <setting>`, replacing `<setting>` with the name of the setting to install. The same command accepts the IMAP settings below.

Both use `INTEGRATION_ENCRYPTION_KEY`, the installation's base64-encoded 32-byte encryption key. Keep that key available for existing connections; replacing it without migrating the encrypted credentials makes those credentials unreadable. Never paste secrets into ticket notes or commit them to the repository.

In **Mailboxes**, choose the connection type, enter a sender/brand name and select **Authorize mailbox**. Complete the provider's consent screen using the intended mailbox account. Authorization expires after ten minutes, works once and is tied to the signed-in administrator and workspace. Complete any requested security verification before continuing.

Gmail requests read-only mail access, permission to send mail and basic mailbox settings access to discover accepted send-as aliases. Microsoft requests offline access, user profile, mail read and mail send access. Your provider or organization may require administrator consent. If authorization fails, resolve the displayed provider/configuration error; the application does not substitute a simulated connection.

## Connect IMAP and SMTP

Choose **IMAP and SMTP** and supply the mailbox address, IMAP host, SMTP host and credentials. The installation operator must include both exact hostnames in `MAILBOX_SOCKET_HOSTS`, a comma-separated allowlist. Wildcards and numeric IP addresses are not accepted.

Connections use TLS from the start: IMAP defaults to port **993**, SMTP to **465**. Custom numeric `imapPort` and `smtpPort` values are supported when included in the installation's comma-separated `MAILBOX_SOCKET_PORTS` allowlist, whose default is `993,465`. Plaintext and STARTTLS configuration are not supported by this connector. The Worker needs socket access to both hosts. Saving verifies access to IMAP and SMTP; a failed check must be resolved before the connection is usable. Separate SMTP credentials may be supplied when the server requires them. Set `MAILBOX_IMAP_AUTHSERV` to the receiving server's trusted authentication-service identity, so the connector can evaluate its authentication results. If unset, IMAP senders remain unverified and their messages require Suspended review. This value is installation configuration, not a message-supplied header or mailbox credential.

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
