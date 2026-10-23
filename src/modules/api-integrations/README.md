# Workspace connections

This native module exposes the bearer-only `/api/v1` API and owner/admin
connection settings. It composes the unchanged Base integration token, D1,
webhook and Slack services with current native workspace authority, guarded
message admission, resolution transitions, contact erasure and knowledge rules.

`http.ts` owns credential verification, scopes, request limits and cursors.
`api-conversations.ts` and `api-resources.ts` own the HTTP resources.
`managed-tools.ts` exposes the stateless MCP catalog and dispatches fixed tools
through these same native API routes. `connectors/zapier/index.mjs` is the
owner-deployed Zapier Platform definition. Neither bypasses native authority.
`settings.ts` owns management operations. `destinations.ts` uses the native
server encryption custody. `dispatch.ts` prepares durable native event intents
and delegates send classification, signatures, claims and retry timing to Base.
Each dispatcher invocation prepares at most eight intents and attempts at most eight sends in total. A persisted workspace cursor resumes a bounded fair page; unprepared and queued work remains durable for later cron runs.
The additive migration commits intents with domain records and removes retained
payloads at the native erasure fence. Historical imports produce no intents.

Deliveries use ordinary platform HTTPS fetch with manual redirects. Every 3xx fails without following its Location. Requests are limited to 1 MiB, responses (including streams) to 64 KiB, and the entire request/response to 10 seconds. Public HTTPS destination syntax and literal IP validation remain enforced; this edition does not claim DNS pinning. Base HTTP 500 remains uncertain without automatic replay; 429 retains four bounded attempts with the same logical identity and exact body. The scoped edition override is dated in CONTRACT.md; copied Base interfaces remain unchanged.

[API and delivery documentation](../../../docs/api.md) describes all13 HTTP
operations. `pnpm run test:connections` runs real local Worker/D1, local receiver,
recorded Slack protocol, browser and emitted artifact checks. Network-edge fixtures exist only under tests and cannot be enabled in the application.
