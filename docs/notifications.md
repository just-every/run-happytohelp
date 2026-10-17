# Ticket notifications

Your workspace includes editable **request received** and **solved** email notices. Open **Settings → Project → Notifications** to change their text, expected reply time and channel or brand scope. The received notice includes the ticket reference and expected reply time. Use the same [placeholders as saved replies](macros-and-teamwork.md); a missing value is shown as a template failure in the outcomes list instead of being sent literally.

A new customer request receives at most one acknowledgement per ticket. Solving a ticket sends at most one solved notice, even if it is reopened and solved again. Notices go to the requester and proven customer CC recipients. A visitor's own widget address can receive its notice; typing an address into a widget does not prove that address belongs to a customer CC.

Machine-generated mail, suspended or isolated mail, imported history and merge operations do not produce these notices. Redelivery does not send another copy. Public replies continue to use the ticket's customer recipients and their individual reply addresses.

Open your **Profile → Notification** tab to choose inbox and email delivery for assignment, customer updates, group tickets, tickets you follow and mentions. Your notification inbox links each notice to its ticket and lets you mark it read. Your existing unassigned-activity preference controls the unread digest for unassigned tickets.

Only current teammates with access to the ticket receive team notices. An unassigned group ticket alerts the current group; an assigned ticket alerts its assignee. Followers receive updates and mentioned teammates receive their mention. Your own action does not notify you. Removing a member or disabling a delivery preference stops future deliveries.

Delivery outcomes are retained. A provider's acceptance is not proof that the person read the message. An uncertain provider result is never replayed automatically. Local `rer dev` suppresses external mail; the same settings and inbox remain available.

An export includes these settings and outcomes. Restoring it disables saved automatic trigger templates, cancels queued notices and revokes partner reply access. Review the settings before enabling notifications in the restored installation. Editable macro drafts and private history remain available.

Web push, mobile push and personal Slack or Teams delivery are separate channel work and are not included in this round.
