# Move from Zendesk

Open **Settings → Move in existing support history** as a workspace owner or admin. **Connect your help desk** fetches from your own Zendesk account into this HappyToHelp installation. The existing **Choose an export** route remains available for files; its limits and supported record shapes are described in [Move in your history](moving-in.md).

## Credentials and permissions

1. Sign in to your Zendesk account as an administrator with access to the tickets, users, organizations and Help Center content you intend to move.
2. In **Admin Center → Apps and integrations → APIs → API tokens**, enable token access if your account permits it and create a token for this move. Copy it privately.
3. In HappyToHelp, choose **Zendesk**, enter your account domain, such as `yourcompany.zendesk.com`, the administrator’s email and the **API token**. Enter the email without `/token`; the connector supplies the authentication syntax.
4. Select **Connect and fetch history**. Use your Zendesk account domain rather than a custom Help Center domain.

API tokens inherit the permissions of the user whose email is supplied; they are not a separate read-only OAuth scope. Use a source administrator who can read the full intended history. If your account no longer allows API tokens, do not paste an OAuth token into this field: this connection requires the email/API-token method. Use the existing export upload route or resolve authentication with the installation operator.

See Zendesk’s [API token guidance](https://support.zendesk.com/hc/en-us/articles/4408889192858-Managing-API-token-access-to-the-Zendesk-API) and [authentication differences](https://developer.zendesk.com/documentation/authentication/oauth-vs-api-tokens/).

Keep credentials private. The form clears all credential fields after a successful connection and never displays the stored token or key. Connection credentials are excluded from exports; after an installation restore, configure credentials again before fetching further changes. Do not put tokens in URLs, screenshots, tickets or source files.

## Fetch, preview and import

1. Wait while **Fetching history** updates the counts for tickets, contacts, companies, articles, agents, replies and attachments. Fetching does not approve or import the records.
2. At **Ready for review**, compare the fetched counts with the source inventory. Review what will be imported, records needing fixes, omissions and article publication changes. Fetched counts and imported counts have different meanings; inspect the plan rather than treating a matching total as complete fidelity.
3. Check **Match source agents to your team**. Matches by email are suggested; choose an existing workspace member or **Keep as source author** for each agent. Save changed mappings before approval. Deleted source agents keep their historical identity and may be explicitly matched to an existing member. No staff account is created or invited, no access is granted, and assignment mappings stay inactive until cutover.
4. Inspect **Attachments needing attention**. Each failure identifies the source ticket, filename and error. Successfully downloaded bytes are copied into this installation’s private object storage, rather than relying on a vendor download URL. Missing files remain visible as failures; they are not silently reported as copied.
5. Select **Approve and import**. Progress is saved in bounded batches. Open the report links and check representative messages, private notes, timestamps, contacts, companies, articles and attachment downloads.

Fetching, importing, saving mappings and running a final sync do not send mail, widget messages, notifications or staff invitations. Imported history stays out of Reports. Unsupported source records and fields are reported for review rather than guessed. Existing export-upload behavior remains distinct: an uploaded file may retain attachment metadata without downloading the bytes.

## Resume, conflicts and undo

If the run stops, inspect its error, correct the source access or installation problem and choose **Resume import** on that run. Progress already committed is retained. A current workspace owner/admin must still be authorized when work continues. Do not start a second connection merely because a request timed out: reopen **Your imports** and inspect the saved run first.

If **Reconnect** appears, enter current credentials for the same source account in that run’s reconnect form, then choose **Resume import**. This replaces the stored credentials without creating another run or resetting its saved progress. Credentials clear after successful reconnect and are never returned or displayed. The fetched source-page count is separate from the records processed during import.

A reviewed plan binds the source and destination state. Native edits can create conflicts; resolve the reported conflict rather than overwriting newer work. **Undo whole import** removes unchanged imported records and stops on later edits or references that must be preserved. Erased source custody cannot be resumed or replayed. See the [history import guide](moving-in.md) for review and undo boundaries.

## Final sync and cutover

After the initial import is complete, pause work in Zendesk and choose **Final sync**. This fetches changes since the connection’s saved progress into a new delta run. Review it, check the mappings and attachment failures, then choose **Approve and import** again. A final sync is an explicit operation, not ongoing live synchronization. If the delta contains no new importable records, review any reported issues and use **Approve and import** to complete that sync before continuing to cutover.

Once the delta is complete, use its channel checklist. Follow the exact addresses and targets shown for this installation:

1. In your email provider, replace the rule forwarding your support address to Zendesk with the HappyToHelp destination shown in the checklist. Preserve the customer’s original sender and headers. Configure the intended sender in **Settings → Email**.
2. Replace the Zendesk Web Widget or messaging snippet on every relevant site with the widget snippet from HappyToHelp **Setup**. Publish the site and verify a new conversation reaches this workspace.
3. For a custom Help Center hostname, ask the installation operator to add its exact lowercase hostname to the deployment’s `PUBLIC_HELP_HOSTS` JSON mapping, pointing to this workspace’s project ID or public alias. The operator must configure DNS, TLS and routing for this installation; there is no Help Center Domains settings form. After the destination and certificate are ready, replace the old vendor’s DNS target with the exact target supplied by the operator. Verify public articles, categories and existing links. A `zendesk.com` hostname is owned by Zendesk and cannot be moved through your DNS.

Use the receiving address shown in the cutover checklist and **Settings → Email** as the forwarding destination. This is the workspace’s configured inbound receiving address, not merely an outgoing sender or mailbox alias. Changing forwarding for your own support address does not transfer a vendor-owned reply alias: keep the old vendor receiving and relaying mail for those addresses while historical notifications remain in use. Do not disable that path until a reply to an actual pre-migration notification has reached the correct imported ticket.

Check each step only after verifying it. Receive a new message through each channel, then reply to a notification sent before the move and confirm it reaches the intended imported conversation. Historical headers and reply-address keys help match replies only when the source actually supplied them; complete header-only coverage is not guaranteed. Threading keys do not establish sender identity; see [Replies after moving from another help desk](email.md#replies-after-moving-from-another-help-desk). A reply to a Closed ticket creates a linked follow-up.

Choose **Complete cutover** after all steps pass. This activates saved agent mappings. The action records your confirmation; it does not edit external forwarding, install a widget, change DNS, send messages or notifications, or invite staff. Your deliberate test message is separate from the inert migration actions. Keep access to the source until counts, files, links and reply routing are checked.

## Errors to resolve

- **401 / credentials refused:** verify the account domain, administrator email and API token. A password is not an API token.
- **403 / permission refused:** check that the email belongs to an active user permitted to read the requested tickets, users, organizations and Help Center resources. A restricted agent cannot establish account-wide coverage.
- **429 / rate limit:** wait for the provider’s limit to clear, then resume the same run rather than starting another import.
- **Very recent tickets missing:** Zendesk’s incremental ticket exports exclude the most recent minute. Pause changes, allow that window to pass and run the final sync again before cutover. See [Incremental Exports](https://developer.zendesk.com/documentation/api-basics/working-with-data/using-the-incremental-export-api/).

Connection and source-fetch errors must be resolved explicitly. The connector does not substitute sample data or claim that inaccessible history was imported.
