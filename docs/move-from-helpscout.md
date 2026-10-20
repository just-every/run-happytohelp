# Move from Help Scout

Open **Settings → Move in existing support history** as a workspace owner or admin. **Connect your help desk** fetches from your own Help Scout account into this HappyToHelp installation. The existing **Choose an export** route remains available for files; its limits and supported record shapes are described in [Move in your history](moving-in.md).

## Credentials and permissions

Help Scout has two separate APIs. **Both credentials are required by this connection**: an Inbox OAuth access token and a Docs API key. The Inbox token cannot authenticate to Docs; omitting Docs is not treated as a successful article migration.

1. In Help Scout, open **Your Profile → My apps → Create My App**. Create a private application for the account you are moving.
2. Use Help Scout’s documented OAuth flow to obtain an **access token**. For an internal integration, the client credentials flow exchanges the application ID and application secret at `https://api.helpscout.net/v2/oauth2/token` using `grant_type=client_credentials`. Do this in your private tooling; do not paste the app secret into HappyToHelp’s access-token field. Tokens expire, so obtain a current token for the migration.
3. Separately open **Your Profile → Security and Access → Docs API** and copy the **Docs API key**. If it is absent, ask the account owner/admin for the **Docs: Create new, edit settings & Collections** permission. The key’s user must be able to access the intended Docs content.
4. Choose **Help Scout**, supply the **Inbox OAuth access token** and the separate **Docs API key**, then select **Connect and fetch history**.

Inbox credentials must belong to an active user with access to the intended inboxes. There is no read-only scope selector in this form; source visibility is governed by the Help Scout user and API permissions. See [Inbox OAuth authentication](https://developer.helpscout.com/mailbox-api/overview/authentication/) and [Docs API keys and authentication](https://developer.helpscout.com/docs-api/).

Keep credentials private. The form clears all credential fields after a successful connection and never displays the stored token or key. Connection credentials are excluded from exports; after an installation restore, configure credentials again before fetching further changes. Do not put tokens in URLs, screenshots, tickets or source files.

## Fetch, preview and import

1. Wait while **Fetching history** updates the counts for tickets, contacts, companies, articles, agents, replies and attachments. Fetching does not approve or import the records.
2. At **Ready for review**, compare the fetched counts with the source inventory. Review what will be imported, records needing fixes, omissions and article publication changes. Fetched counts and imported counts have different meanings; inspect the plan rather than treating a matching total as complete fidelity.
3. Check **Match source agents to your team**. Matches by email are suggested; choose an existing workspace member or **Keep as source author** for each agent. Save changed mappings before approval. Deleted agents remain historical authors. No staff account is created or invited, no access is granted, and assignment mappings stay inactive until cutover.
4. Inspect **Attachments needing attention**. Each failure identifies the source ticket, filename and error. Successfully downloaded bytes are copied into this installation’s private object storage, rather than relying on a vendor download URL. Missing files remain visible as failures; they are not silently reported as copied.
5. Select **Approve and import**. Progress is saved in bounded batches. Open the report links and check representative messages, private notes, timestamps, contacts, companies, articles and attachment downloads.

Fetching, importing, saving mappings and running a final sync do not send mail, widget messages, notifications or staff invitations. Imported history stays out of Reports. Unsupported source records and fields are reported for review rather than guessed. Existing export-upload behavior remains distinct: an uploaded file may retain attachment metadata without downloading the bytes.

## Resume, conflicts and undo

If the run stops, inspect its error, correct the source access or installation problem and choose **Resume import** on that run. Progress already committed is retained. A current workspace owner/admin must still be authorized when work continues. Do not start a second connection merely because a request timed out: reopen **Your imports** and inspect the saved run first.

A reviewed plan binds the source and destination state. Native edits can create conflicts; resolve the reported conflict rather than overwriting newer work. **Undo whole import** removes unchanged imported records and stops on later edits or references that must be preserved. Erased source custody cannot be resumed or replayed. See the [history import guide](moving-in.md) for review and undo boundaries.

## Final sync and cutover

After the initial import is complete, pause work in Help Scout and choose **Final sync**. This fetches changes since the connection’s saved progress into a new delta run. Review it, check the mappings and attachment failures, then choose **Approve and import** again. A final sync is an explicit operation, not ongoing live synchronization.

Once the delta is complete, use its channel checklist. Follow the exact addresses and targets shown for this installation:

1. At your email provider, replace the forwarding or redirection destination ending in `helpscoutapp.com` with the HappyToHelp destination from the checklist. Preserve sender information. Configure the sender in **Settings → Email**.
2. Remove the Help Scout Beacon script from your site or tag manager and install the HappyToHelp widget snippet from **Setup**. Publish and verify the channels your customers use.
3. For a custom Docs hostname, prepare the new destination and certificate, then change its DNS record from the Help Scout Docs target to the exact target supplied for this installation. Verify article visibility, categories and links. A `helpscoutdocs.com` hostname remains owned by Help Scout.

Check each step only after verifying it. Receive a new message through each channel, then reply to a notification sent before the move and confirm it reaches the intended imported conversation. Supported historical threading keys help match replies but do not establish sender identity; see [Replies after moving from another help desk](email.md#replies-after-moving-from-another-help-desk). A reply to a Closed ticket creates a linked follow-up.

Choose **Complete cutover** after all steps pass. This activates saved agent mappings. The action records your confirmation; it does not edit external forwarding, install a widget, change DNS, send messages or notifications, or invite staff. Your deliberate test message is separate from the inert migration actions. Keep access to the source until counts, files, links and reply routing are checked.

## Errors to resolve

- **401 / credentials refused:** the Inbox access token may have expired or its associated user may be inactive. Obtain a current access token. An app ID or app secret is not an access token.
- **Docs authorization failure:** check the separate Docs key and its user’s Docs permission. Replacing the Inbox token does not repair a Docs key. Do not assume an Inbox-only fetch includes your help articles.
- **403 / missing data:** check the source user’s inbox visibility and Docs access. Review fetched counts against each intended inbox and Docs collection.
- **429 / rate limit:** wait for the provider’s limit to clear, then resume the same run.
- **Incomplete threads:** follow the review’s record-specific reason. A conversation preview or incomplete thread page is not complete message history.

Connection and source-fetch errors must be resolved explicitly. The connector does not substitute sample data or claim that inaccessible history was imported.
