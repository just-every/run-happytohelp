# Support email

Use **Settings → Email** to configure sending, forwarding and connected mailboxes. Mailbox connections, sender addresses and signatures belong to the current workspace. Owners and admins manage connections; ordinary ticket permissions still apply when an operator sends a reply or creates a ticket.

Forwarding uses the installation's email provider. Connected mailboxes receive and send through the account you authorize. Disconnecting stops intake and sending while keeping ticket history.

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

Keep the values in an owner-only private env file. The native deploy declaration accepts these names; install each with `rer deploy --environment YOUR-ENVIRONMENT --env-file private-mail.env --set-secret NAME`, replacing `NAME` with the setting to install. The same command accepts the IMAP settings below.

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

Held messages expire after **14 days**. Expiry explicitly deletes held content and records an audit event; reads and the scheduled cleanup process remove expired entries. Deleting or expiring held mail does not send a reply.

## Create an email ticket or log a call

From the inbox, open **New ticket**. Choose **Email requester**, enter the requester's email and optional name, select a mailbox and authorized sender address, and add the subject, message and any CC/BCC recipients. Review recipients before **Create and email**. The customer is the requester; the operator is the submitter. CC recipients receive visible copies; BCC recipients receive hidden copies and are not automatically authorized to participate in the ticket.

Choose **Log a call** to record a subject and private call notes for a requester without emailing the customer. Call logs cannot send CC or BCC copies. These flows cover an individual email or call; bulk proactive notices and SMS/WhatsApp template creation are separate unfinished capabilities.

A send failure or unknown delivery result is visible. Retrying the same creation identity must not produce a second ticket or replay a possibly completed send. Investigate an unknown provider outcome before starting another creation.

## Replies after moving from another help desk

Move in preserves supported email threading keys from explicit export fields for Zendesk, Help Scout, Freshdesk and Intercom. These include message reference headers and supported vendor ticket tokens or reply addresses. Export the actual notification headers/reply metadata where possible; a source ticket ID alone cannot reconstruct every notification ever sent.

After you repoint the live email channel, a matching reply can find the imported conversation. Supported subject tokens include native `[H2H:id]`, Zendesk `[XXXX-XXXX]` and Freshdesk `[#number]`; Help Scout and Intercom use explicit reply-address or vendor-header metadata. A token or reply address identifies a candidate ticket, not the sender's identity. Ambiguous matches and replies from a different or unproven customer go to review instead of being attached to another customer's history. Review the authentication evidence and requester before recovering them. Vendor tokens match only imported keys in this workspace. An authenticated reply with an unmatched token from a vendor whose keys were imported creates a new ticket tagged **Possible pre-migration reply**. Without imported keys from that vendor, bracketed order numbers and references follow ordinary new-ticket routing. Unproven or failing sender authentication still requires review.

A reply to a Closed ticket creates a linked follow-up; the original ticket stays Closed.

Imports do not activate the old vendor's reply addresses or send notifications. Test replies to real pre-cutover notifications from each vendor before relying on the cutover. See [Move in your history](moving-in.md) for the broader migration boundary.

Imported Zendesk tickets also retain their source ticket number. Explicit
`[Ticket #123]` and `[Request #123]` subject tags propose that imported ticket;
ordinary order numbers do not grant sender authority. Conflicting keys or a
different customer still go to Suspended for review.

Imported Help Scout conversation-number tags such as `[#1901]` use the export’s explicit `number`, independently of its API `id`. The same bracket form can also name a Freshdesk ticket; if imported keys identify multiple tickets, the message is held for review. Neither form grants sender authority, and an API ID is never guessed to be a Help Scout notification number.
