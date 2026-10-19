# Companies and CSV imports

Open **Contacts**, then **Companies**, in a workspace to keep customer accounts together. Create a company, add its email domains, and add contacts as members. A contact belongs to one company at a time. The company page lists its members and their tickets. In the inbox, choose a company to narrow the ticket list.

## Company attributes

Create an attribute in Companies before filling it in on a company. Attributes can hold text, a number, a date, a choice from a list, or a checkbox. Dates use year-month-day. Choices must come from the options you set.

## Merge companies

Choose the company to keep, then choose the company to merge into it. Review the preview before confirming. The preview shows the members and domains that move and the values that remain. The history keeps the source and the changes. Use **Undo** in that history to reverse a merge. If either record has changed since the preview or merge, reload and review the current records before continuing.

A merge does not broaden portal access. Review the surviving company's entitlement after merging.

## Import a CSV

In Companies, open **Import CSV** and choose contacts or companies. Upload your CSV, then map its column headings to the fields you want to fill. Leave a column unmapped to ignore it. Company attributes must already exist.

For contacts, you can enable email-domain matching. The preview names the company matched by each email domain. You can also map a company explicitly. Matching a domain never proves ownership of an email address and never signs anyone into the portal.

Run the preview. Every row shows whether it will create a record, update a record, or be skipped, with a reason. Review the entire preview before applying it. If records have changed since the preview, make a new preview. Applying and undoing an import require your import permission and a recent identity confirmation.

Imports send no email or notifications and start no workflow or SLA work. Keep the import result to open its history. **Undo import** reverses the changes from that import. Later changes are protected: an undo that would overwrite them is refused. Removing a contact's personal data also removes its retained CSV data and prevents an old import or merge from restoring it.

## Company tickets in the portal

Company access starts off. On a company's page, an operator can explicitly allow its members to view and reply to company tickets. This grants access to the tickets of current company members. It never grants access to another company's tickets or another workspace.

When access is off, customers see only their own tickets. Removing a member or turning access off takes effect on the next request, even for a customer who is already signed in. See [the customer portal](customer-portal.md) for sign-in and replies.
