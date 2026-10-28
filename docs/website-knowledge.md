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

## Publish a governed help center

Under **Knowledge → Help Center settings**, configure your source language,
translation locales and plain-text page templates. Reviewed translations retain
their published text while a new draft is edited. A changed source requires a new
translation review; pages and AI citations disclose source-language fallback.

Your hosting administrator first configures DNS, TLS and the exact
`PUBLIC_HELP_HOSTS` hostname-to-workspace mapping. You can then publish at one
approved address, keep the deployment’s existing addresses, or use only the
built-in Help Center paths. An address mapped to another workspace cannot be
claimed. A custom article-link color must have at least 4.5:1 contrast on white.

**Review proposals** shows search gaps, reopened source cases and recorded
procedure failures. Prepare a draft from a resolved, positively rated native
case and its exact message. Operator-requested AI assistance can also prepare a
masked, cited draft; it cannot publish one. The exact requesting operator session
and current knowledge authority remain required. A named editor reviews the
source, personal data, private destination collection and text before publication.
Rejections remain visible after later approval. Reopened cited cycles request
corrective review and never silently change published guidance.

Customer-derived guidance stays within the source customer’s proven email-domain
collection and the workspace’s default publication locale. Public/cross-domain reuse and translated or
cross-brand reuse remain held. Citation, satisfaction and ticket closure alone do
not establish verified customer recovery.
