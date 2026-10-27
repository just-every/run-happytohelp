# Website knowledge

Add your website under **Knowledge → Website sources → Add URL** and your AI
assistant can answer from what the site says, alongside your help-centre
articles. Nothing needs setting up for most sites: HappyToHelp reads the pages
itself. A crawler service is the larger option, for big sites and sites built
with JavaScript.

## Add a website

1. Open **Knowledge**, then **Website sources**, then **Add URL**.
2. **Starting URL**: the page to start from, for example
   `https://example.com/help`. Only that page and pages under it are read
   (`/help/shipping`, `/help/returns`), all on the same site.
3. **Excluded URLs** (optional): one pattern per line for pages to skip. `*`
   matches within one part of the address and `**` matches anything, for
   example `https://example.com/help/archive/**`.
4. **Max Crawl Depth**: how many links away from the starting page to follow.
   `0` reads only the starting page; `3` suits most help sections.
5. **Max Crawl Pages**: the most pages to read per refresh.
6. **Refresh website content**: when to read the site again. **Automatic**
   starts daily, checks less often while nothing changes and returns to daily
   when it finds updates.
7. Choose **Add URL**. The first read starts at once; the source's **Overview**
   shows its progress and then the number of pages it indexed. **Indexed pages**
   lists each one.

Your assistant uses the new pages as soon as the read finishes. A later refresh
that fails keeps the last pages it read.

## The built-in reader

With no crawler service set up, HappyToHelp reads the pages itself, with no
account, key or cost:

- it reads public `https://` websites only; an address on your own computer or a
  private network cannot be read;
- it honours the site's `robots.txt`;
- it reads at most **40 pages** per refresh, whatever **Max Crawl Pages** says;
- it reads the text in each page's HTML. A page needs a title and at least a
  paragraph of text to be kept; menus, headers, footers and forms are left out.
  Pages that a browser builds with JavaScript come back empty.

If no page could be read, the source's **Overview** says why in plain words,
for example that the address answered an error or that the pages had no text.

## Larger sites: the crawler service

For more than 40 pages, or a site whose pages appear only after JavaScript
runs, set up the crawler service. It is [Apify](https://apify.com), a separate
web-scraping service; HappyToHelp runs Apify's Website Content Crawler, which
opens each page in a real browser and reads up to 10,000 pages. Apify's free
plan includes $5 of usage a month with no card; larger crawls are paid by
usage ([Apify pricing](https://apify.com/pricing)).

1. Create an account at [console.apify.com](https://console.apify.com/sign-up).
2. Open [Settings → API & Integrations](https://console.apify.com/settings/integrations)
   and copy your **Personal API token**. That is `APIFY_TOKEN`.
3. `APIFY_CRAWLER_ACTOR_ID` names the crawler: `apify~website-content-crawler`.
4. Add both values to your installation. They are installation secrets, set
   once for every workspace:
   - **On your computer** (`rer dev`): add two lines to the `.dev.vars` file in
     your HappyToHelp checkout, then restart with `rer dev --stop && rer dev`.

     ```sh
     APIFY_TOKEN=your-apify-api-token
     APIFY_CRAWLER_ACTOR_ID=apify~website-content-crawler
     ```

   - **Hosted**: in the Cloudflare dashboard open **Workers & Pages**, choose
     your HappyToHelp Worker, then **Settings → Variables and Secrets → Add**.
     Add each name as type **Secret** with its value and choose **Deploy**.

Once both are set, every website source uses the crawler, up to its **Max Crawl
Pages**, and each refresh uses your Apify account's usage. The website source
form shows **Crawler service set up**. If only one of the two values is set, the
form and each refresh name the missing one; add it, or remove the other to go
back to the built-in reader.

Semantic search over website content additionally needs `QDRANT_URL`,
`QDRANT_API_KEY`, `OPENAI_API_KEY` and `KNOWLEDGE_EMBEDDING_MODEL`; keyword
search needs none of them. See the settings table in
[Operations](../OPERATIONS.md).

## Collection access and article requests

Owners and admins can open a collection's **Named customer accounts** section,
search verified workspace customers, add or remove accounts, then save. A
collection requiring grants is labelled **Named accounts only**, with its account
count. Removing the last account keeps the collection restricted. To make it
public, explicitly choose **Anyone (public)** and clear the named-account
requirement. Collection ancestry still applies. Company membership and matching
email domains never create a named-account grant.

An article offers **Contact support about this article** only when a published
request form is available. The link carries an opaque receipt valid for 30
minutes. A receipt counts at most one admitted ticket, with the original
workspace, brand, article and read locale and the authorized reader identity
when known. Anonymous possession proves linkage only. Restricted access is
checked again at admission. Article analytics shows the total and per-article
**Tickets from article request links**. Unlinked, expired, consent-denied and
otherwise unobservable journeys remain unknown; this count is neither all
post-read tickets nor deflection. Full consent, bounded retention and measurement
coverage remain required gaps.

Unreleased migration `257_knowledge_entitlements.sql`, after migration 256, adds
`knowledge_categories.requires_entitlement` (default 0) and the tables
`knowledge_collection_entitlements` and `knowledge_read_receipts`. Existing
collection fields remain unchanged. Portable backups retain explicit grants and
provenance while excluding live receipts; the restore sanitizer removes receipts
from older archives. Customer erasure removes their grants, receipts and linked
events. Member erasure retains scoped pseudonymous grant provenance without
making a collection public. Back up the installation and apply missing migrations
once, in ledger order, before serving the updated Worker; never reset to upgrade.

Unreleased migration `258_knowledge_reply_sources.sql`, after 257, adds
`knowledge_reply_sources` for durable ticket composition provenance. Before article
text or a link leaves a ticket search, preview or insertion door, the server records
its source and publication version. The single `customerReplyAdmissionSql`
predicate in `src/modules/knowledge/delivery.ts` is the authority boundary for
native composer, widget, email, API, AI auto-send, replay, scheduled and saved
replies, article links and attachments, proactive insights, away replies, transcript email and partner forwarding.
Each writer evaluates it inside its admitting statement. Previews, drafts and
AI output carry provenance, never authority. Current requester and participant
identities (including pending email CCs) must each have a current explicit grant
for every restricted collection and ancestor. Company ticket visibility and a
matching email domain confer no knowledge grant. Restricted agent retrieval
still refuses tickets with additional participants; independently entitled help
access is preserved.

The fence accumulates across edits and sends: clients cannot prove previously
retrieved material was removed. A changed grant or publication refuses the send
with a knowledge-access message. Removing an unauthorized participant restores
send access when every remaining recipient is entitled. Revocation also withholds
stored/replayed replies and attachment downloads; download admission is rechecked
after reading storage. Email rendering carries source identity into the common mail
sender, which checks the final To, CC and BCC addresses in its durable send claim
immediately before provider submission. Held resends and additional asynchronous
consent/rate preparation recheck current authority before submission. A signed attachment URL never grants
restricted knowledge access: the reader must authenticate and remain entitled. Backups retain these identifier-only
fences, independently of audit retention. Contact erasure removes its ticket
fences. Non-public collections always require a current explicit named-account
grant, including legacy rows with `requires_entitlement=0`; domain membership is
only an additional constraint. No additional company entitlement is implemented.
