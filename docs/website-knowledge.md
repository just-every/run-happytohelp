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

## Collection access and article request links

Round 7 carries forward explicit account grants and deliberate article-request
attribution from the earlier unlanded knowledge work. Integration and acceptance
on the current candidate are pending. Owners and admins grant named, proven
workspace customers; removing the last grant must leave a selected collection
restricted. The required visibility choices are **Public**, **Signed-in customers**
and **Selected customers and companies**. Signed-in admits a proven account;
selected requires a contact grant or a company grant with current explicit
membership in a live, unmerged company. Sharing an email domain grants nothing.
Existing domain collections migrate to selected with no grants; matching companies
are suggestions that require a deliberate Save. Every ancestor's publication and
access rules apply.

The carried article action is **Contact support about this article**, shown when a
published request form is available. Its opaque receipt is valid for 30 minutes
and counts at most one authorized admitted ticket. Attribution binds the workspace,
brand, article, read locale and reader identity when known, and rechecks current
restricted access at admission. Anonymous possession proves linkage only; it never
becomes proof of the submitter's reader identity. A receipt grants no knowledge or
ticket access. The metric is **Tickets from article request links**, at total and
per-article level. Unlinked, expired, consent-denied and unobservable journeys stay
unknown. This is neither all tickets after reading nor deflection. Consent, bounded
retention and complete measurement remain required gaps; validity is not retention.

## Knowledge references and copied text: candidate acceptance pending

The unreleased server candidate keeps knowledge bytes in the knowledge module. Other stores
hold opaque references for inserted text, inserted links, copied spans and AI
answers. A single visibility door takes an explicit reader set and checks current
tenant, brand, article and collection publication, ancestry, member permissions
and article selection, and customer or company grants. Unpublishing an ancestor
makes its articles unavailable on help pages, search, APIs and feedback alike.

A reference pins the original text, so ordinary article edits do not blank earlier
replies. Current loss of access withdraws only the affected reference. Company
ticket visibility does not grant knowledge access. Customer views evaluate the
actual viewer; deliveries evaluate every actual recipient, including CC and BCC;
connected applications evaluate the conversation's current recipients. Server model
inputs receive title/link representations only, and knowledge tools authorize and
record every knowledge body supplied to a model. An AI answer uses all sources
retrieved for its generation, whether cited or not.

Before storage and again at admission, the canonicaliser recognises copied
runs of at least 12 consecutive words across case, Unicode compatibility, markup,
punctuation and whitespace changes and replaces them with references. Its source
index covers current and retained earlier published text, translations and knowledge-derived AI
outputs. Shared public text remains readable. A person's paraphrase without a
copied run remains their own speech. Contact-authored copied spans remain readable
to their author. Implementation in this candidate does not establish acceptance;
this page does not claim passing route, browser, mutation or performance checks.

## Unreleased migrations, backup and upgrade

Keep main's `257_move_in_attachment_bytes.sql` unchanged. Apply the additive
unreleased migrations in file-name order, once through the existing ledger:

- `258_knowledge_entitlements.sql` adds
  `knowledge_categories.requires_entitlement` (default 0), contact grants and
  deliberate article-read receipts.
- `259_knowledge_references.sql` adds company grants, pinned reference bodies,
  generation source sets, copied-text indexes, transactional guards and upgrade
  bookkeeping. Existing domain collections become selected collections with no
  grants. The upgrade report identifies articles in unpublished lineages.
- `260_knowledge_publication_history.sql` retains published translation snapshots
  and marks website documents for indexing when a dataset publication changes.
- `261_knowledge_source_identity.sql` pins exact article publications and retires
  deleted article IDs permanently. Article-create requests cannot recycle a
  retired ID into a different source with new access rules.
- `262_knowledge_upgrade_progress.sql` adds durable table/row upgrade cursors,
  counters and leases for bounded queue work. Existing incomplete reports stay
  pending; a new empty workspace starts with a completed empty report because
  subsequent writes already pass through the knowledge boundary.

| Table | Responsibility |
| --- | --- |
| `knowledge_collection_entitlements` | Contact grants and deliberate grant provenance |
| `knowledge_read_receipts` | One-use, time-limited article request linkage |
| `knowledge_company_entitlements` | Company grants and deliberate grant provenance |
| `knowledge_reply_blocks` | Knowledge-owned source sets and pinned reference bytes |
| `knowledge_generation_sources` | Every source used by support and other model generations, including uncited sources |
| `knowledge_source_index` | Source/version fingerprints for copied-span detection |
| `knowledge_shingles` | Normalised word-shingle lookup index |
| `knowledge_index_dirty` | Sources requiring index refresh before canonicalisation |
| `knowledge_write_guards` | Transactional checks that roll back a refused write |
| `knowledge_canonicalisation_receipts` | Installation-local completion of idempotent text upgrade work |
| `knowledge_upgrade_reports` | Affected unpublished articles and upgrade completion report |
| `knowledge_upgrade_permits` | Transient representation changes to otherwise immutable stored commands |
| `knowledge_translation_publications` | Retained published translation bytes for copied-text recognition |
| `knowledge_article_publications` | Published article snapshots keyed by exact publication identity |
| `knowledge_retired_articles` | Durable deletion fences that prevent article ID reuse |
| `knowledge_upgrade_progress` | Resumable table/row cursor, counters, queue state and lease for a bounded installation upgrade |

Article continuations read the originally issued publication while the article's
current publication, lineage and grants determine visibility. Dataset continuations
read their original document bytes while the dataset's current published version
still contains that URL. An edit or refresh does not itself withdraw an earlier
reference. Main's older article edit history did not record exact publication
identities; an unmapped legacy continuation fails closed instead of substituting
new text. Stored reference payloads retain their pinned text under current access
rules.

Back up before applying missing migrations; never reset to upgrade. The upgrade
must index retained sources, canonicalise existing text that customers, connected
applications or models may receive, and record completion. Unprocessed rows must
not disclose their original text to nonmembers. Upgrade work resumes from its
durable cursor; completion requires every scoped table to be exhausted and its
source index ready. Exact-candidate upgrade
execution and acceptance remain pending.

Portable and native SQL backups retain restriction flags, contact/company grants
and provenance, reference bodies, generation source sets, publication snapshots,
retired source identities and source/shingle indexes. They exclude live read
receipts, help sign-in links/sessions, canonicalisation completion receipts,
transactional write guards, transient upgrade permits and upgrade progress/leases.
Restore sanitization removes whole private receipt rows, including unexpected personal columns, and
clears upgrade completion. A restored installation must establish completion again
before nonmember disclosure. Contact erasure removes grants, personal or
conversation-linked receipts and linked events, and redacts knowledge-owned
personal content/provenance while retaining coherent history. Member erasure
retains scoped pseudonymous grant provenance without making collections public.

## Desktop model context remains blocked

The separately installed desktop connector caches assignment context and can
resume Codex or Claude provider sessions. A fresh server response cannot remove
knowledge bytes already retained in those desktop caches or provider histories
before a later model call. Current-reader rendering on the server therefore does
not prove revocation across desktop model inputs.

The round-7 write scope excludes `local-agent/**`. Connector-side context
invalidation, fresh authority checks before reuse and treatment of resumed model
history require a separate authorized change and public-door evidence. This is a
remaining acceptance block; this candidate claims no desktop cache or resumed
model-session revocation guarantee.

Both knowledge clauses remain partial. The binding riders and retained named gaps
are in [the contract](../CONTRACT.md#knowledge-policy-riders-and-round-7-design)
and [acceptance map](../ACCEPTANCE.md#knowledge-policy-riders-and-round-7-design).

`263_knowledge_indexable_sources.sql` keeps never-published drafts out of the detector dirty queue while retaining every indexed or published source. Strict undo removes an unused import’s own publication and index rows only after checking retained references, generation sources and later native activity. New reference and tool-source writes check the incarnation observed with source bytes inside their insert, so delayed writes cannot borrow a replacement article’s authority. Ordinary article deletion retains history and retired identity.
