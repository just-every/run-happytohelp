# Native knowledge capability

This edition-owned TypeScript source replaces the selected PHP dataset/article
controllers and jobs, Python Apify/Qdrant ingestion and deletion, and Python
per-collection retrieval. It has no PHP or Python runtime dependency and no inbox
schema dependency. Consumers supply `Env` bindings and a project identity.

`index.ts` exports Hono `routes`, `consumeJob(job, env)`,
`refreshDueDatasets(env)`, `refreshDataset(...)` and `searchKnowledge(...)`.
Mount routes at `/api/knowledge`; route every `knowledge.*` job to the consumer;
call `refreshDueDatasets` from the edition scheduler. Apply migrations 0050–0052.

A refresh keeps the prior published version visible. Its claim and source input
are persisted before dispatch. Documents and vectors are staged in R2 and D1;
publication switches only after all pages complete. Each document page contains
at most 20 documents and each embedding request at most 32 chunks. There is no
100-document/256-chunk product ceiling. Duplicate completed page delivery does
not repeat provider requests. An interrupted processing attempt is marked failed
after 20 minutes and requires an explicit refresh; it is never automatically
replayed as a provider request. Sources and embedding-model identity are retained by
version. Lexical ranking is the existing title-weighted token policy, explicitly
separate from semantic retrieval. Semantic retrieval uses Qdrant MMR with one
selection per collection, matching the Python source; no missing-index lexical
fallback is substituted.

Dataset authoring retains URL, exclusions, crawl depth/page settings and
manual/daily/weekly/monthly/adaptive refresh. Crawl depth must be a whole number
from 0 to 100 and the page limit from 1 to 10,000 (`crawl-limits.ts`); the dataset
routes answer 400 otherwise, the dashboard form shows the same messages, and the
crawler start re-checks stored values so an out-of-range record is refused before
any provider request. Without crawler configuration, `website-reader.ts` reads
the source itself: public HTTPS only (the site-read fetcher's DNS and redirect
fences), robots.txt honoured, same site and starting path, the saved depth and at
most 40 pages, HTML text only. Its failures are stored as plain sentences. With
`APIFY_TOKEN` and `APIFY_CRAWLER_ACTOR_ID` a configured Apify actor starts the
crawl and its persisted run is polled without starting another crawl; one of the
two alone is refused with a sentence naming the missing setting. Supplied
documents, Apify datasets and conversation messages can also be ingested.
Article/category authoring includes hierarchy, cycle checks, ordering, summaries,
publication and multiple categories. Public reads and search expose published
articles only. Native Intercom, Freshdesk and Zendesk imports use a durable job
per provider page and stable project/provider identities. HTML is converted in
Workers; executable elements are removed. Repeating an import updates its records.

Optional configuration: `APIFY_TOKEN`, `APIFY_CRAWLER_ACTOR_ID`,
`OPENAI_API_KEY`, `KNOWLEDGE_EMBEDDING_MODEL`, `QDRANT_URL` (HTTPS),
`QDRANT_API_KEY`, `INTERCOM_TOKEN`, `FRESHDESK_TOKEN`, `ZENDESK_EMAIL`,
`ZENDESK_TOKEN`. Missing selected configuration is an explicit error. Credentials
are never stored in import jobs. Publication and provider execution require the
edition's operating authorization.

Verification: `node tests/journeys/knowledge.mjs` builds a dedicated test Worker
and exercises real local workerd, D1 and R2. Twenty-two assertions cover a 138-document
corpus, repeated queue deliveries, failed refresh, tenant denial, public drafts,
original authoring inputs, cycles, multi-category articles, native HTML import,
repeat import identity, all three provider hierarchy imports, MMR and a semantic corpus above 256 chunks. External
provider responses and queue dispatch are fixtures confined to test code; no
live-provider, production, or paid-call proof is claimed. The fixture queue runs
the actual production job consumer. `tests/journeys/knowledge.mjs` additionally
exercises native pure contracts and SQLite publication guards.

Source corpus normalization currently materializes the supplied document array
before staging its bounded pages. Very large individual source exports still
need a streaming source reader to stay within Worker memory; there is no claim
that arbitrarily large exports fit one Worker invocation. Article import formats
and provider availability remain subject to configured-provider acceptance.

AI retrieval uses `door.ts` for the required reader set: the operator and every
current ticket recipient must pass the current tenant, publication, lineage,
brand and account/company rules. Dataset documents remain visible while their
published dataset contains that URL. IDs are `article:<id>` and `knowledge:<id>`;
continuations pin the sourceVersion issued by search. Publication snapshots fix
which text a reference renders; edits and refreshes do not withdraw old replies.
Unpublication, revocation, lineage moves and deletion do.

`reference-store.ts` owns opaque references and rendering. `canonicaliser.ts`
recognizes copied normalized word runs, including previous publications and
translations. `write-boundary.ts` protects bound D1 text writes, while admission
and mail claims embed the same current visibility predicate. Model transcript
references render as titles and links; bodies enter through recorded knowledge
tools. Native links use APP_ORIGIN and `/help/<projectId>/<slug>`.

The round remains partial. The current evidence and limitations, including cached
desktop provider history outside the server write scope, are recorded in
[website knowledge](../../../docs/website-knowledge.md).
