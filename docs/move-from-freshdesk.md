# Move from Freshdesk

Open **Settings → Move in existing support history** as a workspace owner or admin. **Connect your help desk** fetches from your own Freshdesk account into this HappyToHelp installation. The existing **Choose an export** route remains available for files; its limits and supported record shapes are described in [Move in your history](moving-in.md).

## Credentials and permissions

1. Sign in as a Freshdesk administrator or agent with access to the tickets, contacts, companies, agents and solution articles you intend to migrate.
2. Open your profile picture, choose **Profile settings** and copy **Your API Key**.
3. In HappyToHelp choose **Freshdesk**, enter your account domain, such as `yourcompany.freshdesk.com`, and paste the **API key**. Use the Freshdesk account domain rather than a custom support portal hostname.
4. Select **Connect and fetch history**.

A Freshdesk API key inherits the source user’s permissions; it does not provide a separate read-only scope setting. Restricted or group-scoped agents can see a narrower ticket set. Use an account that can read all intended history and check the source inventory against the preview. See [Freshdesk API authentication and permissions](https://developers.freshdesk.com/api/).

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

After the initial import is complete, pause work in Freshdesk and choose **Final sync**. This fetches changes since the connection’s saved progress into a new delta run. Review it, check the mappings and attachment failures, then choose **Approve and import** again. A final sync is an explicit operation, not ongoing live synchronization.

Once the delta is complete, use its channel checklist. Follow the exact addresses and targets shown for this installation:

1. Change the forwarding rule at your email provider from the Freshdesk support address to the HappyToHelp inbound destination in the checklist. Configure the receiving mailbox and sender in **Settings → Email**.
2. Replace the Freshdesk support widget snippet in your website or tag manager with the HappyToHelp widget from **Setup**. Publish and send a new test conversation.
3. For a custom support portal hostname, prepare the new Help Center destination and certificate, then change the DNS record from Freshdesk’s target to the installation’s exact target. Verify articles, categories and existing links. A `freshdesk.com` hostname cannot be transferred using your domain’s DNS.

Check each step only after verifying it. Receive a new message through each channel, then reply to a notification sent before the move and confirm it reaches the intended imported conversation. Supported historical threading keys help match replies but do not establish sender identity; see [Replies after moving from another help desk](email.md#replies-after-moving-from-another-help-desk). A reply to a Closed ticket creates a linked follow-up.

Choose **Complete cutover** after all steps pass. This activates saved agent mappings. The action records your confirmation; it does not edit external forwarding, install a widget, change DNS, send messages or notifications, or invite staff. Your deliberate test message is separate from the inert migration actions. Keep access to the source until counts, files, links and reply routing are checked.

## Errors to resolve

- **401 / credentials refused:** verify the account domain and API key. An account password is not the API key.
- **403 / permission refused:** check the source user’s role, ticket visibility and access to companies, agents and solution content. A valid key alone does not prove complete account access.
- **429 / rate limit:** wait for the provider’s limit to clear, then resume the same run.
- **Attachment failures:** inspect the ticket ID, filename and error in the run. A retained source URL or filename is not a downloaded attachment. Correct the access problem before relying on the migration.

Connection and source-fetch errors must be resolved explicitly. The connector does not substitute sample data or claim that inaccessible history was imported.
