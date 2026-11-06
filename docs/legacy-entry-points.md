# Legacy entry points and migration

This is the caller inventory for the native edition's owner-controlled switch,
prepared on 16 October 2026. Source support is distinct from a production switch.
**`js.`, `ws.`, `cdn.`, `storage.` and `app.happytohelp.com` remain on legacy.**
Alternate-brand and staging hosts remain where they are too. No DNS, TLS, AWS,
mail routing, production application, plugin or payment configuration was changed.
A new native installation does not become the recipient of old traffic merely
because it contains imported records.

The decisions below cover C01, C02, C05, X03 and H16. “Native” means a caller can
be migrated to the named native interface; “Drain” means retain the old receiver
until its callers, active work and late deliveries have been explicitly accounted
for. Neither label claims a live provider or real customer cutover was qualified.

## Observed public callers

Only unauthenticated public GETs were used. No chat was opened, contact endpoint
called, message sent or private account accessed. These are source observations,
not browser execution or a complete inventory of every page/customer/session.

| Public source inspected on 16 October 2026 | Actual boot options and calls | Migration consequence |
| --- | --- | --- |
| [ChargeDesk homepage](https://chargedesk.com/) (HTTP 200) | `window.h2hQueue`; `function h2h() { h2hQueue.push(arguments); }`; `h2h('init', {"projectId":"4dd25583-d4df-49a6-9c85-8f9879e18fe4","selector":".launch-chat"})`; async `https://js.happytohelp.com/widget.js`. | Retain project public key and `.launch-chat` selector behavior. This HTML alone does not establish successful messaging. |
| [12ui homepage](https://12ui.com/) and its [referenced public JavaScript bundle](https://12ui.com/_expo/static/js/web/index-1ffa2adc57ab71c2f853a849817f22ba.js) (HTTP 200 with a browser User-Agent) | HTML has no inline H2H snippet; the bundle defines `projectId: '019fdaef-fd7f-70dc-9e53-459a32b9866c'`, a `h2hQueue` stub and async `https://js.happytohelp.com/widget.js`, then calls `h2h('init', {projectId})`. Its route predicate enables the widget for `docs` and `versus` route categories. Cleanup calls `h2h('close')` and hides `#happytohelp`. | Preserve dynamic script discovery and queued calls; a homepage-only search would miss this real caller. |
| Same 12ui bundle, authenticated-contact code path (source only) | Requests its own `/api/v1/support/contact`, then calls `h2h('update', {identifier, hash, email?, name?, metadata?, metadataHash?})` with fields at the top level. This endpoint was **not** requested. | Treat an update as supplied identity/context under native validation. A legacy hash or caller-supplied identifier is never operator authority. Signature generation must agree with native verification before real identified visitors move. |
| [RamonNastase homepage](https://ramonnastase.ro/) and all 16 directly referenced same-origin static scripts (HTTP 200) | No `h2h`, `h2hQueue`, `hasContext`, HappyToHelp or `launch-chat` reference was found in those sources. Other widgets in the HTML included iClosed. | No H2H boot options can honestly be attributed to these responses. This does not prove other pages, third-party/dynamically loaded scripts, cookie states or historical installations have none; keep this site on the owner inventory. |

An initial default Python User-Agent received HTTP 403 from 12ui; the browser
User-Agent returned its real titled page. No challenge interaction was attempted.
Public project IDs above are installation identifiers, not secrets.

The Ramon static-source pass covered its directly referenced cookie-law-info,
jQuery, Divi (scripts/fitvids/easypiechart/salvattore/common), advanced-ads,
PixelYourSite (bind-first/cookie/SHA-256/public) and WordPress mediaelement
scripts. These were read as text only; third-party widgets and tracking services
were not fetched or executed.

## Install

New native snippets use the native **application** origin and a project's public
widget key. Save the customer's exact website origin in Widget settings first.

```html
<script src="https://support.example.com/widget.js"
        data-api-origin="https://support.example.com"
        data-widget-key="PUBLIC_WIDGET_KEY" async></script>
```

For a retained legacy snippet, import the original project ID or retain its
explicit public slug alias. The bridge resolves that ID/alias through
`GET /api/widget/legacy-project?projectId=…` to the current native public widget
key; the resolver checks the project's exact allowed origin, excludes deleted
projects and returns no session. A new key does not require changing an old
project-ID snippet when that source identity is retained.

When the native Worker serves `/widget.js`, it prefixes the script with the
configured `APP_ORIGIN` as `data-api-origin` unless the script already supplies
that attribute. Thus the old `js.` host can eventually serve this asset while
its API remains on the native app origin. The option precedence is explicit
`apiOrigin`, script `data-api-origin`, old `apiUrl`, then script URL origin. A
separate asset host without the prefix needs explicit native-origin configuration
or a coordinated rebuild; do not accidentally send native API calls to an
unconfigured CDN. No host routing has been changed. See
`src/modules/legacy-import/README.md` for the reviewed import contract.

The old standalone script contract accepts `data-project`, `data-projectId`,
`data-project-id`, and `data-config` JSON (the old parser also permitted single
quotes); queued `h2h('init', {projectId})` and `project_id` occur in original
instructions. Preserve `#launch-chat` on the customer's own host page. Never
replace those emailed customer links with an invented support hostname.

## JavaScript API

The original entry point exports `h2h`; the alternate HasContext build exports
`hasContext` and uses `hasContextQueue`. Original source dispatches the following
commands, independently of whether any public site currently calls them.

| Original command | Native migration decision |
| --- | --- |
| `init` | Normalize legacy project key/options into a native widget installation; native exact website-origin admission still applies. Reinitialization replaces widget ownership and must release the prior widget. |
| `open`, `close` | Open/close the mounted widget; queued calls must work after mount. The initial host-page fragment `#launch-chat` opens it. |
| `update` | Accept contact updates, including observed 12ui top-level fields, as unverified preferences. In legacy-project mode strip old credentials and metadata with an explicit warning; use native `widgetKey` mode and freshly issued signatures for verified identity. |
| `settings` | Alias the supported settings/update operation; this never changes server authorization. |
| `request`, `ask`, `sales`, `support` | Use the native request path, with the last three selecting the corresponding `method`. A missing provider/configuration or unsupported request is an explicit failure, never a fixture reply. |
| `consent` with `{provided: boolean}` | Honor deferred initialization and revocation. Revocation releases UI, connection and collected pending activity. |
| `raw` with `{onChange: function}` | Keep callers on legacy unless individually migrated; no claim that a raw legacy collector callback has a native bridge. |
| `destroy` | Native lifecycle addition; removes the widget and pending initialization. |
| `shutdown` | Native addition for sign-out, like Intercom's `shutdown`: works in any state (queued before the script loads, during initialization, while awaiting consent or mounted), removes the widget like `destroy` and forgets every widget session this page origin stores. Call `init` again for the next visitor. |
| Any other command | Unsupported; migrate its caller rather than silently acknowledge it. Native `preview` is a separate owner preview surface, not evidence of an original public command. |

### Visitors who sign in and out

The widget keeps a visitor's conversation only for the visitor the page supplies
in `contact` (through `init`, `update` or the legacy top-level fields), never for
details the visitor types into the widget. That visitor is its `identifier`
(exact, trimmed) when present, otherwise its `email` (trimmed, any letter case),
otherwise an anonymous visitor. A browser keeps one anonymous and one signed-in
session per installation:

- A page with a different visitor never reads, writes or shows another visitor's
  conversation; it starts a new session for its own visitor.
- A visitor who chatted signed out and then signs in (without a signature) keeps
  that conversation, now with the name and email the page supplies, recorded as
  unverified; later signed-out pages start fresh. A signed visitor (`hash`) starts
  or resumes its verified contact instead.
- A visitor returning while it is still the browser's signed-in session gets its
  conversation back. Another visitor signing in replaces that session, so the
  first starts fresh afterwards (a signed visitor is re-linked by its signature).

Call `h2h('shutdown')` when a visitor signs out, and before switching accounts
without a page load, then `h2h('init', …)` for the next visitor. Shutdown does not
revoke server sessions; it removes the widget and this browser's stored sessions.

## JavaScript options

Source options include `projectId` / `project_id`, `targetElementId`, `open`,
`selector`, `contact`, `settings`, `theme`, `text`, `conversationSettings`,
`apiUrl`, `wsUrl` and `proxy`. `contact` may contain name/email, identifier,
identity hash and signed metadata. Old documentation locates consent at
`settings.await_consent`; old code also inspected top-level `await_consent`.
The native installation uses `apiOrigin` / `widgetKey` and a single native
transport. Old `apiUrl` / `wsUrl` values must not cause a native widget to speak
the legacy HTTP or encrypted WebSocket protocol. A proxy or raw collector caller
needs an explicit migration decision; importing options alone does not qualify it.

**Legacy-project mode deliberately strips `hash`, `key`, `token`,
`metadataHash` and the entire old `metadata` object before native admission or
updates.** It warns when old credential/signature fields are present. Name/email
and identifier remain unverified preferences. This includes the observed 12ui
contact update: its old signature is not portable verified identity, and its
metadata does not become verified native context. Old visitor sessions and
transcript access remain on legacy; the bridge establishes fresh native visitor
authority, not seamless old-session continuation.

To restore verified identified visitors and signed metadata, deliberately migrate
the customer's trusted backend to this installation's current signatures and
use the native `widgetKey` form. Native server validation then governs identity
and metadata. Never publish secrets, accept unsigned metadata as verified, or
convert old contact keys/JWTs into native sessions. `settings`, `theme` and `text`
remain client preferences within server policy, not permission grants.

## HTTP caller inventory

`P` below is `/api/projects/{project}` on `https://app.happytohelp.com` (or the
explicitly configured old API origin). Every row is **Drain** for unchanged old
clients. Similar native features do not establish response-shape compatibility.

| Legacy method and path | Source consumer / meaning | Deliberate migration target |
| --- | --- | --- |
| `GET P/widget`, `PUT P/widget` | Widget boot / update contact | Native `/api/widget/settings`, `/api/identity/widget/session` and authenticated visitor profile/contact operations. Establish fresh native contact authority. |
| `GET P/widget-settings` | Widget configuration | Native `/api/widget/settings?widgetKey=…`. |
| `POST P/media` | Legacy form upload | Native `POST /api/conversations/{id}/media`, scoped bearer and native upload body. |
| `GET P/articles`, `GET P/articles/{article}` | Widget article browse/read | Published native knowledge routes/help center; preserve publication and project scope. |
| `POST P/contacts/{contact}/collector` | Collector/derived context | Native conversation widget-events/context paths under current visitor authority. |
| `GET P/proxy-status` | Legacy website proxy | Keep legacy proxy callers there; native isolated website preview is a distinct grant-based surface. |
| `POST /api/auth/login` | Legacy dashboard JWT | Native sign-in or a newly minted scoped `/api/v1` integration token; old JWTs are not native authority. |
| `GET P/theme-images`, `GET P/macros` | Legacy dashboard configuration | Native dashboard/settings or explicit scoped API integration. |
| `PUT/PATCH P/contacts/{contact}` | Dashboard contact update | Native authorized contact operations, with current role and erasure fences. |
| `GET P/conversations`, `GET P/conversations/{conversation}`, `PUT/PATCH P/conversations/{conversation}` | Inbox list/detail/update and transcript-related action | Native dashboard/conversation APIs, including admission/frontier checks. |
| `GET P/conversations/{conversation}/buckets`, `GET P/conversations/{conversation}/buckets/{bucket}` | Transcript buckets | Native coherent message/revision transcript; preserve original IDs in import. |
| `GET P/conversations/{conversation}/completions` | Suggestions/completion work | Native AI request/suggestion lifecycle and explicit provider configuration. |
| `GET P/conversations/{conversation}/collector` | Registered collector resource | Retain legacy until caller's actual parameter contract is accounted for; route declaration and controller signature alone do not qualify this path. |
| `POST P/conversations/{conversation}/participants`, `DELETE P/conversations/{conversation}/participants/{participant}` | Add/remove participants | Native scoped conversation participant operations. |
| `POST P/conversations/{conversation}/notes`, `DELETE P/conversations/{conversation}/notes/{note}` | Private notes | Native scoped note operations; private meaning stays private. |

`routes/api.php` declares resource families for theme-images, macros, contacts,
conversations, buckets, completions, collector, participants and notes. The table
lists implemented controller actions, not every boilerplate verb a resource
router could generate. An undeclared external caller is an inventory item to
resolve before retiring the family, not a reason to guess a translation.
Native operator APIs are `/api/dashboard/...`, `/api/management/...` and scoped
bearer `/api/v1/...`; native conversation transport is `/api/conversations/...`.

## WebSocket caller inventory

Keep `wss://ws.happytohelp.com/` and the alternate
`wss://ws.hascontext.com/` on legacy for cached scripts and active clients.
A hostname redirect cannot translate this protocol.

The old handshake supplies `contact_id` plus `key` or `token`, or `agent_id`
plus `project_id` and `token`; optional `conversation_id` selects history.
The widget subsequently sends `auth` with encrypted session/contact keys.
Internal-mode flags/tokens are server infrastructure, never a public privilege.

Every old action below is **Drain**, including where native has an equivalent:

| Legacy action | Migration decision for its caller |
| --- | --- |
| `$connect`, `$disconnect`, `$default`, `auth` | Establish native scoped sessions/sockets; do not reuse old encrypted handshake or internal auth. |
| `sendMessage` | Native guarded HTTP message admission with stable local identity, then native socket delivery. |
| `markAsRead` | Native read/widget event operation. |
| `refreshConversation`, `setConversationId` | Native authenticated transcript refresh/conversation selection. |
| `saveEvents`, `sendEvent` | Migrate known event types to native scoped events; preserve unsupported historical events as custody. |
| `assignAi` | Native assignment policy and current operator/visitor scope. |
| `pingAction`, `pingActive` | Native bounded visitor events; preserve consent and collection controls. |
| `collector` | Native visitor context collection, under consent and project authority. |
| `instruction` | Native bounded widget instruction events; no implicit remote-code authority. |
| `request` | Native configured request lifecycle; uncertain old requests remain on legacy/reconciliation. |
| `agentAssist` | Native operator assistance; account for pending work without replay. |
| `useInsight` | Native insight admission and current conversation authority. |

Native sockets are `/api/conversations/{id}/socket` and
`/api/projects/{id}/socket` on the application origin, with native authentication,
origin checks and replay cursors. Drain evidence must include cached versions,
open connections, external operators/integrations, pending requests and late
reconnects; zero current connections alone does not prove cached callers migrated.

## Links, help hosts and retained files

| Existing entry | Supported mapping or drain decision |
| --- | --- |
| Customer's `https://their-website.example/#launch-chat` | Keep the customer-owned host; the installed bridge honors the fragment. |
| `APP_URL/projects/{project}/conversations/{conversation}` | This is already a native inbox route. Retain both imported IDs; native sign-in preserves a safe `returnTo` and current project membership governs access. No public transcript redirect or legacy-cookie authority is added. |
| `APP_URL/accept-invitation/{token}` and Laravel auth/recovery links | **Drain** until expiry, or explicitly revoke/reissue with native tokens. Archived old password/token rows are not imported authority. |
| `https://happytohelp.com/{project-slug}/`, `/{project-slug}/search?keyword=…`, `/{project-slug}/{article-slug}` | Retain aliases and article slugs after import; native also serves `/help/{project}/...`. Exclude drafts/deleted projects. |
| `https://<slug>.<help-center APP_DOMAIN>/` and `/search`, `/{article-slug}`; saved `help_center_domain` | Only owner-confirmed exact host mappings may select a native project. No suffix wildcard or Host-derived guessed tenant. Preserve current DNS/TLS/routing until that inventory is supplied. The standalone legacy custom-domain branch is empty, so saved intent alone does not prove a working custom host. |
| `https://cdn.happytohelp.com/...` | **Drain/preserve** public avatars, icons and static asset paths. Native bundled assets do not preserve already-issued CDN URLs. |
| Stored `Media.url`, `AWS_URL`/actual `storage.` object domain, exported attachment/preview links | **Drain/preserve** each issued address and hash until its explicit safe mapping is approved. Actual storage domains, object names and ACLs are not inferred from examples. |

Configure confirmed help hosts through deployment configuration, for example:

```json
{
  "help.customer.example": "retained-project-slug",
  "old-help.example": "retained-project-id"
}
```

Set this JSON string as `PUBLIC_HELP_HOSTS`. Keys are exact lowercase hostnames,
without scheme, path or wildcard; values are retained project IDs or explicit
public aliases. The configured canonical `APP_ORIGIN` hostname keeps ordinary
application/homepage routing even if listed. Only a confirmed mapped host's root,
`/search` and single article-slug paths receive help-center dispatch, with relative
links and published-project checks; reserved application/API paths keep their
normal routing. No suffix match, forwarded host or arbitrary request host selects
a tenant. DNS/TLS ownership remains the owner's final routing step.

For files, inventory the exact old URL, owning project, media/message/object ID,
content hash, filename/type, original visibility and required current authority.
Authorized imported bytes live behind native
`GET /api/conversations/{conversation}/media/{mediaId}`. This route rechecks the
actor's current project and contact/conversation authority; a copied URL cannot
grant access. Retain existing storage access controls during the transition.
**Do not automatically redirect a public old URL to protected bytes, publish a
private R2 bucket, embed a bearer token in a redirect, or weaken media access to
make an emailed URL work.** A private legacy URL needs an authenticated resolver
or the retained protected legacy origin; only proven public static objects may
have a reviewed public replacement. No such production resolver or object ACL
change is claimed here.

## Mailboxes, callbacks and other external receivers

| Caller/receiver | Decision before retirement |
| --- | --- |
| `<project-slug>@mail.<MAIL_FROM_DOMAIN>` and `<project-slug>+<conversation-id>@mail.<MAIL_FROM_DOMAIN>` | **Drain/preserve.** The actual mail domain is owner configuration, not necessarily `happytohelp.com`. Preserve project slugs, plus addresses and conversation IDs. Legacy SES → S3 MIME → Lambda/Artisan receives mail, rather than a public inbound HTTP URL. Owner inventories stored/unprocessed MIME and receipt IDs and assigns every receipt to exactly one receiver. |
| Native inbound replacement | Configure Email Worker, `/api/integrations/email/sendgrid/inbound`, signature-verified `/api/integrations/email/mailgun/inbound` or authenticated `/api/integrations/email/inbound` explicitly. Preserve envelope sender, recipients, provider receipt/message identity and machine-generated classification. Reconcile ambiguous old outcomes, process the backlog once, and never run both systems' autonomous replies for the same receipt. See [inbound recovery](INBOUND-EMAIL-RECOVERY.md). |
| `APP_URL/webhooks/apify/{datasetId}` (`POST`; optional development `NGROK_HOST`) | **Drain** in-flight legacy crawls on their original callback. Native Apify start/poll is separate; do not redirect late callbacks to create fresh native corpus jobs. |
| `APP_URL/github/callback` (`GET`, or `GITHUB_REDIRECT_URI`) | **Drain** in-flight legacy OAuth states. Owner registers native `/api/management/github/callback` with the OAuth application, then reconnects with native consent and current owner/admin authority. Redirecting old state does not authorize native. |
| AWS `happytohelp-completions-<environment>-{answer,ingest,delete}` in `us-east-1` | **Drain/reconcile** legacy internal jobs. These are Lambda invocation names, not public URLs to repoint. Native knowledge/AI do not require recreating them. |
| Cashier `/stripe/*` callback family and `/projects/{project}/billing?session_id=…` return | **Drain** on legacy while owner settles pending operations. Exact deployed webhook path requires owner inventory. Native billing is excluded; never redirect provider events to native outbound webhooks or reactivate historical balances. |
| `api.intercom.io`, `<subdomain>.freshdesk.com/api/v2`, `<subdomain>.zendesk.com`, `api.github.com` | Outbound provider APIs, not H2H DNS aliases. Reconnect configured native import/repository adapters with native credentials; retain per-account source selection. |

## Plugin SDK migration (X03)

**Decision: explicitly migrate each plugin consumer or retain it on legacy.**
Generic native iframe support is not proof that arbitrary legacy SDK consumers
work. ChargeDesk's external plugin URL is
`https://app.chargedesk.com/installed/happytohelp`; it is separate from
HappyToHelp's excluded account billing. No ChargeDesk or payment-provider
configuration was changed or live plugin exercised.

The old SDK receives only from its baked localhost/test/production/staging
allowlist, including `https://app.happytohelp.com`, and sends to `*`. Preserving
the eventual `https://app.happytohelp.com` origin where feasible helps that
allowlist, but does not by itself qualify protocol/data compatibility.

Migrate a controlled plugin to `createPluginClient({hostOrigin})` from
`src/modules/plugin-sdk/index.ts`, optionally assigning it to
`window.HappytoHelp`. `hostOrigin` must be the **exact native application origin**
(scheme, host and port; no path, trailing slash or wildcard), for example
`https://support.example.com`. The dashboard configures each iframe's exact
`pluginOrigin` from its URL. Receivers check both origin and sending window;
outbound messages use that explicit origin. HTTP is accepted only for localhost.
The preserved envelope is `{happytohelp:true,type,payload}` with
`setMessageContent`, `getConversation`/`setConversation`, `resolveConversation`
and `setHeight`. Payload/height bounds and current native conversation permission
still apply. Arbitrary `sendEvent` types are not a native capability grant.

Inventory plugin URL, owning project, deployed SDK revision, expected host origin,
command/data dependencies and responsible external maintainer. Migrate and
qualify draft insertion, conversation context, resolution and sizing for each
used plugin before moving that caller. External plugins still baking the legacy
host list must be updated by their maintainer or kept on legacy.

## Widget hash

The public project key identifies the installation; it is not a credential.
Generate visitor identity and metadata signatures only on the customer's trusted
backend with that workspace's secret, and preserve the native verifier's exact
canonicalization. An identity hash from an unrelated installation is not portable
authority. Never place workspace secrets, dashboard tokens or old JWTs in public
snippets. Follow the current Widget > Code verification examples and the identity
module's verifier when updating a customer integration.

## Values

Keep project IDs/public keys, published project/article slugs, conversation IDs,
mailbox plus addressing and retained file identity consistent in the reviewed
import. Native client preferences may change appearance and copy; they cannot
relax origin checks, grant membership, publish drafts or make private files public.
Unknown exported hosts and pending external outcomes remain explicit inventory
items rather than invented defaults.

## Safety

The owner-controlled switch requires a consistent authorized export and delta
window, retained bytes with hashes and visibility, exact website/help/plugin/mail
host inventories, DNS/TLS/account access, configured native provider consent and
explicit production cutover approval. Until then, keep legacy authoritative for
all Drain rows. Do not replay uncertain sends, crawls, jobs or OAuth exchanges.
The new source can be prepared and exercised locally without changing production.

## Old public resource paths

Preserve these six links with narrow documentation mappings when the owner moves
the public routing. Native source implements GET/HEAD-only HTTP 308 redirects to this migration
guide. The approved homepage and retired marketing/legal/pricing/waitlist flows
are outside this mapping.

| Old `happytohelp.com` path | Native documentation target |
| --- | --- |
| `/resources/install` | `/docs/legacy-entry-points#install` |
| `/resources/widget-hash` | `/docs/legacy-entry-points#widget-hash` |
| `/resources/javascript-api` | `/docs/legacy-entry-points#javascript-api` |
| `/resources/javascript-options` | `/docs/legacy-entry-points#javascript-options` |
| `/resources/values` | `/docs/legacy-entry-points#values` |
| `/resources/safety` | `/docs/legacy-entry-points#safety` |

Only these named GET/HEAD resource paths (with optional trailing slash) are part
of this mapping. Do not use a broad
`/resources/*` redirect to mask unknown legacy resources or reinterpret POSTs.

## Source trace

Legacy sources below were read-only. Paths are relative to their original
repositories under `chargedesk/`, not runtime dependencies of this native release.

| Source | Evidence |
| --- | --- |
| `happytohelp-widget/src/index.js:11–38,61–84,140–234` | Brand hosts, simple attributes, queued commands, hash opening, project alias, consent/raw dispatch. |
| `happytohelp-widget/src/js/App.js:159–183`; `src/js/context/AppContext.js:4–5`; `src/js/context/ConnectContext.js:304,378` | Selector click behavior, default HTTP/WS origins, old contact handshake and encrypted auth action. |
| `happytohelp/resources/views/includes/widget_code.blade.php:8–59`; `happytohelp-site/resources/views/resources/{javascript-api,javascript-options}.blade.php` | Served snippet, public documented commands, contact/config fields. |
| `happytohelp/routes/api.php:35–64`; `app/Http/Controllers/Api/V1/*Controller.php` | Explicit widget routes, authenticated resource families and implemented controller actions. |
| `happytohelp-chat/serverless.yml:88–195`; `src/connectionManager.js:35–65` | Complete socket route/action inventory and agent/contact connect parameters. |
| `happytohelp/resources/views/includes/emails/project_link.blade.php:11–21`; `routes/web.php:30–40,87,114–127` | Customer/operator links, invitations, crawl/OAuth/billing/inbox routes. |
| `happytohelp/app/Models/Project.php:559–564,711–718`; `app/Models/Conversation.php:165–168`; `app/Console/Commands/HandleIncomingEmail.php:41,73–86` | Actual configured-domain mailbox formulas, help URL, SES/S3 receipt custody. |
| `happytohelp-help-center/app/Http/Middleware/GetProjectForDomain.php:22–34`; `happytohelp-site/routes/web.php:40–74` | Subdomain resolution, empty custom-host branch, public resource/help routes. |
| `happytohelp/app/Models/Media.php:51`; `config/filesystems.php:65`; `happytohelp-widget/src/js/AIAvatar.js:33` | Retained generated media URL, configured storage origin, fixed CDN avatar URLs. |
| `happytohelp/app/Jobs/CrawlDataset.php:55,93`; `app/Services/GitHubService.php:22`; `config/services.php:66`; `app/Services/LambdaService.php:32`; `app/Http/Middleware/VerifyCsrfToken.php:15` | Crawl callback, OAuth override, internal Lambda, Stripe receiver family. |
| `happytohelp-plugin-sdk/src/index.js:13–19,32–70`; `happytohelp/resources/views/plugins/index.blade.php:4–30` | Baked SDK origin allowlist, wildcard sender, plugin commands and external ChargeDesk install URL. |
| Native `src/modules/widget/{embed,index}.jsx`, `legacy-entry.js`, `legacy-options.js`, `legacy-project.ts`, `transport.js`; `src/modules/identity`; `src/modules/conversations/routes.ts:35–43` | Native bridge/normalization/public project resolver, fresh sessions, private media and conversation/project sockets. |
| Native `src/modules/plugin-sdk/{index,host,protocol}.ts`; `src/modules/legacy-import/README.md`; `src/modules/integrations/{inbound,sendgrid-inbound,github-oauth}.ts`; `src/modules/knowledge/crawl.ts` | Exact-origin plugin protocol, import authority boundaries, native inbound/OAuth and start/poll crawl replacements. |
| Native `src/modules/public-site/index.ts`, `help-center.tsx`, `help-host.ts`, `legacy-docs.ts`; `src/modules/widget/asset-origin.ts` | Published path/host help resolution, narrow documentation redirects and app-origin injection for separately hosted scripts. |

Production use, complete installed caller inventory, original storage/domain ACLs
and external plugin compatibility remain unverified until the owner's cutover
artifacts and provider evidence exist.
