# Saved replies, macros and teamwork

Use **Saved Replies** in your workspace to save text and actions your team repeats. A macro can fill a public reply or an internal note and change its status, priority, tags, assignee, group, followers and custom fields. It can also include files you uploaded to a ticket.

Open a saved reply to edit its actions and choose who can use it: just you, selected groups or the shared workspace. Role and brand restrictions apply every time someone previews or applies it. Saving creates a new version. Version history and usage show which version teammates used; deleting removes it from the picker while preserving its history.

From a ticket, open **Reply tools → Saved replies**. Read the rendered text and action preview, then apply. Review and edit the resulting draft before sending. Applying a macro never sends a reply or note. A simple text-only saved reply inserts at your cursor and preserves the rest of your draft.

Use placeholders such as `{{requester.first_name | there}}`, `{{requester.email}}`, `{{ticket.id}}`, `{{ticket.subject}}`, `{{ticket.link}}`, `{{assignee.name}}`, `{{brand.name}}` and `{{organisation.name}}`. Custom values use `{{ticket.custom.FIELD_ID}}` and `{{contact.custom.FIELD_KEY}}`. A value after `|` is an explicit fallback. A missing value stays visible in the preview and blocks sending until you resolve it. Private custom fields stay subject to their read permissions.

To apply a macro in bulk, select tickets in the inbox, choose the macro and use **Preview all tickets**. Inspect each result, then apply the reviewed macro. A stale, unavailable or forbidden ticket has its own result; the others can succeed. Every resulting reply or note is saved as a draft for its operator to review separately.

## Notes, mentions and followers

Internal notes stay inside your team. In **Add Note**, choose a teammate in **Mention a teammate** to add an `@mention`. Only current members of this workspace can receive it. Private note files remain private and cannot be attached to a public reply later.

Use **Follow** to receive updates on a ticket. An operator who can manage the ticket can use **Internal CC** to add other teammates. Internal followers are separate from customer CC recipients and never appear in the customer's history. A collaborator role can add notes and follow; it cannot send public replies or merge tickets.

Above the composer, viewing, typing and unsent-draft indicators show other operators on the same ticket. No draft text is shared. If the live connection drops, the indicator says so. Check a collision warning before replying; the server also refuses a stale send.

## Merge duplicates and work with partners

On the ticket you want to keep, select **Merge ticket**. Enter the source ticket and preview both identities, channels, histories and the treatment of reports. The current ticket survives. Original messages, attachments, notes, attribution and resolution evidence remain intact, with links to their source. The merged source leaves active queues and report cohorts. Merging sends no customer message or notice.

The surviving operator thread includes the source histories. Customer access stays tied to each ticket's original identity. When the same customer owns both tickets, their widget follows the surviving ticket. A merge never grants one customer access to another customer's history.

Open **Merge history → Undo merge** to restore the source to the queue. Undo is refused if either ticket changed or partner activity advanced after the merge. Review the retained history when undo is unsafe.

Use **Forward to partner** to select customer-visible messages and files for an external partner. Preview the recipient and exact content first. Internal notes are never forwarded. The partner receives its own reply address; replies and files return to **Private partner threads** in the ticket. They do not enter customer history or trigger customer acknowledgements. Revoke partner replies when that collaboration ends. A delivery whose outcome is uncertain is shown as uncertain and is never automatically resent.
