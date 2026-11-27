# HappyToHelp 0.4.50

- **Scheduled work on Workers Free.** The minute Cron trigger hands due passes directly to the existing `ConversationSocket` Durable Object. This drops the scheduled tick's Queue usage from about 4,300 operations per day to zero. Normal application jobs still use the Queue, and each delivery hands its job to a Durable Object for execution.

- **Hosted CPU measurements.** Cron went from 0–2 ms to 0–1 ms across 11 ticks. Queue deliveries went from 12–128 ms to a maximum of 0 ms in 18 deliveries. Running the jobs in the Queue consumer after moving the pass had still cost 7–44 ms. Durable Object passes took 30–168 ms with a median of 35 ms across 11 ticks. Durable Object jobs took 17–53 ms across 18 jobs.

Update from v0.4.49 without resetting. Back up D1, R2, Durable Object state, private settings and installation encryption custody. Stop the old Worker before updating and retain native owners, memberships, permissions, support history, files, erasure fences and all applied migration identities. Use Node 22.20.0, pnpm 10.12.4 and rer 0.2.142. Keep the existing Wrangler migration `v1` and the `CONVERSATIONS` binding for `ConversationSocket`. The update adds no Wrangler or D1 migrations. Any `scheduled.tick` messages still queued at upgrade go through the Queue’s retry and dead-letter handling. The next Cron tick rediscovers work that is still due. For older installations, follow the upgrade steps in the intervening published releases and apply each missing migration once in filename order before serving HTTP or Queue traffic. Run `rer deploy --dry-run` against the retained installation before deploying. On the first hosted deploy, supply `--owner-name` if the installation has no saved owner name. Retain the durable recovery revocation watermark on rollback. Portable restore requires fresh Managed recovery and custody binding.

_Run Edit Run fleet, 2026-11-27._

See [Updates and recovery](docs/INDEPENDENT-RELEASE.md) for backup and restore steps.
