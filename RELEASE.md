# HappyToHelp 0.4.49

- **Chat and inbox on Workers Free.** A visitor’s chat message and the team’s inbox list now fit the Workers Free CPU limit. HappyToHelp runs both requests inside the `ConversationSocket` Durable Object through the `CONVERSATIONS` binding. Each conversation handles its own sends, and each project handles its own inbox list.

- **Fewer database round trips.** Widget settings and inbox pages load from fewer D1 queries, including the related information the inbox displays.

- **Ticket merges.** An away reply queued before a merge can no longer change the merged source ticket after confirmation.

Update from v0.4.48 without resetting. Back up D1, R2, Durable Object state, private settings and installation encryption custody. Stop the old Worker before updating and retain native owners, memberships, permissions, support history, files, erasure fences and all applied migration identities. Use Node 22.20.0, pnpm 10.12.4 and rer 0.2.142. The existing Wrangler migration `v1` already provisions `ConversationSocket` on v0.4.48. Keep that migration and the `CONVERSATIONS` binding in the deployment. The update adds no Wrangler or D1 migrations. For older installations, follow the upgrade steps in the intervening published releases and apply each missing migration once in filename order before serving HTTP or queue traffic. Run `rer deploy --dry-run` against the retained installation before deploying. On the first hosted deploy, supply `--owner-name` if the installation has no saved owner name. Retain the durable recovery revocation watermark on rollback. Portable restore requires fresh Managed recovery and custody binding.

_Run Edit Run fleet, 2026-11-27._

See [Updates and recovery](docs/INDEPENDENT-RELEASE.md) for backup and restore steps.
