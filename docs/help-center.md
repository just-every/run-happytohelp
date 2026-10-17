# Help Center

Your Help Center is the place customers can find answers before they contact
your team. Open **Knowledge** in the workspace, then use **Articles**, **Help
Center settings** and **Article analytics** to manage it.

Published articles appear at your workspace's Help Center address. **View Help
Center** opens the customer view. The existing workspace name, logo, colour and
greeting are used for its identity.

## Organize and publish articles

In **Articles**, choose **New Article** to write an article, or use **Import**
to bring in articles from a supported help center. Add a title, summary, content
and one or more categories. Save an article as a draft while it is being
prepared; publish it when it is ready for customers. Only published articles
appear in the public Help Center and public search.

Categories can be nested. For a category, set **Who can read this collection?**
to one of these options:

- **Anyone (public)** makes its articles available to everyone.
- **Signed-in customers** requires a customer to sign in to the Help Center.
- **Customers with selected email domains** requires a signed-in customer with
  a verified email address from one of the allowed domains. Enter one domain per
  line under **Allowed email domains**.

Access rules apply to articles in the category and its child categories. They
also apply in search and AI answers. A published article in a restricted
collection remains restricted. Signed-in customers request a sign-in link by
email; the link is valid for a limited time. The email must be verified before
selected-domain access is granted.

A category's **Published** switch controls whether it appears in navigation.
To take an article offline, save the article as a draft. Collection access rules
still apply when a category is hidden from navigation.

## Languages and translations

Open **Help Center settings** to choose the default language and the languages
your Help Center offers. Write a separate translation for each article from its
**Translations** section. Translations are reviewed by a person: a saved draft
does not replace the last reviewed version customers can read. Mark the
translation **Reviewed — ready for readers** when it has been checked.

Customers can switch between the languages available for the current article.
If an article has no reviewed version in the selected language, the Help Center
uses its default-language version and identifies the language shown.

## Review changes and keep article links working

Article edits are recorded in **Version history**. Open an earlier version to
preview it, then choose **Restore** to make that content the current version.
Restoring preserves the intervening history. If you change an article's slug,
the old article address redirects to its current address.

**Help Center settings** also contains editable plain-text page templates for
the home, category, section, article, search and request form pages. Use
`{{title}}`, `{{summary}}` and `{{content}}` to place the page's current content
in a template. Preview it with current workspace or article content before
saving. Home, category, section, article and search templates apply to the
current Help Center. Customers can send a request at `/help/:project/requests`
and follow it in the [customer portal](customer-portal.md). See
[Customer request forms](request-forms.md) to publish forms and translated questions.

## Feedback and analytics

Published articles ask **Was this helpful?** Customers can vote and optionally
leave a comment. **Article analytics** shows views and helpful votes, search
terms and whether they returned results, and article click-through. Filter the
results by brand and language. Ticket-creation attribution after reading an
article is not available.

From a ticket, open **Reply tools → Help articles** and use **Search help
articles**. Choose **Insert link** or **Insert text** to add an article to the
reply draft. Only published articles the recipient can read are offered, and
access is checked again when you insert one. You can edit the draft before
sending it.

## Addresses and limits

An installation may be configured to serve a Help Center host. Separate custom
domains for each brand are deferred. An email-domain rule controls who may read
a collection; it does not grant access to another customer's portal requests.
[Request forms](request-forms.md) reuse the workspace's ticket fields; the
[portal](customer-portal.md) gives customers access to their own requests.
Company-wide request visibility is not available yet.
