# Knowledge upgrade report route and privacy decisions

`GET /api/knowledge/:projectId/upgrade-report` lets workspace owners and admins
review the stored knowledge upgrade and articles affected by unpublished collection
lineages. The existing `requireProject` and `scope(c,true)` guards require a current
native session and current owner/admin membership in the same active workspace.
The explicit role rule is `settings.manage`, so custom admins must retain that
permission. The native editor's `knowledge.read` or `knowledge.edit` permission
and article selection also bind the returned titles and links. Agents,
collaborators, customers and integration tokens cannot read
the report. Existing article and knowledge body authorization remains unchanged.

The response contains `status` (`pending`, `indexing`, `discovering`, `failed` or
`completed`), `completedAt` (milliseconds or null), `canonicalisedRows`,
`changedRows`, `affectedArticleCount`, `unavailableArticleCount`,
`unpublishedArticles` and `nextCursor`. Each article has only `id`, its current
`title` and an application-relative `editorPath`. The route selects no article
bodies, summaries, snapshots, customer identities, stored row cursors or leases.
Responses use `Cache-Control: no-store`.

The affected IDs are the historical migration report, rather than a fresh list of
all currently unpublished articles. Titles and editor links resolve only against
current articles in that workspace within the reader's editor selection.
Deleted, out-of-workspace or unselected IDs contribute to
`unavailableArticleCount` and expose no ID, title or link. Later publication changes
do not erase the historical report. Distinct affected IDs determine the counts.
Article pages contain at most 100 entries, ordered by ID; pass `nextCursor` as
`?after=` to read the next page. A missing report returns 404. Legacy reports with
no status remain pending until `completed_at` establishes completion. A restored
report whose completion was cleared also remains pending even if its retained
status says completed.

This read creates no records or new erasure surface. Titles are read from current
knowledge articles, so existing knowledge erasure/redaction applies on the next
read without a duplicate title cache. Contact and member erasure keep their
existing scope; the report exposes no erased contact or member identity. Article
deletion leaves only the aggregate unavailable count visible through this route.

Portability retains the existing `knowledge_upgrade_reports` policy: report IDs
and historical counters are backed up, while import/restore clears `completed_at`
and installation-local progress/leases are excluded. This route treats cleared
completion as pending and never establishes upgrade completion itself. It performs
no writes, queues no work and makes no external request.
