# HappyToHelp 0.4.52

The stateless Worker now dispatches three GET requests to the existing `ConversationSocket` Durable Object. Live v0.4.51 Worker fetch CPU p99 was 23.90 ms. The highest first-request and warm readings for these routes on the fixed scratch Worker were below the Workers Free 10 ms limit.

- **Settings** (`/projects/:id/settings`) used 65 ms live. The fixed scratch maximum was 4 ms on the first request and 1 ms warm.
- **Contact identity links** (`/api/management/projects/:id/contacts/:id/identity-links`) used 25 ms live. The fixed scratch maximum was 2 ms on the first request and 0 ms warm.
- **Signed-out root redirect** (`/`) used 15 ms live. The fixed scratch maximum was 2 ms on the first request and 1 ms warm.

The update uses the existing Durable Object and requires no migration.

Update from v0.4.51 without resetting. Back up D1, R2, Durable Object state, private settings and installation encryption custody. Stop the old Worker before updating and retain native owners, memberships, permissions, support history, files, erasure fences and all applied migration identities. Use Node 22.20.0, pnpm 10.12.4 and rer 0.2.142. The existing Wrangler migration `v1` already provisions `ConversationSocket` on v0.4.51. Keep that migration and the `CONVERSATIONS` binding in the deployment. The update adds no Wrangler or D1 migrations. For older installations, follow the upgrade steps in the intervening published releases and apply each missing migration once in filename order before serving HTTP or queue traffic. Run `rer deploy --dry-run` against the retained installation before deploying. On the first hosted deploy, supply `--owner-name` if the installation has no saved owner name. Retain the durable recovery revocation watermark on rollback. Portable restore requires fresh Managed recovery and custody binding.

_Run Edit Run fleet, 2026-11-27._
